-- Pruebas de la base de Grupo BMA (esquema bma). Se corren completas con execute_sql de Supabase.
-- Todo va en una transacción que termina en ROLLBACK: no deja nada guardado.
-- Las cuentas de prueba se crean dentro de la transacción; se suplantan con request.jwt.claims.
-- Resultado: una fila por caso con ok = true/false.
begin;

create temp table r (n serial, caso text, ok boolean, detalle text);
grant all on r to authenticated, anon; grant all on sequence r_n_seq to authenticated, anon;

create function pg_temp.como(p_id uuid, p_rol text default 'authenticated') returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', p_rol)::text, true);
  execute format('set local role %I', p_rol);
end $$;
create function pg_temp.yo() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.anota(p_caso text, p_ok boolean, p_detalle text default null) returns void language sql as
$$ insert into r (caso, ok, detalle) values (p_caso, coalesce(p_ok, false), p_detalle) $$;

do $$
declare
  sin_alta uuid := gen_random_uuid();
  con_alta uuid := gen_random_uuid();
  p uuid; v uuid; v2 uuid; m uuid; n int; j jsonb; err text;
begin
  insert into auth.users (id, email, aud, role) values
    (sin_alta, 'prueba-sin-alta@administracion.bma', 'authenticated', 'authenticated'),
    (con_alta, 'prueba-captura@administracion.bma', 'authenticated', 'authenticated');

  -- 1. anon no lee las tablas
  begin
    perform pg_temp.como(null, 'anon');
    perform count(*) from bma.ventas;
    perform pg_temp.yo(); perform pg_temp.anota('anon no lee bma.ventas', false, 'pudo leer');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.anota('anon no lee bma.ventas', true);
  end;

  -- 2. una sesión cualquiera tampoco lee las tablas directo
  begin
    perform pg_temp.como(con_alta);
    perform count(*) from bma.ventas;
    perform pg_temp.yo(); perform pg_temp.anota('sesión no lee bma.ventas directo', false, 'pudo leer');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.anota('sesión no lee bma.ventas directo', true);
  end;

  -- 3. cuenta sin alta no entra
  begin
    perform pg_temp.como(sin_alta);
    j := public.bma_sesion();
    perform pg_temp.yo(); perform pg_temp.anota('cuenta sin alta no entra', false, j::text);
  exception when sqlstate '42501' then
    perform pg_temp.yo(); perform pg_temp.anota('cuenta sin alta no entra', true);
  end;

  -- 4. cuenta dada de alta entra con su rol
  insert into bma.usuarios (user_id, nombre, rol) values (con_alta, 'Prueba', 'captura');
  perform pg_temp.como(con_alta);
  j := public.bma_sesion();
  perform pg_temp.yo();
  perform pg_temp.anota('cuenta dada de alta entra con su rol', j->>'rol' = 'captura' and j->>'nombre' = 'Prueba', j::text);

  -- 5. altas quedan en bitácora (persona, venta, movimiento)
  insert into bma.personas (nombre, tipos) values ('Cliente de prueba', array['cliente']) returning id into p;
  insert into bma.ventas (folio, sucursal, fecha, producto, linea, estado)
    values ('PRU-2026-0001', 'AGS', '2026-11-02', 'ATV DE PRUEBA', 'motos', 'abierta') returning id into v;
  insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto, metodo)
    values (v, '2026-11-02', '2026-11-02', 'anticipo', 1000, 'efectivo') returning id into m;
  select count(*) into n from bma.bitacora where accion = 'alta' and registro_id in (p, v, m);
  perform pg_temp.anota('altas quedan en bitácora', n = 3, n::text);

  -- 6. un cambio guarda antes y después
  update bma.ventas set cliente_id = p where id = v;
  select count(*) into n from bma.bitacora
    where accion = 'cambio' and registro_id = v and antes->>'cliente_id' is null and despues->>'cliente_id' = p::text;
  perform pg_temp.anota('cambio guarda antes y después', n = 1, n::text);

  -- 7. importando no anota
  select count(*) into n from bma.bitacora;
  perform set_config('bma.importando', 'si', true);
  insert into bma.ventas (folio, sucursal, fecha, producto, linea, estado, origen)
    values ('PRU-2026-0002', 'AGS', '2026-11-03', 'PASTO DE PRUEBA', 'pasto', 'cerrada', 'importada') returning id into v2;
  perform set_config('bma.importando', '', true);
  perform pg_temp.anota('importando no anota en bitácora', (select count(*) from bma.bitacora) = n);

  -- 8. no deja borrar lo importado si ya hay captura
  begin
    j := public.bma_borrar_importado();
    perform pg_temp.anota('no deja borrar lo importado si ya hay captura', false, j::text);
  exception when others then
    get stacked diagnostics err = message_text;
    perform pg_temp.anota('no deja borrar lo importado si ya hay captura', err like '%importación está cerrada%', err);
  end;

  -- 9. sesión no puede llamar bma_borrar_importado
  begin
    perform pg_temp.como(con_alta);
    j := public.bma_borrar_importado();
    perform pg_temp.yo(); perform pg_temp.anota('sesión no puede borrar lo importado', false);
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.anota('sesión no puede borrar lo importado', true);
  end;

  -- 10. borra lo importado cuando no hay captura (se quita lo capturado y la bitácora de esta prueba)
  delete from bma.movimientos where id = m; delete from bma.ventas where id = v; delete from bma.personas where id = p;
  delete from bma.bitacora;
  perform set_config('bma.importando', 'si', true);
  insert into bma.personas (nombre, tipos, origen) values ('VENDEDOR PRUEBA', array['vendedor'], 'importada');
  insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto, metodo, origen)
    values (v2, '2026-11-03', '2026-11-02', 'contado', 500, 'tarjeta', 'importada');
  insert into bma.dudas_importacion (venta_id, motivo, detalle) values (v2, 'sin_anticipo', 'prueba');
  insert into bma.apartados (tipo, sucursal, datos) values ('prestamo', 'AGS', '{}');
  perform set_config('bma.importando', '', true);
  j := public.bma_borrar_importado();
  perform pg_temp.anota('borra lo importado cuando no hay captura',
    (j->>'ventas')::int >= 1 and (j->>'movimientos')::int >= 1
    and not exists (select 1 from bma.ventas where origen = 'importada')
    and not exists (select 1 from bma.personas where origen = 'importada')
    and not exists (select 1 from bma.apartados) and not exists (select 1 from bma.dudas_importacion), j::text);

  -- 11. monto negativo se rechaza
  insert into bma.ventas (folio, sucursal, fecha, producto, linea, estado)
    values ('PRU-2026-0003', 'QRO', '2026-11-04', 'X', 'motos', 'abierta') returning id into v;
  begin
    insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto) values (v, '2026-11-04', '2026-11-02', 'abono', -5);
    perform pg_temp.anota('monto negativo se rechaza', false);
  exception when check_violation then perform pg_temp.anota('monto negativo se rechaza', true);
  end;

  -- 12. tipo de movimiento inválido se rechaza
  begin
    insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto) values (v, '2026-11-04', '2026-11-02', 'regalo', 5);
    perform pg_temp.anota('tipo de movimiento inválido se rechaza', false);
  exception when check_violation then perform pg_temp.anota('tipo de movimiento inválido se rechaza', true);
  end;

  -- 13. folio repetido se rechaza
  begin
    insert into bma.ventas (folio, sucursal, fecha, producto, linea, estado)
      values ('PRU-2026-0003', 'QRO', '2026-11-04', 'Y', 'motos', 'abierta');
    perform pg_temp.anota('folio repetido se rechaza', false);
  exception when unique_violation then perform pg_temp.anota('folio repetido se rechaza', true);
  end;

  -- 14. las 11 sucursales están sembradas
  perform pg_temp.anota('11 sucursales sembradas', (select count(*) from bma.sucursales) = 11
    and (select odoo_almacen from bma.sucursales where clave = 'GDL') = 'S-WAS');
exception when others then
  perform pg_temp.yo();
  perform pg_temp.anota('ERROR inesperado', false, sqlstate || ' ' || sqlerrm);
end $$;

select caso, ok, detalle from r order by n;
rollback;
