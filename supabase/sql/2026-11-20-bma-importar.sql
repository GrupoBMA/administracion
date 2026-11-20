-- Importación de 2026 con la sesión del admin: la página local importar/subir.html lee el JSON que genera
-- importar/cargar.py y lo sube por lotes. Aplicada en Supabase como migración "bma_importar" (20-nov-2026).
-- Solo admin, solo mientras no haya nada capturado a mano ni cambios en la bitácora; el origen siempre
-- queda 'importada' y nada se anota en la bitácora.

create function bma.exigir_importacion() returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from bma.usuarios where user_id = (select auth.uid()) and rol = 'admin') then
    raise exception 'Solo el admin puede importar' using errcode = '42501';
  end if;
  if exists (select 1 from bma.ventas where origen = 'capturada')
     or exists (select 1 from bma.movimientos where origen = 'capturada')
     or exists (select 1 from bma.personas where origen = 'capturada')
     or exists (select 1 from bma.bitacora) then
    raise exception 'ya hay captura: la importación está cerrada';
  end if;
  perform set_config('bma.importando', 'si', true);
end $$;
revoke all on function bma.exigir_importacion() from public, anon, authenticated;

-- Borra lo importado antes de volver a subir
create function public.bma_importar_empezar() returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  perform bma.exigir_importacion();
  return public.bma_borrar_importado();
end $$;

-- Sube un lote de renglones (arreglo JSON con los nombres de columna) a una de las tablas permitidas
create function public.bma_importar_lote(p_tabla text, p_filas jsonb) returns int
language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  perform bma.exigir_importacion();
  if p_tabla = 'personas' then
    insert into bma.personas (id, nombre, tipos, sucursal, origen)
      select coalesce(x.id, gen_random_uuid()), x.nombre, x.tipos, x.sucursal, 'importada'
      from jsonb_populate_recordset(null::bma.personas, p_filas) x;
  elsif p_tabla = 'ventas' then
    insert into bma.ventas (id, folio, sucursal, fecha, vendedor_id, producto, categoria, linea, remision, factura,
                            color, precio_total, estado, origen)
      select coalesce(x.id, gen_random_uuid()), x.folio, x.sucursal, x.fecha, x.vendedor_id, x.producto, x.categoria,
             x.linea, x.remision, x.factura, x.color, x.precio_total, x.estado, 'importada'
      from jsonb_populate_recordset(null::bma.ventas, p_filas) x;
  elsif p_tabla = 'movimientos' then
    insert into bma.movimientos (id, venta_id, fecha, lunes, tipo, monto, metodo, cuenta, confirmado_banco, nota,
                                 origen, origen_ref)
      select coalesce(x.id, gen_random_uuid()), x.venta_id, x.fecha, x.lunes, x.tipo, coalesce(x.monto, 0), x.metodo,
             x.cuenta, coalesce(x.confirmado_banco, false), x.nota, 'importada', x.origen_ref
      from jsonb_populate_recordset(null::bma.movimientos, p_filas) x;
  elsif p_tabla = 'apartados' then
    insert into bma.apartados (id, tipo, sucursal, fecha, lunes, monto, datos, origen_ref)
      select coalesce(x.id, gen_random_uuid()), x.tipo, x.sucursal, x.fecha, x.lunes, x.monto, x.datos, x.origen_ref
      from jsonb_populate_recordset(null::bma.apartados, p_filas) x;
  elsif p_tabla = 'dudas_importacion' then
    insert into bma.dudas_importacion (id, venta_id, movimiento_id, motivo, detalle)
      select coalesce(x.id, gen_random_uuid()), x.venta_id, x.movimiento_id, x.motivo, x.detalle
      from jsonb_populate_recordset(null::bma.dudas_importacion, p_filas) x;
  else
    raise exception 'la tabla % no se puede importar', p_tabla;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.bma_importar_empezar() from public, anon;
revoke all on function public.bma_importar_lote(text, jsonb) from public, anon;
grant execute on function public.bma_importar_empezar() to authenticated;
grant execute on function public.bma_importar_lote(text, jsonb) to authenticated;
