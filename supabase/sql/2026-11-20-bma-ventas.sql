-- Consultar y capturar ventas, personas y dudas. Aplicada como migración "bma_ventas" (20-nov-2026).
-- Todo pasa por funciones public.bma_* (security definer) que revisan el rol en bma.usuarios.
-- La bitácora la sigue escribiendo el trigger; capturar o resolver una duda cierra la importación.

-- ---------------------------------------------------------------- Ayudas internas
create function bma.rol_actual() returns text
language plpgsql stable security definer set search_path to '' as $$
declare r text;
begin
  select rol into r from bma.usuarios where user_id = (select auth.uid());
  if r is null then
    raise exception 'Esta cuenta no tiene acceso a la administración' using errcode = '42501';
  end if;
  return r;
end $$;

create function bma.sin_acentos(s text) returns text language sql immutable set search_path to '' as
$$ select translate(lower(coalesce(s, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou') $$;

create function bma.lunes(d date) returns date language sql immutable set search_path to '' as
$$ select d - (extract(isodow from d)::int - 1) $$;

create function bma.num_remision(s text) returns text language sql immutable set search_path to '' as
$$ select case when regexp_replace(coalesce(s, ''), '\D', '', 'g') = '' then null
               else coalesce(nullif(ltrim(regexp_replace(s, '\D', '', 'g'), '0'), ''), '0') end $$;

create function bma.pagado(p_venta uuid) returns numeric language sql stable set search_path to '' as
$$ select coalesce(sum(case when tipo = 'devolucion' then -monto else monto end), 0) from bma.movimientos where venta_id = p_venta $$;

-- Estado y precio salen de los movimientos: cancelada si hay cancelación; cerrada si hay contado o
-- liquidación; si no, abierta. Al cerrarse sin precio, el precio es lo pagado.
create function bma.recalcular(p_venta uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare t text[]; neto numeric; est text; v bma.ventas;
begin
  select * into v from bma.ventas where id = p_venta;
  if not found then return; end if;
  select coalesce(array_agg(tipo), '{}'), bma.pagado(p_venta) into t, neto from bma.movimientos where venta_id = p_venta;
  est := case when 'cancelacion' = any(t) then 'cancelada'
              when 'contado' = any(t) or 'liquidacion' = any(t) then 'cerrada' else 'abierta' end;
  if est is distinct from v.estado or (est = 'cerrada' and v.precio_total is null) then
    update bma.ventas set estado = est,
      precio_total = case when est = 'cerrada' and precio_total is null then neto else precio_total end
    where id = p_venta;
  end if;
end $$;

create or replace function bma.exigir_importacion() returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from bma.usuarios where user_id = (select auth.uid()) and rol = 'admin') then
    raise exception 'Solo el admin puede importar' using errcode = '42501';
  end if;
  if exists (select 1 from bma.ventas where origen = 'capturada')
     or exists (select 1 from bma.movimientos where origen = 'capturada')
     or exists (select 1 from bma.personas where origen = 'capturada')
     or exists (select 1 from bma.bitacora)
     or exists (select 1 from bma.dudas_importacion where estado = 'resuelta') then
    raise exception 'ya hay captura: la importación está cerrada';
  end if;
  perform set_config('bma.importando', 'si', true);
end $$;

revoke all on function bma.rol_actual(), bma.recalcular(uuid), bma.pagado(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- Ventas
create function public.bma_ventas_buscar(p_q text, p_sucursal text default null, p_estado text default null,
                                         p_limite int default 100) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare q text := bma.sin_acentos(btrim(coalesce(p_q, ''))); num text := bma.num_remision(p_q); out jsonb;
begin
  perform bma.rol_actual();
  select coalesce(jsonb_agg(x order by s.ultimo desc nulls last, s.folio desc), '[]') into out from (
    select v.folio, m.ultimo, jsonb_build_object('id', v.id, 'folio', v.folio, 'sucursal', v.sucursal, 'fecha', v.fecha,
      'producto', v.producto, 'linea', v.linea,
      'cliente', case when c.id is null then null else jsonb_build_object('id', c.id, 'numero', c.numero, 'nombre', c.nombre) end,
      'vendedor', ve.nombre, 'remision', v.remision, 'factura', v.factura, 'estado', v.estado, 'precio_total', v.precio_total,
      'pagado', m.pagado, 'ultimo', m.ultimo,
      'dudas', (select count(*) from bma.dudas_importacion d where d.venta_id = v.id and d.estado = 'pendiente')) x
    from bma.ventas v
    left join bma.personas c on c.id = v.cliente_id
    left join bma.personas ve on ve.id = v.vendedor_id
    left join lateral (select bma.pagado(v.id) pagado, max(fecha) ultimo from bma.movimientos where venta_id = v.id) m on true
    where (p_sucursal is null or v.sucursal = p_sucursal) and (p_estado is null or v.estado = p_estado)
      and (q = '' or bma.sin_acentos(concat_ws(' ', v.folio, v.producto, v.factura, c.nombre, ve.nombre)) like '%' || q || '%'
           or (num is not null and (bma.num_remision(v.remision) = num or c.numero::text = num)))
    order by m.ultimo desc nulls last, v.folio desc
    limit greatest(1, least(coalesce(p_limite, 100), 500))) s;
  return out;
end $$;

create function public.bma_venta(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare venta jsonb; movs jsonb; cambios jsonb; dudas jsonb; nombres jsonb;
begin
  perform bma.rol_actual();
  select to_jsonb(v) || jsonb_build_object('pagado', bma.pagado(v.id),
           'cliente', case when c.id is null then null else jsonb_build_object('id', c.id, 'numero', c.numero, 'nombre', c.nombre) end,
           'vendedor', case when ve.id is null then null else jsonb_build_object('id', ve.id, 'nombre', ve.nombre) end)
    into venta
    from bma.ventas v left join bma.personas c on c.id = v.cliente_id left join bma.personas ve on ve.id = v.vendedor_id
    where v.id = p_id;
  if venta is null then raise exception 'No existe la venta'; end if;
  select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('quien',
           case when m.origen = 'importada' then 'Importado' else u.nombre end) order by m.fecha, m.creado_en), '[]')
    into movs from bma.movimientos m left join bma.usuarios u on u.user_id = m.creado_por where m.venta_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('tabla', b.tabla, 'accion', b.accion, 'antes', b.antes, 'despues', b.despues,
           'fecha', b.fecha, 'quien', u.nombre) order by b.fecha), '[]')
    into cambios from bma.bitacora b left join bma.usuarios u on u.user_id = b.usuario
    where b.registro_id = p_id or b.registro_id in (select id from bma.movimientos where venta_id = p_id)
       or (b.tabla = 'movimientos' and b.antes->>'venta_id' = p_id::text);
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'motivo', d.motivo, 'detalle', d.detalle, 'estado', d.estado)), '[]')
    into dudas from bma.dudas_importacion d where d.venta_id = p_id;
  select coalesce(jsonb_object_agg(p.id, p.nombre), '{}') into nombres from bma.personas p
    where p.id::text in (select x from jsonb_array_elements(cambios) c,
           lateral (values (c->'antes'->>'cliente_id'), (c->'despues'->>'cliente_id'),
                           (c->'antes'->>'vendedor_id'), (c->'despues'->>'vendedor_id')) t(x) where x is not null);
  return jsonb_build_object('venta', venta, 'movimientos', movs, 'cambios', cambios, 'dudas', dudas, 'nombres', nombres);
end $$;

create function public.bma_venta_nueva(p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_id uuid; suc text := p->>'sucursal'; f date := coalesce((p->>'fecha')::date, current_date);
        mv jsonb := p->'movimiento'; fm date; n int; fol text; anio int;
begin
  perform bma.rol_actual();
  if not exists (select 1 from bma.sucursales where clave = suc) then raise exception 'Falta la sucursal'; end if;
  if coalesce(btrim(p->>'producto'), '') = '' then raise exception 'Falta el producto'; end if;
  if mv is null or coalesce(mv->>'tipo', '') not in ('contado', 'anticipo') then
    raise exception 'El primer pago debe ser contado o anticipo';
  end if;
  if coalesce((mv->>'monto')::numeric, 0) <= 0 then raise exception 'Falta el monto'; end if;
  fm := coalesce((mv->>'fecha')::date, f);
  if f > current_date or fm > current_date then raise exception 'La fecha no puede ser futura'; end if;
  anio := extract(year from f)::int;
  perform pg_advisory_xact_lock(hashtext('bma.folio.' || suc || '.' || anio));
  select coalesce(max(substring(folio from '-(\d+)$')::int), 0) + 1 into n
    from bma.ventas where folio like suc || '-' || anio || '-%';
  fol := suc || '-' || anio || '-' || lpad(n::text, 4, '0');
  insert into bma.ventas (folio, sucursal, fecha, cliente_id, vendedor_id, producto, categoria, linea, remision, factura,
                          color, precio_total, estado)
    values (fol, suc, f, (p->>'cliente_id')::uuid, (p->>'vendedor_id')::uuid, btrim(p->>'producto'),
            nullif(btrim(p->>'categoria'), ''), coalesce(nullif(p->>'linea', ''), 'motos'), nullif(btrim(p->>'remision'), ''),
            nullif(btrim(p->>'factura'), ''), nullif(btrim(p->>'color'), ''), nullif(p->>'precio_total', '')::numeric, 'abierta')
    returning id into v_id;
  insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto, metodo, cuenta, nota)
    values (v_id, fm, bma.lunes(fm), mv->>'tipo', (mv->>'monto')::numeric, nullif(mv->>'metodo', ''),
            nullif(btrim(mv->>'cuenta'), ''), nullif(btrim(mv->>'nota'), ''));
  perform bma.recalcular(v_id);
  return jsonb_build_object('id', v_id, 'folio', fol);
end $$;

create function public.bma_movimiento_nuevo(p_venta uuid, p jsonb) returns uuid
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
  if est = 'cancelada' and mo > 0 then raise exception 'La venta está cancelada'; end if;
  if f > current_date then raise exception 'La fecha no puede ser futura'; end if;
  insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto, metodo, cuenta, nota, confirmado_banco)
    values (p_venta, f, bma.lunes(f), t, mo, nullif(p->>'metodo', ''), nullif(btrim(p->>'cuenta'), ''),
            nullif(btrim(p->>'nota'), ''), coalesce((p->>'confirmado_banco')::boolean, false))
    returning id into v_mov;
  perform bma.recalcular(p_venta);
  return v_mov;
end $$;

create function public.bma_venta_editar(p_id uuid, p jsonb) returns void
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
    precio_total = case when p ? 'precio_total' then nullif(p->>'precio_total', '')::numeric else precio_total end
  where id = p_id;
  if not found then raise exception 'No existe la venta'; end if;
end $$;

create function public.bma_movimiento_corregir(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare v uuid;
begin
  perform bma.rol_actual();
  if p ? 'fecha' and (p->>'fecha')::date > current_date then raise exception 'La fecha no puede ser futura'; end if;
  update bma.movimientos set
    fecha = case when p ? 'fecha' then (p->>'fecha')::date else fecha end,
    lunes = case when p ? 'fecha' then bma.lunes((p->>'fecha')::date) else lunes end,
    monto = case when p ? 'monto' then (p->>'monto')::numeric else monto end,
    metodo = case when p ? 'metodo' then nullif(p->>'metodo', '') else metodo end,
    cuenta = case when p ? 'cuenta' then nullif(btrim(p->>'cuenta'), '') else cuenta end,
    nota = case when p ? 'nota' then nullif(btrim(p->>'nota'), '') else nota end,
    confirmado_banco = case when p ? 'confirmado_banco' then (p->>'confirmado_banco')::boolean else confirmado_banco end
  where id = p_id returning venta_id into v;
  if v is null then raise exception 'No existe el movimiento'; end if;
  perform bma.recalcular(v);
end $$;

create function public.bma_movimiento_eliminar(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare v uuid;
begin
  if bma.rol_actual() <> 'admin' then
    raise exception 'Solo el admin puede eliminar un movimiento' using errcode = '42501';
  end if;
  delete from bma.movimientos where id = p_id returning venta_id into v;
  if v is null then raise exception 'No existe el movimiento'; end if;
  perform bma.recalcular(v);
end $$;

-- ---------------------------------------------------------------- Personas
create function public.bma_personas_buscar(p_q text, p_tipo text default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare q text := bma.sin_acentos(btrim(coalesce(p_q, ''))); dig text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g'); out jsonb;
begin
  perform bma.rol_actual();
  select coalesce(jsonb_agg(x order by s.nombre), '[]') into out from (
    select p.nombre, jsonb_build_object('id', p.id, 'numero', p.numero, 'nombre', p.nombre, 'tipos', p.tipos,
      'telefono', p.telefono, 'sucursal', p.sucursal,
      'ventas', (select count(*) from bma.ventas where cliente_id = p.id),
      'vendidas', (select count(*) from bma.ventas where vendedor_id = p.id)) x
    from bma.personas p
    where (p_tipo is null or p_tipo = any(p.tipos))
      and (q = '' or bma.sin_acentos(p.nombre) like '%' || q || '%' or (dig <> '' and p.numero::text = ltrim(dig, '0')))
    order by p.nombre limit 300) s;
  return out;
end $$;

create function public.bma_persona(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare per jsonb; compras jsonb; vendidas jsonb; cambios jsonb;
begin
  perform bma.rol_actual();
  select to_jsonb(p) into per from bma.personas p where id = p_id;
  if per is null then raise exception 'No existe la persona'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'folio', v.folio, 'fecha', v.fecha, 'producto', v.producto,
           'estado', v.estado, 'precio_total', v.precio_total, 'pagado', bma.pagado(v.id)) order by v.fecha desc), '[]')
    into compras from bma.ventas v where v.cliente_id = p_id;
  select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]') into vendidas from (
    select jsonb_build_object('id', v.id, 'folio', v.folio, 'fecha', v.fecha, 'producto', v.producto, 'estado', v.estado,
           'pagado', bma.pagado(v.id)) x
    from bma.ventas v where v.vendedor_id = p_id order by v.fecha desc limit 300) s;
  select coalesce(jsonb_agg(jsonb_build_object('accion', b.accion, 'antes', b.antes, 'despues', b.despues, 'fecha', b.fecha,
           'quien', u.nombre) order by b.fecha), '[]')
    into cambios from bma.bitacora b left join bma.usuarios u on u.user_id = b.usuario where b.registro_id = p_id;
  return jsonb_build_object('persona', per, 'compras', compras, 'vendidas', vendidas, 'cambios', cambios);
end $$;

create function public.bma_persona_guardar(p jsonb) returns uuid
language plpgsql security definer set search_path to '' as $$
declare v_id uuid; t text[] := array(select jsonb_array_elements_text(coalesce(p->'tipos', '[]')));
begin
  perform bma.rol_actual();
  if coalesce(btrim(p->>'nombre'), '') = '' then raise exception 'Falta el nombre'; end if;
  if cardinality(t) = 0 then raise exception 'Falta si es cliente, empleado o vendedor'; end if;
  if p ? 'id' and p->>'id' is not null then
    update bma.personas set nombre = btrim(p->>'nombre'), tipos = t, telefono = nullif(btrim(p->>'telefono'), ''),
      sucursal = nullif(p->>'sucursal', ''), notas = nullif(btrim(p->>'notas'), '')
    where id = (p->>'id')::uuid returning id into v_id;
    if v_id is null then raise exception 'No existe la persona'; end if;
  else
    insert into bma.personas (nombre, tipos, telefono, sucursal, notas)
      values (btrim(p->>'nombre'), t, nullif(btrim(p->>'telefono'), ''), nullif(p->>'sucursal', ''), nullif(btrim(p->>'notas'), ''))
      returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- Dudas
create function public.bma_dudas(p_estado text default 'pendiente') returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare out jsonb;
begin
  perform bma.rol_actual();
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'motivo', d.motivo, 'detalle', d.detalle, 'estado', d.estado,
           'resuelta_en', d.resuelta_en, 'quien', u.nombre,
           'venta', case when v.id is null then null else
                    jsonb_build_object('id', v.id, 'folio', v.folio, 'sucursal', v.sucursal, 'producto', v.producto) end)
           order by d.motivo, v.sucursal, v.folio), '[]')
    into out from bma.dudas_importacion d
    left join bma.ventas v on v.id = d.venta_id left join bma.usuarios u on u.user_id = d.resuelta_por
    where d.estado = coalesce(p_estado, 'pendiente');
  return out;
end $$;

create function public.bma_duda_resolver(p_id uuid, p_unir_a uuid default null, p_nota text default null) returns void
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
    update bma.dudas_importacion set venta_id = p_unir_a where venta_id = v_origen;
    perform bma.recalcular(p_unir_a);
    if not exists (select 1 from bma.movimientos where venta_id = v_origen) then
      delete from bma.ventas where id = v_origen;
    else
      perform bma.recalcular(v_origen);
    end if;
  end if;
  update bma.dudas_importacion set estado = 'resuelta', resuelta_por = (select auth.uid()), resuelta_en = now(),
    detalle = detalle || coalesce(' · Nota: ' || nullif(btrim(p_nota), ''), '')
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- Permisos
revoke all on function public.bma_ventas_buscar(text, text, text, int), public.bma_venta(uuid),
  public.bma_venta_nueva(jsonb), public.bma_movimiento_nuevo(uuid, jsonb), public.bma_venta_editar(uuid, jsonb),
  public.bma_movimiento_corregir(uuid, jsonb), public.bma_movimiento_eliminar(uuid), public.bma_personas_buscar(text, text),
  public.bma_persona(uuid), public.bma_persona_guardar(jsonb), public.bma_dudas(text), public.bma_duda_resolver(uuid, uuid, text)
  from public, anon;
grant execute on function public.bma_ventas_buscar(text, text, text, int), public.bma_venta(uuid),
  public.bma_venta_nueva(jsonb), public.bma_movimiento_nuevo(uuid, jsonb), public.bma_venta_editar(uuid, jsonb),
  public.bma_movimiento_corregir(uuid, jsonb), public.bma_movimiento_eliminar(uuid), public.bma_personas_buscar(text, text),
  public.bma_persona(uuid), public.bma_persona_guardar(jsonb), public.bma_dudas(text), public.bma_duda_resolver(uuid, uuid, text)
  to authenticated;
