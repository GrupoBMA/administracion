-- Categorías de gasto: solo el admin las agrega, renombra o quita (23-nov-2026).
-- Se manejan en Configuración → Categorías de gasto, que solo ve el admin; en la captura solo se escogen.
-- Misma firma y lógica que en 2026-11-20-bma-egresos.sql; lo único nuevo es el candado de admin.

create or replace function public.bma_categoria_guardar(p jsonb) returns uuid
language plpgsql security definer set search_path to '' as $$
declare n text := nullif(btrim(p->>'nombre'), ''); v_pide text := nullif(p->>'pide', ''); out uuid;
begin
  if bma.rol_actual() <> 'admin' then raise exception 'Solo el administrador puede cambiar las categorías' using errcode = '42501'; end if;
  if n is null then raise exception 'Falta el nombre'; end if;
  if v_pide is not null and v_pide not in ('empleado','vendedor','venta') then raise exception 'Dato extra no válido'; end if;
  if exists (select 1 from bma.categorias_egreso where bma.sin_acentos(nombre) = bma.sin_acentos(n)
             and id is distinct from nullif(p->>'id', '')::uuid) then
    raise exception 'Ya existe una categoría con ese nombre';
  end if;
  if p ? 'id' then
    update bma.categorias_egreso set nombre = n, pide = case when p ? 'pide' then v_pide else categorias_egreso.pide end
    where id = (p->>'id')::uuid returning id into out;
  else
    insert into bma.categorias_egreso (nombre, pide) values (n, v_pide) returning id into out;
  end if;
  return out;
end $$;

create or replace function public.bma_categoria_quitar(p_id uuid, p_quitar boolean default true) returns boolean
language plpgsql security definer set search_path to '' as $$
begin
  if bma.rol_actual() <> 'admin' then raise exception 'Solo el administrador puede cambiar las categorías' using errcode = '42501'; end if;
  update bma.categorias_egreso set activa = not p_quitar where id = p_id;
  return found;
end $$;
