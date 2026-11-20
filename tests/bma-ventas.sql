-- Pruebas de consultar y capturar ventas, personas y dudas. Se corren completas con execute_sql;
-- terminan en ROLLBACK y no dejan nada guardado. Datos inventados; conviven con lo importado,
-- así que usan textos y números que no existen en los datos reales (TIJ, PRODUCTOPRUEBA…).
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
  sin uuid := gen_random_uuid(); cap uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  cli uuid; numcli int; v1 uuid; v2 uuid; v3 uuid; m uuid; j jsonb; err text; n int; dud uuid; mov uuid;
begin
  insert into auth.users (id, email, aud, role) values
    (sin, 'prueba-sin@administracion.bma', 'authenticated', 'authenticated'),
    (cap, 'prueba-cap@administracion.bma', 'authenticated', 'authenticated'),
    (adm, 'prueba-adm@administracion.bma', 'authenticated', 'authenticated');
  insert into bma.usuarios values (cap, 'Captura prueba', 'captura'), (adm, 'Admin prueba', 'admin');
  insert into bma.ventas (folio, sucursal, fecha, producto, linea, estado, origen)
    values ('TIJ-2026-0007', 'TIJ', '2026-11-02', 'PRODUCTOPRUEBA VIEJO', 'motos', 'cerrada', 'importada');

  -- 1. sin alta no busca
  begin
    perform pg_temp.como(sin); j := public.bma_ventas_buscar('x');
    perform pg_temp.yo(); perform pg_temp.anota('sin alta no busca', false);
  exception when sqlstate '42501' then perform pg_temp.yo(); perform pg_temp.anota('sin alta no busca', true);
  end;

  -- 2. persona nueva toma número
  perform pg_temp.como(cap);
  cli := public.bma_persona_guardar(jsonb_build_object('nombre', 'Cliénte Pruebaxyz', 'tipos', jsonb_build_array('cliente')));
  perform pg_temp.yo();
  select numero into numcli from bma.personas where id = cli;
  perform pg_temp.anota('persona nueva toma número', numcli is not null);

  -- 3. venta nueva de contado: folio siguiente, cerrada, precio = monto
  perform pg_temp.como(cap);
  j := public.bma_venta_nueva(jsonb_build_object('sucursal', 'TIJ', 'fecha', '2026-11-16', 'producto', 'PRODUCTOPRUEBA ATV',
        'linea', 'motos', 'cliente_id', cli, 'remision', 'NV 987654',
        'movimiento', jsonb_build_object('tipo', 'contado', 'monto', 41000, 'metodo', 'transferencia', 'fecha', '2026-11-16')));
  perform pg_temp.yo();
  v1 := (j->>'id')::uuid;
  perform pg_temp.anota('venta de contado: folio siguiente, cerrada y precio',
    j->>'folio' = 'TIJ-2026-0008' and (select estado from bma.ventas where id = v1) = 'cerrada'
    and (select precio_total from bma.ventas where id = v1) = 41000, j::text);

  -- 4. el siguiente folio sigue la cuenta
  perform pg_temp.como(cap);
  j := public.bma_venta_nueva(jsonb_build_object('sucursal', 'TIJ', 'fecha', '2026-11-17', 'producto', 'PRODUCTOPRUEBA MC',
        'linea', 'motos', 'precio_total', 30000,
        'movimiento', jsonb_build_object('tipo', 'anticipo', 'monto', 10000, 'metodo', 'efectivo', 'fecha', '2026-11-17')));
  perform pg_temp.yo();
  v2 := (j->>'id')::uuid;
  perform pg_temp.anota('folio siguiente con candado', j->>'folio' = 'TIJ-2026-0009', j::text);
  perform pg_temp.anota('anticipo deja abierta', (select estado from bma.ventas where id = v2) = 'abierta');

  -- 5. abono deja abierta; liquidación cierra aunque falte saldo
  perform pg_temp.como(cap);
  m := public.bma_movimiento_nuevo(v2, jsonb_build_object('tipo', 'abono', 'monto', 5000, 'metodo', 'tarjeta', 'fecha', '2026-11-18'));
  perform pg_temp.yo();
  perform pg_temp.anota('abono deja abierta', (select estado from bma.ventas where id = v2) = 'abierta');
  perform pg_temp.como(cap);
  m := public.bma_movimiento_nuevo(v2, jsonb_build_object('tipo', 'liquidacion', 'monto', 10000, 'metodo', 'efectivo', 'fecha', '2026-11-19'));
  j := public.bma_venta(v2);
  perform pg_temp.yo();
  perform pg_temp.anota('liquidación cierra aunque falte saldo',
    j->'venta'->>'estado' = 'cerrada' and (j->'venta'->>'precio_total')::numeric = 30000
    and (j->'venta'->>'pagado')::numeric = 25000 and jsonb_array_length(j->'movimientos') = 3
    and j->'movimientos'->0->>'quien' = 'Captura prueba', (j->'venta')::text);

  -- 6. devolución resta
  perform pg_temp.como(cap);
  m := public.bma_movimiento_nuevo(v1, jsonb_build_object('tipo', 'devolucion', 'monto', 300, 'metodo', 'efectivo', 'fecha', '2026-11-19'));
  j := public.bma_venta(v1);
  perform pg_temp.yo();
  perform pg_temp.anota('devolución resta', (j->'venta'->>'pagado')::numeric = 40700, j->'venta'->>'pagado');

  -- 7. cancelación cancela y luego no acepta dinero
  perform pg_temp.como(cap);
  j := public.bma_venta_nueva(jsonb_build_object('sucursal', 'TIJ', 'fecha', '2026-11-18', 'producto', 'PRODUCTOPRUEBA CANCELA',
        'linea', 'pasto', 'movimiento', jsonb_build_object('tipo', 'anticipo', 'monto', 2000, 'metodo', 'efectivo', 'fecha', '2026-11-18')));
  v3 := (j->>'id')::uuid;
  m := public.bma_movimiento_nuevo(v3, jsonb_build_object('tipo', 'cancelacion', 'fecha', '2026-11-19'));
  perform pg_temp.yo();
  perform pg_temp.anota('cancelación cancela', (select estado from bma.ventas where id = v3) = 'cancelada');
  begin
    perform pg_temp.como(cap);
    m := public.bma_movimiento_nuevo(v3, jsonb_build_object('tipo', 'abono', 'monto', 100, 'metodo', 'efectivo', 'fecha', '2026-11-19'));
    perform pg_temp.yo(); perform pg_temp.anota('no acepta dinero en venta cancelada', false);
  exception when others then
    get stacked diagnostics err = message_text;
    perform pg_temp.yo(); perform pg_temp.anota('no acepta dinero en venta cancelada', err like '%cancelada%', err);
  end;

  -- 8. contado sin monto se rechaza
  begin
    perform pg_temp.como(cap);
    j := public.bma_venta_nueva(jsonb_build_object('sucursal', 'TIJ', 'fecha', '2026-11-18', 'producto', 'X', 'linea', 'motos',
          'movimiento', jsonb_build_object('tipo', 'contado', 'monto', 0)));
    perform pg_temp.yo(); perform pg_temp.anota('venta nueva rechaza monto 0', false);
  exception when others then
    get stacked diagnostics err = message_text;
    perform pg_temp.yo(); perform pg_temp.anota('venta nueva rechaza monto 0', err like '%monto%', err);
  end;

  -- 9. búsquedas
  perform pg_temp.como(cap);
  j := public.bma_ventas_buscar('987654');
  perform pg_temp.anota('buscar 987654 encuentra la remisión NV 987654', j @> jsonb_build_array(jsonb_build_object('id', v1)));
  j := public.bma_ventas_buscar('nv 987654');
  perform pg_temp.anota('buscar "nv 987654" también', j @> jsonb_build_array(jsonb_build_object('id', v1)));
  j := public.bma_ventas_buscar(numcli::text);
  perform pg_temp.anota('buscar por número de cliente', j @> jsonb_build_array(jsonb_build_object('id', v1)));
  j := public.bma_ventas_buscar('cliente pruebaxyz');
  perform pg_temp.anota('buscar sin acento encuentra con acento', j @> jsonb_build_array(jsonb_build_object('id', v1)));
  j := public.bma_ventas_buscar('productoprueba', 'TIJ', 'abierta');
  perform pg_temp.anota('filtros de sucursal y estado', jsonb_array_length(j) = 0);
  j := public.bma_ventas_buscar('productoprueba', 'TIJ', null);
  perform pg_temp.anota('sin filtro de estado trae las 4', jsonb_array_length(j) = 4, jsonb_array_length(j)::text);
  perform pg_temp.yo();

  -- 10. editar cliente queda en bitácora y la ficha trae el nombre
  perform pg_temp.como(cap);
  perform public.bma_venta_editar(v2, jsonb_build_object('cliente_id', cli));
  j := public.bma_venta(v2);
  perform pg_temp.yo();
  perform pg_temp.anota('editar cliente queda en bitácora con nombre',
    j->'venta'->'cliente'->>'nombre' = 'Cliénte Pruebaxyz'
    and exists (select 1 from jsonb_array_elements(j->'cambios') c
                where c->>'accion' = 'cambio' and c->'antes'->>'cliente_id' is null and c->'despues'->>'cliente_id' = cli::text)
    and j->'nombres'->>(cli::text) = 'Cliénte Pruebaxyz', j::text);

  -- 11. corregir movimiento recalcula
  select id into mov from bma.movimientos where venta_id = v2 and tipo = 'liquidacion';
  perform pg_temp.como(cap);
  perform public.bma_movimiento_corregir(mov, jsonb_build_object('monto', 15000, 'confirmado_banco', true));
  j := public.bma_venta(v2);
  perform pg_temp.yo();
  perform pg_temp.anota('corregir monto recalcula', (j->'venta'->>'pagado')::numeric = 30000);

  -- 12. captura no elimina; admin sí y recalcula
  begin
    perform pg_temp.como(cap); perform public.bma_movimiento_eliminar(mov);
    perform pg_temp.yo(); perform pg_temp.anota('captura no puede eliminar', false);
  exception when sqlstate '42501' then perform pg_temp.yo(); perform pg_temp.anota('captura no puede eliminar', true);
  end;
  perform pg_temp.como(adm); perform public.bma_movimiento_eliminar(mov); perform pg_temp.yo();
  perform pg_temp.anota('admin elimina y la venta vuelve a abierta',
    (select estado from bma.ventas where id = v2) = 'abierta' and not exists (select 1 from bma.movimientos where id = mov));

  -- 13. ficha de persona lista sus compras
  perform pg_temp.como(cap); j := public.bma_persona(cli); perform pg_temp.yo();
  perform pg_temp.anota('ficha de persona lista sus compras', jsonb_array_length(j->'compras') = 2, jsonb_array_length(j->'compras')::text);
  perform pg_temp.como(cap); j := public.bma_personas_buscar('pruebaxyz', 'cliente'); perform pg_temp.yo();
  perform pg_temp.anota('buscar persona', jsonb_array_length(j) = 1 and (j->0->>'ventas')::int = 2, j::text);

  -- 14. resolver duda uniendo: el movimiento pasa a la otra venta y la vacía se borra
  insert into bma.ventas (folio, sucursal, fecha, producto, linea, estado, origen)
    values ('TIJ-2026-0001', 'TIJ', '2026-11-03', 'PRODUCTOPRUEBA SUELTA', 'motos', 'cerrada', 'importada') returning id into v3;
  insert into bma.movimientos (venta_id, fecha, lunes, tipo, monto, origen) values (v3, '2026-11-03', '2026-11-02', 'liquidacion', 20000, 'importada')
    returning id into mov;
  insert into bma.dudas_importacion (venta_id, movimiento_id, motivo, detalle) values (v3, mov, 'sin_anticipo', 'prueba') returning id into dud;
  perform pg_temp.como(cap); perform public.bma_duda_resolver(dud, v2, 'era de esta venta'); perform pg_temp.yo();
  perform pg_temp.anota('resolver uniendo mueve el movimiento, recalcula y borra la vacía',
    (select venta_id from bma.movimientos where id = mov) = v2 and (select estado from bma.ventas where id = v2) = 'cerrada'
    and not exists (select 1 from bma.ventas where id = v3)
    and (select estado from bma.dudas_importacion where id = dud) = 'resuelta'
    and (select detalle from bma.dudas_importacion where id = dud) like '%era de esta venta%');
  perform pg_temp.como(cap); j := public.bma_dudas('resuelta'); perform pg_temp.yo();
  perform pg_temp.anota('lista de dudas resueltas', j @> jsonb_build_array(jsonb_build_object('id', dud)));

  -- 15. con algo capturado o resuelto, la importación queda cerrada
  begin
    perform pg_temp.como(adm); j := public.bma_importar_empezar();
    perform pg_temp.yo(); perform pg_temp.anota('capturar cierra la importación', false);
  exception when others then
    get stacked diagnostics err = message_text;
    perform pg_temp.yo(); perform pg_temp.anota('capturar cierra la importación', err like '%importación está cerrada%', err);
  end;
exception when others then
  perform pg_temp.yo();
  perform pg_temp.anota('ERROR inesperado', false, sqlstate || ' ' || sqlerrm);
end $$;

select caso, ok, detalle from r order by n;
rollback;
