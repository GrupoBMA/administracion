-- Pruebas de la importación con sesión de admin (bma_importar_empezar / bma_importar_lote).
-- Se corren completas con execute_sql; terminan en ROLLBACK y no dejan nada guardado.
begin;

create temp table r (n serial, caso text, ok boolean, detalle text);
grant all on r to authenticated, anon; grant all on sequence r_n_seq to authenticated, anon;
create function pg_temp.como(p_id uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.yo() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.anota(p_caso text, p_ok boolean, p_detalle text default null) returns void language sql as
$$ insert into r (caso, ok, detalle) values (p_caso, coalesce(p_ok, false), p_detalle) $$;

do $$
declare
  adm uuid := gen_random_uuid(); cap uuid := gen_random_uuid();
  vid uuid := gen_random_uuid(); n int; j jsonb; err text; b0 int;
begin
  insert into auth.users (id, email, aud, role) values
    (adm, 'prueba-admin@administracion.bma', 'authenticated', 'authenticated'),
    (cap, 'prueba-cap@administracion.bma', 'authenticated', 'authenticated');
  insert into bma.usuarios values (adm, 'Admin prueba', 'admin'), (cap, 'Captura prueba', 'captura');
  select count(*) into b0 from bma.bitacora;

  -- 1. captura no puede empezar la importación
  begin
    perform pg_temp.como(cap); j := public.bma_importar_empezar();
    perform pg_temp.yo(); perform pg_temp.anota('captura no puede importar', false, j::text);
  exception when sqlstate '42501' then perform pg_temp.yo(); perform pg_temp.anota('captura no puede importar', true);
  end;

  -- 2. admin empieza (borra lo importado) y sube ventas y movimientos
  perform pg_temp.como(adm);
  j := public.bma_importar_empezar();
  n := public.bma_importar_lote('ventas', jsonb_build_array(jsonb_build_object(
        'id', vid, 'folio', 'PRU-2026-9001', 'sucursal', 'AGS', 'fecha', '2026-10-26', 'producto', 'ATV PRUEBA',
        'linea', 'motos', 'estado', 'cerrada', 'precio_total', 1000, 'origen', 'capturada')));
  n := n + public.bma_importar_lote('movimientos', jsonb_build_array(jsonb_build_object(
        'venta_id', vid, 'fecha', '2026-10-26', 'lunes', '2026-10-26', 'tipo', 'contado', 'monto', 1000,
        'metodo', 'efectivo', 'confirmado_banco', true, 'origen_ref', jsonb_build_object('hoja', 'AGS 44', 'fila', 6))));
  perform pg_temp.yo();
  perform pg_temp.anota('admin sube ventas y movimientos', n = 2, n::text);

  -- 3. el origen se fuerza a importada aunque venga otro
  perform pg_temp.anota('origen forzado a importada',
    (select origen from bma.ventas where id = vid) = 'importada'
    and (select origen from bma.movimientos where venta_id = vid) = 'importada');

  -- 4. la importación no escribe en la bitácora
  perform pg_temp.anota('importar no anota en bitácora', (select count(*) from bma.bitacora) = b0);

  -- 5. tabla que no está permitida se rechaza
  begin
    perform pg_temp.como(adm);
    n := public.bma_importar_lote('usuarios', '[{}]'::jsonb);
    perform pg_temp.yo(); perform pg_temp.anota('tabla no permitida se rechaza', false);
  exception when others then
    get stacked diagnostics err = message_text;
    perform pg_temp.yo(); perform pg_temp.anota('tabla no permitida se rechaza', err like '%no se puede importar%', err);
  end;

  -- 6. con algo capturado a mano, la importación queda cerrada
  insert into bma.ventas (folio, sucursal, fecha, producto, linea, estado)
    values ('PRU-2026-9002', 'QRO', '2026-11-02', 'CAPTURADA', 'motos', 'abierta');
  begin
    perform pg_temp.como(adm);
    n := public.bma_importar_lote('ventas', jsonb_build_array(jsonb_build_object(
          'folio', 'PRU-2026-9003', 'sucursal', 'AGS', 'fecha', '2026-10-26', 'producto', 'X', 'linea', 'motos', 'estado', 'cerrada')));
    perform pg_temp.yo(); perform pg_temp.anota('con captura la importación está cerrada', false);
  exception when others then
    get stacked diagnostics err = message_text;
    perform pg_temp.yo(); perform pg_temp.anota('con captura la importación está cerrada', err like '%importación está cerrada%', err);
  end;

  -- 7. anon no puede llamar las funciones
  begin
    execute 'set local role anon';
    j := public.bma_importar_empezar();
    perform pg_temp.yo(); perform pg_temp.anota('anon no puede importar', false);
  exception when insufficient_privilege then perform pg_temp.yo(); perform pg_temp.anota('anon no puede importar', true);
  end;
exception when others then
  perform pg_temp.yo();
  perform pg_temp.anota('ERROR inesperado', false, sqlstate || ' ' || sqlerrm);
end $$;

select caso, ok, detalle from r order by n;
rollback;
