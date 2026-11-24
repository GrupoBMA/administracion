-- Inventario Odoo (24-nov-2026): copia de solo lectura de las existencias y movimientos de Odoo.
-- Aplicada como migración "bma_odoo". La llena la función de Supabase "bma-odoo" (cada noche y con "Actualizar").
-- * Existencias: se guardan SOLO LOS CAMBIOS. Cada renglón dice desde cuándo y hasta cuándo hubo esa cantidad de un
--   producto (y su serie o lote) en un almacén; así se ve el inventario de cualquier día sin copiar todo cada noche.
-- * Movimientos: un renglón por renglón de movimiento de Odoo (stock.move.line). Si Odoo lo cambia después,
--   el antes y el después quedan en bma.odoo_cambios.
-- * Nadie lee las tablas directo: el admin entra por funciones public.bma_odoo_*; la función de Supabase escribe con
--   public.bma_odoo_guardar, que solo puede usar service_role.

create table bma.odoo_almacenes (
  codigo text primary key,                 -- S-AGS, S-WAS, S-BD1…
  nombre text not null,
  actualizado timestamptz not null default now());

create table bma.odoo_productos (
  id int primary key,                      -- product.product de Odoo
  nombre text not null,
  codigo text,
  categoria text,                          -- "SUNL / ATV / 125 cc"
  unidad text,                             -- PZA, m²
  seguimiento text,                        -- serial, lot, none
  actualizado timestamptz not null default now());

create table bma.odoo_existencias (
  id bigserial primary key,
  almacen text not null references bma.odoo_almacenes(codigo),
  producto_id int not null references bma.odoo_productos(id),
  lote text not null default '',           -- número de serie (con su pedimento) o lote; '' si no lleva
  cantidad numeric not null,
  desde timestamptz not null,
  hasta timestamptz,                       -- null = así está hoy
  llego timestamptz,                       -- cuándo llegó a ese lugar según Odoo (stock.quant.in_date); no cuenta como cambio
  check (hasta is null or hasta >= desde));
create unique index odoo_existencias_abierta on bma.odoo_existencias (almacen, producto_id, lote) where hasta is null;
create index odoo_existencias_lote on bma.odoo_existencias (lote) where lote <> '';
create index odoo_existencias_fechas on bma.odoo_existencias (almacen, desde, hasta);

create table bma.odoo_movimientos (
  id int primary key,                      -- stock.move.line de Odoo
  fecha timestamptz not null,              -- cuando se validó en Odoo
  creado timestamptz, modificado timestamptz,
  creo text, modifico text,                -- usuario de Odoo
  referencia text, origen text, tipo text, -- S-AGS/OUT/00046, S00542, "…: Órdenes de entrega"
  producto_id int references bma.odoo_productos(id),
  lote text not null default '',
  cantidad numeric not null,
  de_almacen text, a_almacen text,         -- código del almacén, o null si es de fuera (cliente, proveedor, ajuste)
  de_ubicacion text, a_ubicacion text,
  de_uso text, a_uso text,                 -- internal, customer, supplier, inventory, transit…
  cliente text, venta text,
  visto timestamptz not null default now(),
  cambios int not null default 0);
create index odoo_movimientos_fecha on bma.odoo_movimientos (fecha desc);
create index odoo_movimientos_lote on bma.odoo_movimientos (lote) where lote <> '';
create index odoo_movimientos_de on bma.odoo_movimientos (de_almacen, fecha desc);
create index odoo_movimientos_a on bma.odoo_movimientos (a_almacen, fecha desc);

create table bma.odoo_cambios (
  id bigserial primary key,
  movimiento_id int not null references bma.odoo_movimientos(id),
  antes jsonb not null, despues jsonb not null,
  visto timestamptz not null default now());

create table bma.odoo_copias (
  id bigserial primary key,
  inicio timestamptz not null, fin timestamptz not null default now(),
  quien text not null,                     -- nombre del admin o "Copia automática"
  existencias int, existencias_cambiadas int, movimientos_nuevos int, movimientos_cambiados int);

create table bma.odoo_revisados (
  clave text primary key,                  -- clave estable de la alerta (tipo:dato)
  quien text not null, nota text,
  cuando timestamptz not null default now());

alter table bma.odoo_almacenes enable row level security;
alter table bma.odoo_productos enable row level security;
alter table bma.odoo_existencias enable row level security;
alter table bma.odoo_movimientos enable row level security;
alter table bma.odoo_cambios enable row level security;
alter table bma.odoo_copias enable row level security;
alter table bma.odoo_revisados enable row level security;
revoke all on bma.odoo_almacenes, bma.odoo_productos, bma.odoo_existencias, bma.odoo_movimientos,
  bma.odoo_cambios, bma.odoo_copias, bma.odoo_revisados from public, anon, authenticated;

-- ---------------------------------------------------------------- Ayudas
create function bma.exigir_admin() returns text
language plpgsql stable security definer set search_path to '' as $$
declare n text;
begin
  if bma.rol_actual() <> 'admin' then
    raise exception 'Solo el administrador puede ver el inventario de Odoo' using errcode = '42501';
  end if;
  select nombre into n from bma.usuarios where user_id = (select auth.uid());
  return n;
end $$;

-- Fin del día en hora de México: lo que había "el 15 de noviembre" es lo que seguía al terminar ese día.
create function bma.fin_del_dia(d date) returns timestamptz language sql immutable set search_path to '' as
$$ select ((d + 1)::timestamp at time zone 'America/Mexico_City') $$;

-- Las alertas solo toman en cuenta lo que pasó después de la carga inicial de Odoo (28-29 oct 2026).
create function bma.odoo_alertas_desde() returns timestamptz language sql immutable set search_path to '' as
$$ select '2026-11-01 00:00:00-06'::timestamptz $$;

-- Una persona de la sucursal o de la bodega registra a nombre de "Suc. …" o "Bodega …"; cualquier otro es otra persona.
create function bma.odoo_es_de_sucursal(u text) returns boolean language sql immutable set search_path to '' as
$$ select u is null or u ilike 'Suc.%' or u ilike 'Sucursal%' or u ilike 'Bodega%' $$;

-- ---------------------------------------------------------------- Guardar la copia (solo la función de Supabase)
create function public.bma_odoo_ultima_copia() returns timestamptz
language sql stable security definer set search_path to '' as
$$ select max(inicio) from bma.odoo_copias $$;

create function public.bma_odoo_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  ahora timestamptz := now();
  n_ex int; n_excamb int := 0; n_mnuevos int := 0; n_mcamb int := 0; x int;
begin
  if p->'existencias' is null or jsonb_typeof(p->'existencias') <> 'array' then
    raise exception 'Faltan las existencias';
  end if;

  insert into bma.odoo_almacenes (codigo, nombre)
    select a->>'codigo', a->>'nombre' from jsonb_array_elements(coalesce(p->'almacenes', '[]')) a
  on conflict (codigo) do update set nombre = excluded.nombre, actualizado = ahora;

  insert into bma.odoo_productos (id, nombre, codigo, categoria, unidad, seguimiento)
    select (q->>'id')::int, q->>'nombre', q->>'codigo', q->>'categoria', q->>'unidad', q->>'seguimiento'
    from jsonb_array_elements(coalesce(p->'productos', '[]')) q
  on conflict (id) do update set nombre = excluded.nombre, codigo = excluded.codigo, categoria = excluded.categoria,
    unidad = excluded.unidad, seguimiento = excluded.seguimiento, actualizado = ahora;

  -- Existencias de hoy según Odoo (sumadas por almacén, producto y lote)
  drop table if exists pg_temp.nueva, pg_temp.mov;
  create temp table nueva on commit drop as
    select e->>'almacen' as almacen, (e->>'producto_id')::int as producto_id, coalesce(e->>'lote', '') as lote,
           sum((e->>'cantidad')::numeric) as cantidad, min((e->>'llego')::timestamptz) as llego
    from jsonb_array_elements(p->'existencias') e
    group by 1, 2, 3;
  delete from nueva where cantidad = 0;
  select count(*) into n_ex from nueva;

  -- Lo que cambió o ya no está se cierra hoy; lo nuevo o distinto se abre hoy
  update bma.odoo_existencias e set hasta = ahora
   where e.hasta is null
     and not exists (select 1 from nueva n where n.almacen = e.almacen and n.producto_id = e.producto_id
                     and n.lote = e.lote and n.cantidad = e.cantidad);
  get diagnostics x = row_count; n_excamb := n_excamb + x;

  insert into bma.odoo_existencias (almacen, producto_id, lote, cantidad, desde, llego)
    select n.almacen, n.producto_id, n.lote, n.cantidad, ahora, n.llego from nueva n
     where not exists (select 1 from bma.odoo_existencias e where e.hasta is null and e.almacen = n.almacen
                       and e.producto_id = n.producto_id and e.lote = n.lote);
  get diagnostics x = row_count; n_excamb := n_excamb + x;

  -- Llegada según Odoo (no es un cambio de existencia)
  update bma.odoo_existencias e set llego = n.llego from nueva n
   where e.hasta is null and n.almacen = e.almacen and n.producto_id = e.producto_id and n.lote = e.lote
     and e.llego is distinct from n.llego;

  -- Movimientos: nuevos se agregan; los que Odoo cambió dejan su antes y después
  create temp table mov on commit drop as
    select (m->>'id')::int as id, (m->>'fecha')::timestamptz as fecha, (m->>'creado')::timestamptz as creado,
           (m->>'modificado')::timestamptz as modificado, m->>'creo' as creo, m->>'modifico' as modifico,
           m->>'referencia' as referencia, nullif(m->>'origen', '') as origen, m->>'tipo' as tipo,
           (m->>'producto_id')::int as producto_id, coalesce(m->>'lote', '') as lote, (m->>'cantidad')::numeric as cantidad,
           nullif(m->>'de_almacen', '') as de_almacen, nullif(m->>'a_almacen', '') as a_almacen,
           m->>'de_ubicacion' as de_ubicacion, m->>'a_ubicacion' as a_ubicacion, m->>'de_uso' as de_uso, m->>'a_uso' as a_uso,
           nullif(m->>'cliente', '') as cliente, nullif(m->>'venta', '') as venta
    from jsonb_array_elements(coalesce(p->'movimientos', '[]')) m;

  select count(*) into n_mnuevos from mov n where not exists (select 1 from bma.odoo_movimientos o where o.id = n.id);

  insert into bma.odoo_cambios (movimiento_id, antes, despues)
    select o.id,
      jsonb_build_object('fecha', o.fecha, 'cantidad', o.cantidad, 'lote', o.lote, 'producto_id', o.producto_id,
        'de_ubicacion', o.de_ubicacion, 'a_ubicacion', o.a_ubicacion, 'cliente', o.cliente, 'venta', o.venta, 'modifico', o.modifico),
      jsonb_build_object('fecha', n.fecha, 'cantidad', n.cantidad, 'lote', n.lote, 'producto_id', n.producto_id,
        'de_ubicacion', n.de_ubicacion, 'a_ubicacion', n.a_ubicacion, 'cliente', n.cliente, 'venta', n.venta, 'modifico', n.modifico)
    from mov n join bma.odoo_movimientos o on o.id = n.id
    where (o.fecha, o.cantidad, o.lote, o.producto_id, o.de_ubicacion, o.a_ubicacion, o.cliente, o.venta)
          is distinct from (n.fecha, n.cantidad, n.lote, n.producto_id, n.de_ubicacion, n.a_ubicacion, n.cliente, n.venta);
  get diagnostics n_mcamb = row_count;

  insert into bma.odoo_movimientos as o (id, fecha, creado, modificado, creo, modifico, referencia, origen, tipo, producto_id,
      lote, cantidad, de_almacen, a_almacen, de_ubicacion, a_ubicacion, de_uso, a_uso, cliente, venta)
    select id, fecha, creado, modificado, creo, modifico, referencia, origen, tipo, producto_id,
      lote, cantidad, de_almacen, a_almacen, de_ubicacion, a_ubicacion, de_uso, a_uso, cliente, venta from mov
  on conflict (id) do update set fecha = excluded.fecha, creado = excluded.creado, modificado = excluded.modificado,
    creo = excluded.creo, modifico = excluded.modifico, referencia = excluded.referencia, origen = excluded.origen,
    tipo = excluded.tipo, producto_id = excluded.producto_id, lote = excluded.lote, cantidad = excluded.cantidad,
    de_almacen = excluded.de_almacen, a_almacen = excluded.a_almacen, de_ubicacion = excluded.de_ubicacion,
    a_ubicacion = excluded.a_ubicacion, de_uso = excluded.de_uso, a_uso = excluded.a_uso, cliente = excluded.cliente,
    venta = excluded.venta,
    cambios = o.cambios + case when (o.fecha, o.cantidad, o.lote, o.producto_id, o.de_ubicacion, o.a_ubicacion, o.cliente, o.venta)
      is distinct from (excluded.fecha, excluded.cantidad, excluded.lote, excluded.producto_id, excluded.de_ubicacion,
      excluded.a_ubicacion, excluded.cliente, excluded.venta) then 1 else 0 end
  where (o.modificado, o.fecha, o.cantidad, o.lote, o.producto_id, o.de_ubicacion, o.a_ubicacion, o.cliente, o.venta, o.tipo, o.origen)
        is distinct from (excluded.modificado, excluded.fecha, excluded.cantidad, excluded.lote, excluded.producto_id,
        excluded.de_ubicacion, excluded.a_ubicacion, excluded.cliente, excluded.venta, excluded.tipo, excluded.origen);
  insert into bma.odoo_copias (inicio, quien, existencias, existencias_cambiadas, movimientos_nuevos, movimientos_cambiados)
    values (coalesce((p->>'inicio')::timestamptz, ahora), coalesce(p->>'quien', 'Copia automática'), n_ex, n_excamb, n_mnuevos, n_mcamb);

  return jsonb_build_object('existencias', n_ex, 'existencias_cambiadas', n_excamb,
                            'movimientos_nuevos', n_mnuevos, 'movimientos_cambiados', n_mcamb);
end $$;

-- La copia automática se identifica con una clave guardada en el Vault (se crea abajo); la función de Supabase la compara aquí.
create function public.bma_odoo_cron_valido(p text) returns boolean
language sql stable security definer set search_path to '' as
$$ select p is not null and p = (select decrypted_secret from vault.decrypted_secrets where name = 'bma_odoo_cron') $$;

revoke all on function public.bma_odoo_ultima_copia(), public.bma_odoo_guardar(jsonb), public.bma_odoo_cron_valido(text)
  from public, anon, authenticated;
grant execute on function public.bma_odoo_ultima_copia(), public.bma_odoo_guardar(jsonb), public.bma_odoo_cron_valido(text)
  to service_role;

-- ---------------------------------------------------------------- Alertas
-- Cada alerta tiene una clave estable para poder marcarla como revisada.
create function bma.odoo_alertas() returns table (clave text, tipo text, almacen text, fecha timestamptz, titulo text,
  detalle text, lote text, movimiento_id int)
language sql stable security definer set search_path to '' as $$
  with m as (
    select o.*, coalesce(p.nombre, '') as producto, coalesce(o.de_almacen, o.a_almacen) as alm
    from bma.odoo_movimientos o left join bma.odoo_productos p on p.id = o.producto_id
    where o.fecha >= bma.odoo_alertas_desde())
  -- Ajustes de inventario y mermas (entra o sale de una ubicación de inventario)
  select 'ajuste:' || id, 'ajuste', alm, fecha,
         case when a_uso = 'inventory' then 'Se quitó del inventario' else 'Se agregó al inventario' end,
         producto || ' · ' || cantidad::text || coalesce(' · ' || referencia, '') || ' · lo hizo ' || coalesce(creo, '?'),
         lote, id
    from m where de_uso = 'inventory' or a_uso = 'inventory'
  union all
  -- Salió a un cliente sin orden de venta
  select 'sin_venta:' || id, 'sin_venta', alm, fecha, 'Salió a un cliente sin orden de venta',
         producto || coalesce(' · ' || referencia, '') || coalesce(' · ' || cliente, ''), lote, id
    from m where de_uso = 'internal' and a_uso = 'customer' and venta is null and coalesce(origen, '') !~ '^S\d+'
  union all
  -- Regresó de un cliente
  select 'devolucion:' || id, 'devolucion', alm, fecha, 'Regresó de un cliente',
         producto || coalesce(' · ' || cliente, '') || coalesce(' · ' || origen, '') || ' · lo hizo ' || coalesce(creo, '?'), lote, id
    from m where de_uso = 'customer' and a_uso = 'internal'
  union all
  -- Una salida a cliente que registró alguien que no es de la sucursal ni de la bodega (p. ej. una corrección de sistemas).
  -- Solo salidas a cliente: sistemas también da entrada a contenedores y traspasa de las bodegas todos los días.
  select 'otra_persona:' || id, 'otra_persona', alm, fecha, 'Salida a cliente registrada por ' || creo,
         producto || coalesce(' · ' || referencia, '') || coalesce(' · ' || cliente, ''), lote, id
    from m where not bma.odoo_es_de_sucursal(creo) and a_uso = 'customer'
  union all
  -- Se cambió en Odoo después de que lo copiamos
  select 'cambio:' || c.id, 'cambio', coalesce(o.de_almacen, o.a_almacen), c.visto, 'Se cambió después de registrarse',
         coalesce(p.nombre, '') || coalesce(' · ' || o.referencia, '') || coalesce(' · lo cambió ' || o.modifico, ''), o.lote, o.id
    from bma.odoo_cambios c join bma.odoo_movimientos o on o.id = c.movimiento_id
    left join bma.odoo_productos p on p.id = o.producto_id
  union all
  -- Existencia en negativo
  select 'negativo:' || e.almacen || ':' || e.producto_id || ':' || e.lote, 'negativo', e.almacen, e.desde,
         'Existencia en negativo', p.nombre || ' · ' || e.cantidad::text, e.lote, null
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    where e.hasta is null and e.cantidad < 0
  union all
  -- Una misma serie en dos lugares o más de una pieza
  select 'serie:' || e.lote, 'serie', min(e.almacen), min(e.desde), 'Misma serie en dos lugares o repetida',
         min(p.nombre) || ' · ' || string_agg(e.almacen || ' (' || e.cantidad::text || ')', ', '), e.lote, null
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    where e.hasta is null and p.seguimiento = 'serial' and e.lote <> ''
    group by e.lote having count(*) > 1 or sum(e.cantidad) > 1
  union all
  -- Almacén con existencias que lleva 7 días o más sin movimientos (una alerta por semana)
  select 'sin_movimientos:' || a.codigo || ':' || to_char(now() at time zone 'America/Mexico_City', 'IYYY-IW'), 'sin_movimientos',
         a.codigo, u.ultimo, 'Lleva ' || (extract(day from now() - u.ultimo))::int || ' días sin movimientos en Odoo', a.nombre, '', null
    from bma.odoo_almacenes a
    join lateral (select max(fecha) as ultimo from bma.odoo_movimientos o where o.de_almacen = a.codigo or o.a_almacen = a.codigo) u on true
    where u.ultimo < now() - interval '7 days'
      and exists (select 1 from bma.odoo_existencias e where e.almacen = a.codigo and e.hasta is null)
$$;

-- ---------------------------------------------------------------- Consultas para la pantalla (solo admin)
create function public.bma_odoo_resumen(p_dia date default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare corte timestamptz := case when p_dia is null then null else bma.fin_del_dia(p_dia) end;
begin
  perform bma.exigir_admin();
  return jsonb_build_object(
    'ultima_copia', (select to_jsonb(c) from (select fin, quien from bma.odoo_copias order by fin desc limit 1) c),
    'primera_copia', (select min(inicio) from bma.odoo_copias),
    'pendientes', (select count(*) from bma.odoo_alertas() a where not exists (select 1 from bma.odoo_revisados r where r.clave = a.clave)),
    'almacenes', coalesce((
      select jsonb_agg(x order by x.bodega, x.nombre) from (
        select a.codigo, a.nombre, s.clave as sucursal, a.codigo ~ '^S-BD' as bodega,
          coalesce(sum(e.cantidad) filter (where p.seguimiento = 'serial'), 0) as vehiculos,
          coalesce(sum(e.cantidad) filter (where p.categoria ilike 'PASTITO%'), 0) as pasto,
          coalesce(sum(e.cantidad) filter (where p.seguimiento <> 'serial' and coalesce(p.categoria, '') not ilike 'PASTITO%'), 0) as otros,
          (select max(fecha) from bma.odoo_movimientos o where (o.de_almacen = a.codigo or o.a_almacen = a.codigo)
             and (corte is null or o.fecha < corte)) as ultimo_mov,
          (select count(*) from bma.odoo_alertas() al where al.almacen = a.codigo
             and not exists (select 1 from bma.odoo_revisados r where r.clave = al.clave)) as pendientes
        from bma.odoo_almacenes a
        left join bma.sucursales s on s.odoo_almacen = a.codigo
        left join bma.odoo_existencias e on e.almacen = a.codigo
          and (case when corte is null then e.hasta is null else e.desde < corte and (e.hasta is null or e.hasta >= corte) end)
        left join bma.odoo_productos p on p.id = e.producto_id
        group by a.codigo, a.nombre, s.clave) x), '[]'::jsonb));
end $$;

create function public.bma_odoo_existencias(p_almacen text, p_dia date default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare corte timestamptz := case when p_dia is null then null else bma.fin_del_dia(p_dia) end;
begin
  perform bma.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'codigo', p.codigo, 'categoria', p.categoria,
             'unidad', p.unidad, 'seguimiento', p.seguimiento, 'lote', e.lote, 'cantidad', e.cantidad, 'desde', e.desde,
             'llego', e.llego)
           order by p.categoria, p.nombre, e.lote)
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    where e.almacen = p_almacen
      and (case when corte is null then e.hasta is null else e.desde < corte and (e.hasta is null or e.hasta >= corte) end)), '[]'::jsonb);
end $$;

create function public.bma_odoo_movimientos(p_almacen text default null, p_limite int default 300) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform bma.exigir_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.fecha desc, x.id desc) from (
      select o.id, o.fecha, o.creo, o.referencia, o.origen, o.tipo, o.lote, o.cantidad, o.de_almacen, o.a_almacen,
             o.de_ubicacion, o.a_ubicacion, o.de_uso, o.a_uso, o.cliente, o.venta, o.cambios,
             p.nombre as producto, p.codigo, p.categoria, p.unidad
      from bma.odoo_movimientos o left join bma.odoo_productos p on p.id = o.producto_id
      where p_almacen is null or o.de_almacen = p_almacen or o.a_almacen = p_almacen
      order by o.fecha desc, o.id desc
      limit least(greatest(coalesce(p_limite, 300), 1), 1000)) x), '[]'::jsonb);
end $$;

create function public.bma_odoo_serie(p_q text) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare q text := upper(regexp_replace(coalesce(p_q, ''), '\s+', '', 'g')); lotes text[];
begin
  perform bma.exigir_admin();
  if length(q) < 4 then return '[]'::jsonb; end if;
  select array_agg(distinct l) into lotes from (
    select lote as l from bma.odoo_existencias where upper(replace(lote, ' ', '')) like '%' || q || '%'
    union select lote from bma.odoo_movimientos where upper(replace(lote, ' ', '')) like '%' || q || '%') t
  where l <> '';
  if lotes is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'lote', l,
      'producto', (select p.nombre from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id where e.lote = l limit 1),
      'hoy', (select jsonb_agg(jsonb_build_object('almacen', e.almacen, 'cantidad', e.cantidad, 'desde', e.desde))
                from bma.odoo_existencias e where e.lote = l and e.hasta is null),
      'movimientos', (select jsonb_agg(jsonb_build_object('fecha', o.fecha, 'referencia', o.referencia, 'tipo', o.tipo, 'cantidad', o.cantidad,
                        'de_almacen', o.de_almacen, 'a_almacen', o.a_almacen, 'de_ubicacion', o.de_ubicacion, 'a_ubicacion', o.a_ubicacion,
                        'de_uso', o.de_uso, 'a_uso', o.a_uso, 'cliente', o.cliente, 'venta', o.venta, 'creo', o.creo, 'cambios', o.cambios,
                        'producto', p.nombre) order by o.fecha, o.id)
                      from bma.odoo_movimientos o left join bma.odoo_productos p on p.id = o.producto_id where o.lote = l))
    order by l), '[]'::jsonb) from unnest(lotes[1:30]) l);
end $$;

create function public.bma_odoo_revisar(p_estado text default 'pendiente') returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform bma.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('clave', a.clave, 'tipo', a.tipo, 'almacen', a.almacen, 'almacen_nombre', al.nombre,
             'fecha', a.fecha, 'titulo', a.titulo, 'detalle', a.detalle, 'lote', a.lote,
             'revisado', r.cuando, 'quien', r.quien, 'nota', r.nota)
           order by coalesce(r.cuando, a.fecha) desc)
    from bma.odoo_alertas() a
    left join bma.odoo_almacenes al on al.codigo = a.almacen
    left join bma.odoo_revisados r on r.clave = a.clave
    where (p_estado = 'revisado') = (r.clave is not null)), '[]'::jsonb);
end $$;

create function public.bma_odoo_revisado(p_clave text, p_nota text default null) returns boolean
language plpgsql security definer set search_path to '' as $$
declare n text := bma.exigir_admin();
begin
  insert into bma.odoo_revisados (clave, quien, nota) values (p_clave, n, nullif(trim(p_nota), ''))
  on conflict (clave) do update set quien = excluded.quien, nota = excluded.nota, cuando = now();
  return true;
end $$;

revoke all on function public.bma_odoo_resumen(date), public.bma_odoo_existencias(text, date), public.bma_odoo_movimientos(text, int),
  public.bma_odoo_serie(text), public.bma_odoo_revisar(text), public.bma_odoo_revisado(text, text) from public, anon;
grant execute on function public.bma_odoo_resumen(date), public.bma_odoo_existencias(text, date), public.bma_odoo_movimientos(text, int),
  public.bma_odoo_serie(text), public.bma_odoo_revisar(text), public.bma_odoo_revisado(text, text) to authenticated;
revoke all on function bma.exigir_admin(), bma.odoo_alertas() from public, anon, authenticated;
