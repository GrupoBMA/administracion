-- Pruebas de quitar personas de las listas (sin borrarlas). execute_sql; termina en ROLLBACK.
begin;
create temp table r (n serial, caso text, ok boolean, detalle text);
grant all on r to authenticated; grant all on sequence r_n_seq to authenticated;
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
declare cap uuid := gen_random_uuid(); p uuid; j jsonb; err text;
begin
  insert into auth.users (id, email, aud, role) values (cap, 'prueba-cap@administracion.bma', 'authenticated', 'authenticated');
  insert into bma.usuarios values (cap, 'Captura prueba', 'captura');
  perform pg_temp.como(cap);
  p := public.bma_persona_guardar(jsonb_build_object('nombre', 'Empleadoprueba Xyz', 'tipos', jsonb_build_array('empleado')));
  perform public.bma_persona_quitar(p);
  j := public.bma_personas_buscar('empleadoprueba', 'empleado');
  perform pg_temp.anota('quitada no sale en la lista', jsonb_array_length(j) = 0, j::text);
  j := public.bma_personas_buscar('empleadoprueba', 'empleado', true);
  perform pg_temp.anota('con ocultas sí sale y marcada', jsonb_array_length(j) = 1 and (j->0->>'activa')::boolean = false, j::text);
  j := public.bma_persona(p);
  perform pg_temp.anota('su ficha sigue existiendo', j->'persona'->>'nombre' = 'Empleadoprueba Xyz');
  perform public.bma_persona_quitar(p, false);
  j := public.bma_personas_buscar('empleadoprueba', 'empleado');
  perform pg_temp.anota('se puede volver a poner', jsonb_array_length(j) = 1);
  perform pg_temp.yo();
  perform pg_temp.anota('quitar queda en la bitácora',
    (select count(*) from bma.bitacora where registro_id = p and accion = 'cambio') = 2);
exception when others then
  perform pg_temp.yo();
  perform pg_temp.anota('ERROR inesperado', false, sqlstate || ' ' || sqlerrm);
end $$;
select caso, ok, left(detalle, 120) detalle from r order by n;
rollback;
