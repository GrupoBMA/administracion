-- Pruebas de egresos. Se corren completas con execute_sql; terminan en ROLLBACK y no dejan nada guardado.
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
  emp uuid; nom uuid; gen uuid; e1 uuid; e2 uuid; e3 uuid; j jsonb; err text; c text;
begin
  insert into auth.users (id, email, aud, role) values
    (sin, 'prueba-sin@administracion.bma', 'authenticated', 'authenticated'),
    (cap, 'prueba-cap@administracion.bma', 'authenticated', 'authenticated'),
    (adm, 'prueba-adm@administracion.bma', 'authenticated', 'authenticated');
  insert into bma.usuarios values (cap, 'Captura prueba', 'captura'), (adm, 'Admin prueba', 'admin');
  insert into bma.personas (nombre, tipos) values ('EMPLEADO PRUEBA EGRESO', '{empleado}') returning id into emp;
  select id into nom from bma.categorias_egreso where nombre = 'Nómina';
  select id into gen from bma.categorias_egreso where nombre = 'Generales';

  -- Sin cuenta dada de alta no entra
  perform pg_temp.como(sin);
  begin perform public.bma_egresos_catalogos(); perform pg_temp.anota('sin acceso', false);
  exception when others then perform pg_temp.anota('sin acceso', sqlstate = '42501', sqlerrm); end;

  perform pg_temp.como(cap);
  j := public.bma_egresos_catalogos();
  perform pg_temp.anota('catálogos: 6 categorías, Dirección en áreas',
    jsonb_array_length(j->'categorias') >= 6 and (j->'areas') @> '[{"valor":"DIR"}]', null);

  -- Gasto: nómina de Puebla pagada con la caja de Aguascalientes
  e1 := public.bma_egreso_guardar(jsonb_build_object('tipo', 'gasto', 'monto', 8400, 'sale_de', 'caja-AGS', 'carga_a', 'PUE',
          'categoria_id', nom, 'persona_id', emp, 'autorizo', 'HEBQ', 'fecha', '2026-06-03'));
  perform pg_temp.yo();
  perform pg_temp.anota('gasto con carga a otra sucursal',
    (select carga_a = 'PUE' and sale_de = 'caja-AGS' and lunes = '2026-06-01' from bma.egresos where id = e1), null);
  -- Sin "se carga a": toma la sucursal de la caja
  e2 := public.bma_egreso_guardar(jsonb_build_object('tipo', 'gasto', 'monto', 300, 'sale_de', 'caja-TEP', 'categoria_id', gen, 'concepto', 'GASOLINA PRUEBA'));
  perform pg_temp.anota('carga a por omisión', (select carga_a = 'TEP' from bma.egresos where id = e2), null);
  perform pg_temp.como(cap);
  -- Nómina sin persona: no
  begin perform public.bma_egreso_guardar(jsonb_build_object('tipo', 'gasto', 'monto', 1, 'sale_de', 'caja-TEP', 'categoria_id', nom, 'concepto', 'x'));
    perform pg_temp.anota('nómina pide persona', false);
  exception when others then perform pg_temp.anota('nómina pide persona', sqlerrm = 'Falta la persona', sqlerrm); end;
  -- Traspaso a la misma cuenta: no
  begin perform public.bma_egreso_guardar(jsonb_build_object('tipo', 'traspaso', 'monto', 5, 'sale_de', 'caja-TEP', 'entra_a', 'caja-TEP'));
    perform pg_temp.anota('traspaso misma cuenta', false);
  exception when others then perform pg_temp.anota('traspaso misma cuenta', sqlerrm = 'Sale y entra a la misma cuenta', sqlerrm); end;
  e3 := public.bma_egreso_guardar(jsonb_build_object('tipo', 'traspaso', 'monto', 90000, 'sale_de', 'caja-TEP', 'entra_a', 'santander',
          'categoria_id', gen, 'carga_a', 'TEP'));
  perform pg_temp.yo();
  perform pg_temp.anota('traspaso no lleva categoría ni carga',
    (select categoria_id is null and carga_a is null from bma.egresos where id = e3), null);
  perform pg_temp.como(cap);
  -- Fecha futura: no
  begin perform public.bma_egreso_guardar(jsonb_build_object('tipo', 'gasto', 'monto', 1, 'sale_de', 'caja-TEP', 'categoria_id', gen,
          'concepto', 'x', 'fecha', current_date + 3));
    perform pg_temp.anota('fecha futura', false);
  exception when others then perform pg_temp.anota('fecha futura', sqlerrm = 'La fecha no puede ser futura', sqlerrm); end;

  perform pg_temp.como(cap);
  -- Buscar: los gastos de Puebla incluyen la nómina pagada en AGS; los traspasos van aparte
  j := public.bma_egresos_buscar('gasto', 'empleado prueba egreso', 'PUE');
  perform pg_temp.anota('buscar gasto por carga', (j->>'cuantos')::int = 1 and (j->>'total')::numeric = 8400, j::text);
  j := public.bma_egresos_buscar('traspaso,prestamo,devolucion', '', 'TEP');
  perform pg_temp.anota('traspaso en otros', exists (select 1 from jsonb_array_elements(j->'filas') x where x->>'id' = e3::text), null);

  -- Corregir quita "por aclarar" y queda en la bitácora
  perform pg_temp.yo();
  perform set_config('bma.importando', 'si', true);
  update bma.egresos set por_aclarar = true where id = e2;
  perform set_config('bma.importando', '', true);
  perform pg_temp.como(cap);
  perform public.bma_egreso_guardar(jsonb_build_object('id', e2, 'tipo', 'gasto', 'monto', 350, 'sale_de', 'caja-TEP', 'categoria_id', gen, 'concepto', 'GASOLINA PRUEBA'));
  j := public.bma_egreso(e2);
  perform pg_temp.anota('corregir: monto, sin aclarar y bitácora',
    (j->'egreso'->>'monto')::numeric = 350 and not (j->'egreso'->>'por_aclarar')::boolean and jsonb_array_length(j->'cambios') >= 2, null);

  -- Captura no elimina; admin sí
  begin perform public.bma_egreso_eliminar(e2); perform pg_temp.anota('captura no elimina', false);
  exception when others then perform pg_temp.anota('captura no elimina', sqlstate = '42501', sqlerrm); end;
  perform pg_temp.como(adm);
  perform public.bma_egreso_eliminar(e2);
  perform pg_temp.yo();
  perform pg_temp.anota('admin elimina', not exists (select 1 from bma.egresos where id = e2), null);

  -- Categorías: no repetir nombre (sin acentos), quitar sin borrar
  perform pg_temp.como(cap);
  begin perform public.bma_categoria_guardar('{"nombre":"nomina"}'); perform pg_temp.anota('categoría repetida', false);
  exception when others then perform pg_temp.anota('categoría repetida', sqlerrm = 'Ya existe una categoría con ese nombre', sqlerrm); end;
  perform public.bma_categoria_quitar(gen);
  perform pg_temp.yo();
  perform pg_temp.anota('quitar categoría', (select not activa from bma.categorias_egreso where id = gen), null);
  perform pg_temp.como(cap);
  c := public.bma_cuenta_nueva('Banco Prueba Egresos');
  perform pg_temp.yo();
  perform pg_temp.anota('cuenta nueva', exists (select 1 from bma.cuentas where clave = c), c);
end $$;

reset role;
select n, caso, ok, detalle from r order by n;
rollback;
