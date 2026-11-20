-- Quitar personas de las listas sin borrarlas (su historial se sigue viendo). Migración "bma_personas_quitar".
-- Silvia y el admin pueden quitar y volver a poner (decisión del usuario, 20-nov-2026); queda en la bitácora.
alter table bma.personas add column activa boolean not null default true;

create function public.bma_persona_quitar(p_id uuid, p_quitar boolean default true) returns void
language plpgsql security definer set search_path to '' as $$
begin
  perform bma.rol_actual();
  update bma.personas set activa = not p_quitar where id = p_id and activa = p_quitar;
end $$;

drop function public.bma_personas_buscar(text, text);
create function public.bma_personas_buscar(p_q text, p_tipo text default null, p_incluir_ocultas boolean default false) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare q text := bma.sin_acentos(btrim(coalesce(p_q, ''))); dig text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g'); out jsonb;
begin
  perform bma.rol_actual();
  select coalesce(jsonb_agg(x order by s.nombre), '[]') into out from (
    select p.nombre, jsonb_build_object('id', p.id, 'numero', p.numero, 'nombre', p.nombre, 'tipos', p.tipos,
      'telefono', p.telefono, 'sucursal', p.sucursal, 'activa', p.activa,
      'ventas', (select count(*) from bma.ventas where cliente_id = p.id),
      'vendidas', (select count(*) from bma.ventas where vendedor_id = p.id)) x
    from bma.personas p
    where (p_tipo is null or p_tipo = any(p.tipos)) and (p.activa or p_incluir_ocultas)
      and (q = '' or bma.sin_acentos(p.nombre) like '%' || q || '%' or (dig <> '' and p.numero::text = ltrim(dig, '0')))
    order by p.nombre limit 300) s;
  return out;
end $$;

revoke all on function public.bma_persona_quitar(uuid, boolean), public.bma_personas_buscar(text, text, boolean) from public, anon;
grant execute on function public.bma_persona_quitar(uuid, boolean), public.bma_personas_buscar(text, text, boolean) to authenticated;
