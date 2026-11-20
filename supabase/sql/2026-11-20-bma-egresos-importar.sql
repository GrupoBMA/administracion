-- Importación de los egresos de 2026 (importar/egresos.py → .local/importacion/egresos.json).
-- Función TEMPORAL: se creó como migración "bma_egresos_importar", se llamó una vez desde el navegador
-- (en localhost, con la sesión abierta) y se borró enseguida con "bma_egresos_importar_quitar" (abajo).
-- Así los datos reales no pasan por el repo ni por la conversación. Si hay que repetirla, volver a crearla.
-- Solo corre mientras no haya egresos capturados a mano ni cambios de egresos en la bitácora.

create function public.bma_importar_egresos(p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare n_pe int; n_eg int; borrados int;
begin
  if bma.rol_actual() not in ('admin','captura') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if exists (select 1 from bma.egresos where origen = 'capturada') or exists (select 1 from bma.bitacora where tabla = 'egresos') then
    raise exception 'ya hay egresos capturados: la importación de egresos está cerrada';
  end if;
  perform set_config('bma.importando', 'si', true);
  delete from bma.egresos where origen = 'importada'; get diagnostics borrados = row_count;
  insert into bma.personas (id, nombre, tipos, sucursal, origen)
  select (x->>'id')::uuid, x->>'nombre', array(select jsonb_array_elements_text(x->'tipos')), x->>'sucursal', 'importada'
  from jsonb_array_elements(p->'personas') x
  on conflict (id) do nothing;
  get diagnostics n_pe = row_count;
  update bma.personas pe set tipos = array_append(pe.tipos, x->>'tipo')
  from jsonb_array_elements(p->'agregar_tipo') x
  where pe.id = (x->>'id')::uuid and not ((x->>'tipo') = any(pe.tipos));
  insert into bma.egresos (tipo, fecha, lunes, monto, sale_de, entra_a, carga_a, categoria_id, concepto, persona_id,
                           venta_id, autorizo, nota, por_aclarar, origen, origen_ref)
  select x->>'tipo', coalesce((x->>'fecha')::date, (x->>'lunes')::date), (x->>'lunes')::date, (x->>'monto')::numeric, x->>'sale_de', x->>'entra_a',
         x->>'carga_a', (select c.id from bma.categorias_egreso c where c.nombre = x->>'categoria'), x->>'concepto',
         nullif(x->>'persona_id', '')::uuid,
         (select v.id from bma.ventas v where v.sucursal = x->>'sucursal' and x->>'remision' is not null
            and bma.num_remision(v.remision) = x->>'remision' order by v.fecha desc limit 1),
         x->>'autorizo', x->>'nota', (x->>'por_aclarar')::boolean, 'importada', x->'origen_ref'
  from jsonb_array_elements(p->'egresos') x;
  get diagnostics n_eg = row_count;
  return jsonb_build_object('borrados_antes', borrados, 'personas_nuevas', n_pe, 'egresos', n_eg,
    'total', (select sum(monto) from bma.egresos where origen = 'importada'),
    'por_aclarar', (select count(*) from bma.egresos where origen = 'importada' and por_aclarar),
    'garantias_ligadas', (select count(*) from bma.egresos where origen = 'importada' and venta_id is not null));
end $$;
revoke all on function public.bma_importar_egresos(jsonb) from public, anon;
grant execute on function public.bma_importar_egresos(jsonb) to authenticated;

-- Al terminar ("bma_egresos_importar_quitar"):
-- drop function public.bma_importar_egresos(jsonb);
