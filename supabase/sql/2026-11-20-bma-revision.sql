-- Correcciones de la revisión final de Ventas/Personas/Dudas (20-nov-2026). Migración "bma_revision_ventas".
-- 1. precio_auto: el precio puesto solo (pagado al cerrarse) sigue a las correcciones; el escrito a mano no.
-- 2. Unir una duda ya no arrastra las dudas de otros movimientos de la venta de origen.
-- 3. Devolución permitida en una venta cancelada; nunca mayor que lo pagado.

alter table bma.ventas add column precio_auto boolean not null default false;
select set_config('bma.importando', 'si', true);   -- este ajuste no es una captura: no va a la bitácora
update bma.ventas set precio_auto = true where origen = 'importada' and estado = 'cerrada' and precio_total is not null;

create or replace function bma.recalcular(p_venta uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare t text[]; neto numeric; est text; v bma.ventas; nuevo numeric; auto boolean;
begin
  select * into v from bma.ventas where id = p_venta;
  if not found then return; end if;
  select coalesce(array_agg(tipo), '{}'), bma.pagado(p_venta) into t, neto from bma.movimientos where venta_id = p_venta;
  est := case when 'cancelacion' = any(t) then 'cancelada'
              when 'contado' = any(t) or 'liquidacion' = any(t) then 'cerrada' else 'abierta' end;
  if v.precio_auto or v.precio_total is null then
    auto := est = 'cerrada';
    nuevo := case when auto then neto end;
  else
    auto := false; nuevo := v.precio_total;
  end if;
  if est is distinct from v.estado or nuevo is distinct from v.precio_total or auto <> v.precio_auto then
    update bma.ventas set estado = est, precio_total = nuevo, precio_auto = auto where id = p_venta;
  end if;
end $$;
revoke all on function bma.recalcular(uuid) from public, anon, authenticated;

create or replace function public.bma_venta_editar(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path to '' as $$
begin
  perform bma.rol_actual();
  if p ? 'producto' and coalesce(btrim(p->>'producto'), '') = '' then raise exception 'Falta el producto'; end if;
  update bma.ventas set
    cliente_id = case when p ? 'cliente_id' then (p->>'cliente_id')::uuid else cliente_id end,
    vendedor_id = case when p ? 'vendedor_id' then (p->>'vendedor_id')::uuid else vendedor_id end,
    producto = case when p ? 'producto' then btrim(p->>'producto') else producto end,
    categoria = case when p ? 'categoria' then nullif(btrim(p->>'categoria'), '') else categoria end,
    linea = case when p ? 'linea' then p->>'linea' else linea end,
    remision = case when p ? 'remision' then nullif(btrim(p->>'remision'), '') else remision end,
    factura = case when p ? 'factura' then nullif(btrim(p->>'factura'), '') else factura end,
    color = case when p ? 'color' then nullif(btrim(p->>'color'), '') else color end,
    precio_total = case when p ? 'precio_total' then nullif(p->>'precio_total', '')::numeric else precio_total end,
    -- escribir un precio lo fija; borrarlo vuelve al precio automático
    precio_auto = case when p ? 'precio_total' then nullif(p->>'precio_total', '') is null else precio_auto end
  where id = p_id;
  if not found then raise exception 'No existe la venta'; end if;
  perform bma.recalcular(p_id);
end $$;

create or replace function public.bma_movimiento_nuevo(p_venta uuid, p jsonb) returns uuid
language plpgsql security definer set search_path to '' as $$
declare t text := p->>'tipo'; mo numeric := coalesce((p->>'monto')::numeric, 0);
        f date := coalesce((p->>'fecha')::date, current_date); est text; v_mov uuid;
begin
  perform bma.rol_actual();
  if coalesce(t, '') not in ('anticipo', 'abono', 'liquidacion', 'cancelacion', 'entrega', 'devolucion') then
    raise exception 'Tipo de movimiento no válido';
  end if;
  select estado into est from bma.ventas where id = p_venta for update;
  if not found then raise exception 'No existe la venta'; end if;
  if t in ('cancelacion', 'entrega') then mo := 0;
  elsif mo <= 0 then raise exception 'Falta el monto';
  end if;
  if est = 'cancelada' and mo > 0 and t <> 'devolucion' then raise exception 'La venta está cancelada'; end if;
  if t = 'devolucion' and mo > bma.pagado(p_venta) then raise exception 'La devolución es mayor que lo pagado'; end if;
  if f > current_date then raise exception 'La fecha no puede ser futura'; end if;
  insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto, metodo, cuenta, nota, confirmado_banco)
    values (p_venta, f, bma.lunes(f), t, mo, nullif(p->>'metodo', ''), nullif(btrim(p->>'cuenta'), ''),
            nullif(btrim(p->>'nota'), ''), coalesce((p->>'confirmado_banco')::boolean, false))
    returning id into v_mov;
  perform bma.recalcular(p_venta);
  return v_mov;
end $$;

create or replace function public.bma_duda_resolver(p_id uuid, p_unir_a uuid default null, p_nota text default null) returns void
language plpgsql security definer set search_path to '' as $$
declare d bma.dudas_importacion; v_origen uuid;
begin
  perform bma.rol_actual();
  select * into d from bma.dudas_importacion where id = p_id for update;
  if not found then raise exception 'No existe la duda'; end if;
  if d.estado = 'resuelta' then raise exception 'Esta duda ya está resuelta'; end if;
  if p_unir_a is not null then
    if d.movimiento_id is null then raise exception 'Esta duda no tiene un movimiento que unir'; end if;
    if not exists (select 1 from bma.ventas where id = p_unir_a) then raise exception 'No existe la venta'; end if;
    select venta_id into v_origen from bma.movimientos where id = d.movimiento_id;
    if v_origen = p_unir_a then raise exception 'El movimiento ya es de esa venta'; end if;
    update bma.movimientos set venta_id = p_unir_a where id = d.movimiento_id;
    perform bma.recalcular(p_unir_a);
    if not exists (select 1 from bma.movimientos where venta_id = v_origen) then
      -- la venta de origen quedó vacía: sus dudas pasan a la venta destino y se borra
      update bma.dudas_importacion set venta_id = p_unir_a where venta_id = v_origen;
      delete from bma.ventas where id = v_origen;
    else
      update bma.dudas_importacion set venta_id = p_unir_a where id = p_id;
      perform bma.recalcular(v_origen);
    end if;
  end if;
  update bma.dudas_importacion set estado = 'resuelta', resuelta_por = (select auth.uid()), resuelta_en = now(),
    detalle = detalle || coalesce(' · Nota: ' || nullif(btrim(p_nota), ''), '')
  where id = p_id;
end $$;
