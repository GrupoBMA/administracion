-- Pruebas del inventario de Odoo. Se corren completas con execute_sql; terminan en ROLLBACK y no dejan nada guardado.
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
  cap uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  j jsonb; base jsonb; mov jsonb; ayer date := (now() at time zone 'America/Mexico_City')::date - 2;
begin
  insert into auth.users (id, email, aud, role) values
    (cap, 'prueba-cap@administracion.bma', 'authenticated', 'authenticated'),
    (adm, 'prueba-adm@administracion.bma', 'authenticated', 'authenticated');
  insert into bma.usuarios values (cap, 'Captura prueba', 'captura'), (adm, 'Admin prueba', 'admin');

  base := jsonb_build_object(
    'almacenes', '[{"codigo":"S-PRUEBA","nombre":"Prueba Showroom"}]'::jsonb,
    'productos', '[{"id":99999901,"nombre":"ATV PRUEBA (ROJO)","codigo":"ATV-P","categoria":"SUNL / ATV / 125 cc","unidad":"PZA","seguimiento":"serial"},
                   {"id":99999902,"nombre":"PASTO PRUEBA (2 m)","codigo":"P-X-2M","categoria":"PASTITO / RESIDENCIAL","unidad":"m²","seguimiento":"lot"}]'::jsonb);
  mov := '[{"id":99999801,"fecha":"2026-11-20T18:00:00Z","creado":"2026-11-20T17:59:00Z","modificado":"2026-11-20T18:00:00Z",
            "creo":"Suc. Prueba","modifico":"Suc. Prueba","referencia":"S-PRUEBA/OUT/00001","origen":"S00001","tipo":"Órdenes de entrega",
            "producto_id":99999901,"lote":"SERIE-B / 26 16 1925 6000001","cantidad":1,"de_almacen":"S-PRUEBA","a_almacen":null,
            "de_ubicacion":"S-PRUEBA/Existencias","a_ubicacion":"Customers","de_uso":"internal","a_uso":"customer","cliente":"CLIENTE PRUEBA","venta":"S00001"}]'::jsonb;

  -- Primera copia
  j := public.bma_odoo_guardar(base || jsonb_build_object('quien', 'Prueba', 'movimientos', mov, 'existencias',
    '[{"almacen":"S-PRUEBA","producto_id":99999901,"lote":"SERIE-A / 26 16 1925 6000001","cantidad":1,"llego":"2026-11-07T10:00:00Z"},
      {"almacen":"S-PRUEBA","producto_id":99999902,"lote":"LOTE-PASTO","cantidad":300},
      {"almacen":"S-PRUEBA","producto_id":99999902,"lote":"LOTE-PASTO","cantidad":200}]'::jsonb));
  perform pg_temp.anota('primera copia: 2 existencias (suma por lote) y 1 movimiento nuevo',
    (j->>'existencias')::int = 2 and (j->>'movimientos_nuevos')::int = 1, j::text);
  perform pg_temp.anota('el pasto quedó sumado en 500 m²',
    (select cantidad from bma.odoo_existencias where almacen = 'S-PRUEBA' and producto_id = 99999902 and hasta is null) = 500);

  perform pg_temp.anota('la llegada según Odoo se guarda',
    (select llego from bma.odoo_existencias where lote like 'SERIE-A%') = '2026-11-07T10:00:00Z');

  -- La copia de "hace 5 días"
  update bma.odoo_existencias set desde = now() - interval '5 days' where almacen = 'S-PRUEBA';

  -- Misma copia otra vez: nada cambia (aunque cambie la fecha de llegada)
  j := public.bma_odoo_guardar(base || jsonb_build_object('movimientos', mov, 'existencias',
    '[{"almacen":"S-PRUEBA","producto_id":99999901,"lote":"SERIE-A / 26 16 1925 6000001","cantidad":1,"llego":"2026-11-08T10:00:00Z"},
      {"almacen":"S-PRUEBA","producto_id":99999902,"lote":"LOTE-PASTO","cantidad":500}]'::jsonb));
  perform pg_temp.anota('copia repetida: sin cambios', (j->>'existencias_cambiadas')::int = 0 and (j->>'movimientos_nuevos')::int = 0
    and (j->>'movimientos_cambiados')::int = 0, j::text);

  -- Se vendió la ATV y se cortó pasto; el movimiento lo corrigió otra persona
  j := public.bma_odoo_guardar(base || jsonb_build_object('movimientos',
      jsonb_set(jsonb_set(mov, '{0,cliente}', '"OTRO CLIENTE"'), '{0,modifico}', '"Sistemas"'),
    'existencias', '[{"almacen":"S-PRUEBA","producto_id":99999902,"lote":"LOTE-PASTO","cantidad":434.89}]'::jsonb));
  perform pg_temp.anota('cambios: se cierran 2 y se abre 1', (j->>'existencias_cambiadas')::int = 3, j::text);
  perform pg_temp.anota('movimiento cambiado queda con su antes y después',
    (j->>'movimientos_cambiados')::int = 1 and exists (select 1 from bma.odoo_cambios where movimiento_id = 99999801
       and antes->>'cliente' = 'CLIENTE PRUEBA' and despues->>'cliente' = 'OTRO CLIENTE'));

  -- Captura no puede ver
  perform pg_temp.como(cap);
  begin perform public.bma_odoo_resumen(); perform pg_temp.anota('captura no entra', false);
  exception when others then perform pg_temp.anota('captura no entra', sqlstate = '42501', sqlerrm); end;
  begin perform public.bma_odoo_guardar('{"existencias":[]}'); perform pg_temp.anota('una sesión no puede guardar la copia', false);
  exception when others then perform pg_temp.anota('una sesión no puede guardar la copia', sqlstate = '42501', sqlerrm); end;

  -- Admin: hoy y hace dos días
  perform pg_temp.como(adm);
  j := public.bma_odoo_existencias('S-PRUEBA');
  perform pg_temp.anota('hoy: solo el pasto con 434.89', jsonb_array_length(j) = 1 and (j->0->>'cantidad')::numeric = 434.89, j::text);
  j := public.bma_odoo_existencias('S-PRUEBA', ayer);
  perform pg_temp.anota('hace dos días: la ATV y 500 m²', jsonb_array_length(j) = 2
    and exists (select 1 from jsonb_array_elements(j) x where x->>'lote' like 'SERIE-A%')
    and exists (select 1 from jsonb_array_elements(j) x where (x->>'cantidad')::numeric = 500), j::text);
  j := public.bma_odoo_resumen();
  perform pg_temp.anota('resumen: S-PRUEBA con 434.89 m² y 0 vehículos',
    exists (select 1 from jsonb_array_elements(j->'almacenes') a where a->>'codigo' = 'S-PRUEBA'
            and (a->>'pasto')::numeric = 434.89 and (a->>'vehiculos')::numeric = 0), j::text);
  j := public.bma_odoo_serie('serie-b');
  perform pg_temp.anota('buscar serie sin espacios ni mayúsculas', jsonb_array_length(j) = 1
    and jsonb_array_length(j->0->'movimientos') = 1, j::text);
  j := public.bma_odoo_revisar('pendiente');
  perform pg_temp.anota('alerta del cambio', exists (select 1 from jsonb_array_elements(j) a where a->>'tipo' = 'cambio' and a->>'almacen' = 'S-PRUEBA'), j::text);
  perform pg_temp.anota('marcar como revisada regresa true', public.bma_odoo_revisado((select a->>'clave' from jsonb_array_elements(j) a where a->>'tipo' = 'cambio' and a->>'almacen' = 'S-PRUEBA' limit 1), 'lo pedí yo') = true);
  j := public.bma_odoo_revisar('revisado');
  perform pg_temp.anota('marcada como revisada, con nota y quién', exists (select 1 from jsonb_array_elements(j) a
    where a->>'tipo' = 'cambio' and a->>'nota' = 'lo pedí yo' and a->>'quien' = 'Admin prueba'), j::text);
  perform pg_temp.yo();
end $$;

select n, caso, ok, case when ok then null else detalle end as detalle from r order by n;
rollback;
