-- (bma_egreso_eliminar y bma_categoria_quitar regresan true desde la migración "bma_egresos_respuestas",
-- para que la pantalla distinga "se hizo" de "se canceló".)
-- Egresos: todo el dinero que sale, separado por lo que es. Aplicada como migración "bma_egresos" (20-nov-2026).
--   gasto      sale de la empresa y no regresa. Lleva categoría y a quién se le carga (sucursal o Dirección).
--   traspaso   solo cambia de lugar: caja → banco, subcuenta → principal, sucursal → sucursal. No es gasto.
--   prestamo   sale, pero la persona lo debe regresar. No es gasto.
--   devolucion dinero que se le regresa a un cliente (solo lo importado; en la captura va por Ventas).
-- "Sale de" es la caja o cuenta física de donde salió; "Se carga a" es a quién le toca el gasto
-- (p. ej. la nómina de Puebla pagada con la caja de Aguascalientes). "Autorizó" anota órdenes del jefe (HEBQ).
-- Lo importado que no se pudo leer solo queda con por_aclarar = true hasta que alguien lo corrija.

-- Dirección: área que no es sucursal, para lo que no le toca a ninguna (villa, banquetes…)
insert into bma.sucursales (clave, nombre) values ('DIR', 'Dirección') on conflict do nothing;

create table bma.cuentas (
  clave text primary key,
  nombre text not null,
  tipo text not null check (tipo in ('caja','subcuenta','banco','otra')),
  sucursal text references bma.sucursales(clave),
  activa boolean not null default true,
  orden int not null default 100);

insert into bma.cuentas (clave, nombre, tipo, sucursal, orden)
select 'caja-' || clave, 'Caja ' || nombre, 'caja', clave, 10 from bma.sucursales where clave <> 'DIR';
insert into bma.cuentas (clave, nombre, tipo, sucursal, orden)
select 'sub-' || clave, 'Subcuenta ' || nombre, 'subcuenta', clave, 20 from bma.sucursales where clave <> 'DIR';
insert into bma.cuentas (clave, nombre, tipo, orden) values
  ('hsbc', 'HSBC (principal)', 'banco', 1), ('santander', 'Santander', 'banco', 30), ('banamex', 'Banamex', 'banco', 30),
  ('bbva', 'BBVA', 'banco', 30), ('banorte', 'Banorte', 'banco', 30), ('bajio', 'BanBajío', 'banco', 30),
  ('por-aclarar', 'Cuenta por aclarar', 'otra', 99);

create table bma.categorias_egreso (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  pide text check (pide in ('empleado','vendedor','venta')),   -- dato extra que pide la categoría
  activa boolean not null default true,
  orden int not null default 100);

insert into bma.categorias_egreso (nombre, pide, orden) values
  ('Generales', null, 1), ('Nómina', 'empleado', 2), ('Comisiones', 'vendedor', 3),
  ('Descarga y grúa', null, 4), ('Fletes', null, 5), ('Garantías', 'venta', 6);

create table bma.egresos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('gasto','traspaso','prestamo','devolucion')),
  fecha date not null,
  lunes date not null,                                   -- lunes de la semana del reporte
  monto numeric(12,2) not null check (monto > 0),
  sale_de text not null references bma.cuentas(clave),
  entra_a text references bma.cuentas(clave),
  carga_a text references bma.sucursales(clave),
  categoria_id uuid references bma.categorias_egreso(id),
  concepto text,
  persona_id uuid references bma.personas(id),
  venta_id uuid references bma.ventas(id),
  autorizo text,
  nota text,
  por_aclarar boolean not null default false,
  origen text not null default 'capturada' check (origen in ('importada','capturada')),
  origen_ref jsonb,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  check (tipo <> 'traspaso' or (entra_a is not null and entra_a <> sale_de)),
  check (tipo <> 'gasto' or carga_a is not null),
  check (tipo <> 'gasto' or por_aclarar or categoria_id is not null),
  check (tipo <> 'prestamo' or por_aclarar or persona_id is not null));
create index egresos_lunes on bma.egresos (lunes desc);
create index egresos_carga on bma.egresos (carga_a);

create trigger anotar after insert or update or delete on bma.egresos for each row execute function bma.anotar();
create trigger anotar after insert or update or delete on bma.categorias_egreso for each row execute function bma.anotar();

alter table bma.cuentas enable row level security;
alter table bma.categorias_egreso enable row level security;
alter table bma.egresos enable row level security;
revoke all on bma.cuentas, bma.categorias_egreso, bma.egresos from public, anon, authenticated;

-- ---------------------------------------------------------------- Lectura
-- Catálogos para la captura: categorías, cuentas y a quién se le puede cargar
create function public.bma_egresos_catalogos() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform bma.rol_actual();
  return jsonb_build_object(
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'pide', pide, 'activa', activa,
                     'usos', (select count(*) from bma.egresos e where e.categoria_id = c.id)) order by orden, nombre), '[]')
                   from bma.categorias_egreso c),
    'cuentas', (select coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'nombre', nombre, 'tipo', tipo, 'sucursal', sucursal)
                   order by orden, nombre), '[]') from bma.cuentas where activa),
    'areas', (select coalesce(jsonb_agg(jsonb_build_object('valor', clave, 'nombre', nombre) order by clave = 'DIR', nombre), '[]')
              from bma.sucursales));
end $$;

-- Lista de egresos. p_tipos: los tipos que se quieren ('gasto' o 'traspaso,prestamo,devolucion').
-- La sucursal filtra por a quién se le carga o por la sucursal de la cuenta de donde salió.
create function public.bma_egresos_buscar(p_tipos text, p_q text default '', p_sucursal text default null,
  p_categoria uuid default null, p_aclarar boolean default false, p_limite int default 200) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare q text := bma.sin_acentos(btrim(coalesce(p_q, ''))); out jsonb;
begin
  perform bma.rol_actual();
  with f as (
    select e.*, c.nombre categoria, p.nombre persona, cs.nombre sale_nombre, ce.nombre entra_nombre, cs.sucursal sale_suc,
           v.folio venta_folio, v.remision venta_remision
    from bma.egresos e
    left join bma.categorias_egreso c on c.id = e.categoria_id
    left join bma.personas p on p.id = e.persona_id
    left join bma.cuentas cs on cs.clave = e.sale_de
    left join bma.cuentas ce on ce.clave = e.entra_a
    left join bma.ventas v on v.id = e.venta_id
    where e.tipo = any(string_to_array(p_tipos, ','))
      and (p_sucursal is null or e.carga_a = p_sucursal or cs.sucursal = p_sucursal or ce.sucursal = p_sucursal)
      and (p_categoria is null or e.categoria_id = p_categoria)
      and (not p_aclarar or e.por_aclarar)
      and (q = '' or bma.sin_acentos(concat_ws(' ', e.concepto, e.nota, c.nombre, p.nombre, cs.nombre, ce.nombre, e.autorizo)) like '%' || q || '%'))
  select jsonb_build_object(
    'total', coalesce((select sum(monto) from f), 0),
    'cuantos', (select count(*) from f),
    'por_aclarar', (select count(*) from f where por_aclarar),
    'filas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'fecha', fecha, 'lunes', lunes, 'monto', monto,
       'sale_de', sale_de, 'sale_nombre', sale_nombre, 'entra_a', entra_a, 'entra_nombre', entra_nombre, 'carga_a', carga_a,
       'sale_suc', sale_suc, 'categoria', categoria, 'concepto', concepto, 'persona', persona, 'autorizo', autorizo,
       'venta_folio', venta_folio, 'venta_remision', venta_remision, 'por_aclarar', por_aclarar) order by lunes desc, fecha desc, creado_en desc)
       from (select * from f order by lunes desc, fecha desc, creado_en desc limit p_limite) l), '[]'))
  into out;
  return out;
end $$;

-- Un egreso con sus nombres y sus cambios
create function public.bma_egreso(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare e bma.egresos;
begin
  perform bma.rol_actual();
  select * into e from bma.egresos where id = p_id;
  if not found then raise exception 'No existe ese egreso'; end if;
  return jsonb_build_object(
    'egreso', to_jsonb(e) || jsonb_build_object(
      'categoria', (select nombre from bma.categorias_egreso where id = e.categoria_id),
      'persona', (select jsonb_build_object('id', id, 'nombre', nombre, 'numero', numero) from bma.personas where id = e.persona_id),
      'venta', (select jsonb_build_object('id', id, 'folio', folio, 'producto', producto, 'remision', remision) from bma.ventas where id = e.venta_id),
      'sale_nombre', (select nombre from bma.cuentas where clave = e.sale_de),
      'entra_nombre', (select nombre from bma.cuentas where clave = e.entra_a),
      'carga_nombre', (select nombre from bma.sucursales where clave = e.carga_a)),
    'cambios', (select coalesce(jsonb_agg(jsonb_build_object('accion', b.accion, 'antes', b.antes, 'despues', b.despues,
                  'fecha', b.fecha, 'quien', u.nombre) order by b.fecha), '[]')
                from bma.bitacora b left join bma.usuarios u on u.user_id = b.usuario where b.registro_id = p_id));
end $$;

-- ---------------------------------------------------------------- Captura
-- Alta (sin p.id) o corrección (con p.id). Guardar a mano siempre quita "por aclarar".
create function public.bma_egreso_guardar(p jsonb) returns uuid
language plpgsql security definer set search_path to '' as $$
declare r bma.egresos; cat bma.categorias_egreso; nuevo uuid; f date;
begin
  perform bma.rol_actual();
  r.tipo := p->>'tipo';
  if r.tipo not in ('gasto','traspaso','prestamo') and not (r.tipo = 'devolucion' and p ? 'id') then
    raise exception 'Escoge si es gasto, traspaso o préstamo';
  end if;
  f := coalesce((p->>'fecha')::date, current_date);
  if f > current_date then raise exception 'La fecha no puede ser futura'; end if;
  r.monto := (p->>'monto')::numeric;
  if r.monto is null or r.monto <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  r.sale_de := p->>'sale_de';
  if not exists (select 1 from bma.cuentas where clave = r.sale_de) then raise exception 'Falta de dónde salió el dinero'; end if;
  r.concepto := nullif(btrim(p->>'concepto'), '');
  r.nota := nullif(btrim(p->>'nota'), '');
  r.autorizo := nullif(btrim(p->>'autorizo'), '');
  r.persona_id := nullif(p->>'persona_id', '')::uuid;
  r.venta_id := nullif(p->>'venta_id', '')::uuid;
  if r.tipo = 'gasto' then
    select * into cat from bma.categorias_egreso where id = nullif(p->>'categoria_id', '')::uuid;
    if not found then raise exception 'Falta la categoría'; end if;
    r.categoria_id := cat.id;
    r.carga_a := coalesce(nullif(p->>'carga_a', ''), (select sucursal from bma.cuentas where clave = r.sale_de));
    if r.carga_a is null or not exists (select 1 from bma.sucursales where clave = r.carga_a) then raise exception 'Falta a quién se le carga'; end if;
    if cat.pide in ('empleado','vendedor') and r.persona_id is null then raise exception 'Falta la persona'; end if;
    if r.concepto is null and r.persona_id is null then raise exception 'Falta el concepto'; end if;
  elsif r.tipo = 'traspaso' then
    r.entra_a := p->>'entra_a';
    if not exists (select 1 from bma.cuentas where clave = r.entra_a) then raise exception 'Falta a dónde llegó el dinero'; end if;
    if r.entra_a = r.sale_de then raise exception 'Sale y entra a la misma cuenta'; end if;
    r.persona_id := null; r.venta_id := null;
  elsif r.tipo = 'prestamo' then
    if r.persona_id is null then raise exception 'Falta a quién se le prestó'; end if;
    r.venta_id := null;
  end if;
  if r.tipo <> 'gasto' then r.categoria_id := null; r.carga_a := null; end if;
  if p ? 'id' then
    update bma.egresos set tipo = r.tipo, fecha = f, lunes = bma.lunes(f), monto = r.monto, sale_de = r.sale_de,
      entra_a = r.entra_a, carga_a = r.carga_a, categoria_id = r.categoria_id, concepto = r.concepto, persona_id = r.persona_id,
      venta_id = r.venta_id, autorizo = r.autorizo, nota = r.nota, por_aclarar = false
    where id = (p->>'id')::uuid returning id into nuevo;
    if nuevo is null then raise exception 'No existe ese egreso'; end if;
  else
    insert into bma.egresos (tipo, fecha, lunes, monto, sale_de, entra_a, carga_a, categoria_id, concepto, persona_id, venta_id, autorizo, nota)
    values (r.tipo, f, bma.lunes(f), r.monto, r.sale_de, r.entra_a, r.carga_a, r.categoria_id, r.concepto, r.persona_id, r.venta_id, r.autorizo, r.nota)
    returning id into nuevo;
  end if;
  return nuevo;
end $$;

-- Borrar un egreso capturado por error: solo admin (queda completo en la bitácora)
create function public.bma_egreso_eliminar(p_id uuid) returns boolean
language plpgsql security definer set search_path to '' as $$
begin
  if bma.rol_actual() <> 'admin' then raise exception 'Solo el administrador puede eliminar' using errcode = '42501'; end if;
  delete from bma.egresos where id = p_id;
  if not found then raise exception 'No existe ese egreso'; end if;
  return true;
end $$;

-- Categorías: alta, cambio de nombre o de lo que pide; quitar no borra (se puede volver a poner)
create function public.bma_categoria_guardar(p jsonb) returns uuid
language plpgsql security definer set search_path to '' as $$
declare n text := nullif(btrim(p->>'nombre'), ''); v_pide text := nullif(p->>'pide', ''); out uuid;
begin
  perform bma.rol_actual();
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

create function public.bma_categoria_quitar(p_id uuid, p_quitar boolean default true) returns boolean
language plpgsql security definer set search_path to '' as $$
begin
  perform bma.rol_actual();
  update bma.categorias_egreso set activa = not p_quitar where id = p_id;
  return found;
end $$;

-- Cuenta nueva (otro banco, otra caja): la pueden dar de alta los dos
create function public.bma_cuenta_nueva(p_nombre text, p_tipo text default 'banco', p_sucursal text default null) returns text
language plpgsql security definer set search_path to '' as $$
declare n text := nullif(btrim(p_nombre), ''); c text;
begin
  perform bma.rol_actual();
  if n is null then raise exception 'Falta el nombre'; end if;
  if exists (select 1 from bma.cuentas where bma.sin_acentos(nombre) = bma.sin_acentos(n)) then raise exception 'Ya existe esa cuenta'; end if;
  c := regexp_replace(bma.sin_acentos(n), '[^a-z0-9]+', '-', 'g') || '-' || substr(gen_random_uuid()::text, 1, 4);
  insert into bma.cuentas (clave, nombre, tipo, sucursal) values (c, n, coalesce(p_tipo, 'banco'), p_sucursal);
  return c;
end $$;

revoke all on function public.bma_egresos_catalogos(), public.bma_egresos_buscar(text, text, text, uuid, boolean, int),
  public.bma_egreso(uuid), public.bma_egreso_guardar(jsonb), public.bma_egreso_eliminar(uuid),
  public.bma_categoria_guardar(jsonb), public.bma_categoria_quitar(uuid, boolean), public.bma_cuenta_nueva(text, text, text)
  from public, anon;
grant execute on function public.bma_egresos_catalogos(), public.bma_egresos_buscar(text, text, text, uuid, boolean, int),
  public.bma_egreso(uuid), public.bma_egreso_guardar(jsonb), public.bma_egreso_eliminar(uuid),
  public.bma_categoria_guardar(jsonb), public.bma_categoria_quitar(uuid, boolean), public.bma_cuenta_nueva(text, text, text)
  to authenticated;
