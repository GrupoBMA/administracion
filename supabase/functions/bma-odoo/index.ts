// Función de Supabase "bma-odoo": copia de Odoo a Supabase las existencias y los movimientos de inventario.
// Copia del código desplegado (verify_jwt = false: revisa ella misma quién la llama).
// - La llama el admin con "Actualizar" (su sesión de la app; se revisa con bma_sesion()) o la copia automática de cada
//   noche (pg_cron manda la clave del Vault en el encabezado x-bma-cron; se revisa con bma_odoo_cron_valido()).
// - SOLO LEE de Odoo: el ayudante `leer` solo permite search_read; nunca crea, cambia ni borra nada allá.
// - Usuario y clave de Odoo viven en los secretos de Supabase (ODOO_URL, ODOO_USUARIO, ODOO_CLAVE; ODOO_DB opcional).
// - Guarda con public.bma_odoo_guardar (solo service_role), que se queda solo con los cambios.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bma-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// "YYYY-MM-DD HH:MM:SS" de Odoo (UTC) -> ISO
const iso = (s: string | false) => (s ? s.replace(" ", "T") + "Z" : null);
const nombre = (m2o: unknown) => (Array.isArray(m2o) ? String(m2o[1]) : null);
const ident = (m2o: unknown) => (Array.isArray(m2o) ? Number(m2o[0]) : null);

function odoo() {
  const url = (Deno.env.get("ODOO_URL") || "").replace(/\/+$/, "");
  const usuario = Deno.env.get("ODOO_USUARIO") || "";
  const clave = Deno.env.get("ODOO_CLAVE") || "";
  if (!url || !usuario || !clave) throw new Error("Faltan secretos en Supabase: ODOO_URL, ODOO_USUARIO u ODOO_CLAVE");
  const db = Deno.env.get("ODOO_DB") || new URL(url).hostname.split(".")[0];
  let uid: number | null = null;

  async function llamar(service: string, method: string, args: unknown[]) {
    const r = await fetch(url + "/jsonrpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
    });
    if (!r.ok) throw new Error("Odoo respondió " + r.status);
    const j = await r.json();
    if (j.error) throw new Error("Odoo: " + ((j.error.data && j.error.data.message) || j.error.message));
    return j.result;
  }
  async function leer(modelo: string, dominio: unknown[], campos: string[], extra: Record<string, unknown> = {}) {
    if (uid === null) {
      uid = await llamar("common", "authenticate", [db, usuario, clave, {}]);
      if (!uid) throw new Error("Odoo no aceptó el usuario o la clave");
    }
    // Solo search_read, por páginas de 2000
    const todo: any[] = [];
    for (let offset = 0; ; offset += 2000) {
      const pag = await llamar("object", "execute_kw", [db, uid, clave, modelo, "search_read", [dominio],
        { fields: campos, limit: 2000, offset, order: "id", context: { active_test: false }, ...extra }]);
      todo.push(...pag);
      if (pag.length < 2000) return todo;
    }
  }
  return { leer };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    let quien = "Copia automática";
    const cron = req.headers.get("x-bma-cron");
    if (cron) {
      const ok = await admin.rpc("bma_odoo_cron_valido", { p: cron });
      if (ok.error || ok.data !== true) return responder({ error: "Clave de la copia automática no válida" }, 403);
    } else {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
        auth: { persistSession: false },
      });
      const ses = await sb.rpc("bma_sesion");
      if (ses.error || !ses.data || ses.data.rol !== "admin") return responder({ error: "Solo el admin puede actualizar el inventario de Odoo" }, 403);
      quien = ses.data.nombre;
    }

    const inicio = new Date().toISOString();
    const o = odoo();

    // Almacenes y todas las ubicaciones (para saber de qué almacén es cada una y si es interna, cliente, ajuste…)
    const almacenes = await o.leer("stock.warehouse", [], ["name", "code"]);
    const codigoAlm = new Map<number, string>(almacenes.map((a: any) => [a.id, a.code]));
    const ubic = await o.leer("stock.location", [], ["usage", "warehouse_id", "complete_name"]);
    const ub = new Map<number, { uso: string; alm: string | null }>();
    for (const u of ubic) ub.set(u.id, { uso: u.usage, alm: u.warehouse_id ? codigoAlm.get(u.warehouse_id[0]) || null : null });

    // Existencias de hoy (ubicaciones internas de cada almacén)
    const quants = await o.leer("stock.quant", [["location_id.usage", "=", "internal"], ["quantity", "!=", 0]],
      ["location_id", "product_id", "lot_id", "quantity", "in_date"]);
    const existencias = [];
    for (const q of quants) {
      const alm = ub.get(q.location_id[0])?.alm;
      if (!alm) continue;
      existencias.push({ almacen: alm, producto_id: q.product_id[0], lote: nombre(q.lot_id) || "", cantidad: q.quantity, llego: iso(q.in_date) });
    }

    // Movimientos hechos: la primera vez todos; después, los que cambiaron desde la copia anterior (con 2 días de margen)
    const ultima = await admin.rpc("bma_odoo_ultima_copia");
    const dominio: unknown[] = [["state", "=", "done"]];
    if (ultima.data) {
      const desde = new Date(Date.parse(ultima.data) - 2 * 864e5).toISOString().slice(0, 19).replace("T", " ");
      dominio.push(["write_date", ">=", desde]);
    }
    const lineas = await o.leer("stock.move.line", dominio, ["date", "create_date", "write_date", "create_uid", "write_uid",
      "reference", "origin", "product_id", "lot_id", "lot_name", "quantity", "location_id", "location_dest_id", "picking_type_id", "picking_id"]);

    // Cliente y orden de venta de cada documento
    const idsPick = [...new Set(lineas.map((l: any) => ident(l.picking_id)).filter((x: any) => x))];
    const pick = new Map<number, any>();
    for (let i = 0; i < idsPick.length; i += 1000) {
      const parte = idsPick.slice(i, i + 1000);
      let ps;
      try { ps = await o.leer("stock.picking", [["id", "in", parte]], ["partner_id", "sale_id", "origin"]); }
      catch { ps = await o.leer("stock.picking", [["id", "in", parte]], ["partner_id", "origin"]); }
      for (const p of ps) pick.set(p.id, p);
    }

    const movimientos = lineas.map((l: any) => {
      const de = ub.get(l.location_id[0]), a = ub.get(l.location_dest_id[0]);
      const p = pick.get(ident(l.picking_id) as number);
      return {
        id: l.id, fecha: iso(l.date), creado: iso(l.create_date), modificado: iso(l.write_date),
        creo: nombre(l.create_uid), modifico: nombre(l.write_uid), referencia: l.reference || null, origen: l.origin || (p && p.origin) || null,
        tipo: nombre(l.picking_type_id), producto_id: l.product_id[0], lote: nombre(l.lot_id) || l.lot_name || "", cantidad: l.quantity,
        de_almacen: de?.alm || null, a_almacen: a?.alm || null, de_ubicacion: nombre(l.location_id), a_ubicacion: nombre(l.location_dest_id),
        de_uso: de?.uso || null, a_uso: a?.uso || null, cliente: p ? nombre(p.partner_id) : null, venta: p ? nombre(p.sale_id) : null,
      };
    });

    // Productos que aparecen en existencias o movimientos
    const idsProd = [...new Set([...existencias.map((e) => e.producto_id), ...movimientos.map((m: any) => m.producto_id)])];
    const productos = [];
    for (let i = 0; i < idsProd.length; i += 1000) {
      const ps = await o.leer("product.product", [["id", "in", idsProd.slice(i, i + 1000)]],
        ["display_name", "default_code", "categ_id", "uom_id", "tracking"]);
      for (const p of ps) productos.push({ id: p.id, nombre: p.display_name, codigo: p.default_code || null,
        categoria: nombre(p.categ_id), unidad: nombre(p.uom_id), seguimiento: p.tracking });
    }

    const g = await admin.rpc("bma_odoo_guardar", { p: {
      inicio, quien, existencias, movimientos, productos,
      almacenes: almacenes.map((a: any) => ({ codigo: a.code, nombre: a.name })),
    } });
    if (g.error) throw new Error("No se pudo guardar la copia: " + g.error.message);
    return responder({ ok: true, ...g.data, quien });
  } catch (e) {
    // 200 con el error para que la app pueda leer el mensaje
    return responder({ error: e instanceof Error ? e.message : String(e) });
  }
});
