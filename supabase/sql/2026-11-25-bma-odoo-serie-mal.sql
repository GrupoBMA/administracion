-- Series mal capturadas en Odoo (25-nov-2026, a pedido): "H0XACAEL-T0010449" (guion en lugar del dígito
-- verificador) o "H0XACAEL0T0010456 (NO INFO)" (texto de más). El folio las reconoce igual
-- (ATV200-EQ-VEC/10449) y salen en Por revisar como "Serie mal capturada" para que sistemas las corrija.

-- Serie sin el pedimento ni el texto entre paréntesis del final, en mayúsculas
create or replace function bma.odoo_serie_limpia(p_lote text) returns text
language sql immutable set search_path to '' as $$
  select upper(trim(regexp_replace(split_part(coalesce(p_lote, ''), ' / ', 1), '\s*\([^)]*\)\s*$', '')))
$$;

-- ¿Parece número de serie? (11 o más letras y números; o un VIN con guion en lugar del dígito verificador)
create or replace function bma.odoo_serie_larga(p_serie text) returns boolean
language sql immutable set search_path to '' as $$
  select p_serie ~ '^[A-Z0-9]{11,}$' or p_serie ~ '^[A-Z0-9]{8}-[A-Z0-9]{8}$'
$$;

create or replace function bma.odoo_folios() returns table (lote text, folio text)
language sql stable set search_path to '' as $$
  with l as (  -- producto más reciente de cada lote
    select distinct on (t.lote) t.lote, t.producto_id from (
      select e.lote, e.producto_id, e.desde as f from bma.odoo_existencias e where e.lote <> ''
      union all select o.lote, o.producto_id, o.fecha from bma.odoo_movimientos o where o.lote <> '') t
    order by t.lote, t.f desc),
  s as (
    select l.lote, bma.odoo_serie_limpia(l.lote) as serie, p.codigo
    from l join bma.odoo_productos p on p.id = l.producto_id
    where p.seguimiento = 'serial'),
  k as (select s.*, bma.odoo_serie_larga(s.serie) as larga from s),
  rep as (
    select k.codigo, right(k.serie, 5) as u5 from k where k.larga and k.codigo is not null
    -- solo cuando la letra sí las distingue; si son del mismo año (casi siempre la misma unidad capturada
    -- dos veces con el dígito verificador distinto) el folio se repite y hay que corregirlo en Odoo
    group by 1, 2 having count(distinct k.serie) > 1 and count(distinct substr(k.serie, 10, 1)) > 1)
  select k.lote,
    case when not k.larga then trim(split_part(k.lote, ' / ', 1))
         when k.codigo is null then right(k.serie, 5)
         else k.codigo || '/' ||
           case when rep.u5 is not null and length(k.serie) = 17 then substr(k.serie, 10, 1) else '' end ||
           right(k.serie, 5) end
  from k left join rep on rep.codigo = k.codigo and rep.u5 = right(k.serie, 5)
$$;

create or replace function bma.odoo_alertas()
returns table (clave text, tipo text, almacen text, fecha timestamptz, titulo text, detalle text, lote text, movimiento_id integer)
language sql stable security definer set search_path to '' as $$
  with m as (
    select o.*, coalesce(p.nombre, '') as producto, coalesce(o.de_almacen, o.a_almacen) as alm
    from bma.odoo_movimientos o left join bma.odoo_productos p on p.id = o.producto_id
    where o.fecha >= bma.odoo_alertas_desde())
  select 'ajuste:' || id, 'ajuste', alm, fecha,
         case when a_uso = 'inventory' then 'Se quitó del inventario' else 'Se agregó al inventario' end,
         producto || ' · ' || cantidad::text || coalesce(' · ' || referencia, '') || ' · lo hizo ' || coalesce(creo, '?'),
         lote, id
    from m where de_uso = 'inventory' or a_uso = 'inventory'
  union all
  select 'sin_venta:' || id, 'sin_venta', alm, fecha, 'Salió a un cliente sin orden de venta',
         producto || coalesce(' · ' || referencia, '') || coalesce(' · ' || cliente, ''), lote, id
    from m where de_uso = 'internal' and a_uso = 'customer' and venta is null and coalesce(origen, '') !~ '^S\d+'
  union all
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
  select 'cambio:' || c.id, 'cambio', coalesce(o.de_almacen, o.a_almacen), c.visto, 'Se cambió después de registrarse',
         coalesce(p.nombre, '') || coalesce(' · ' || o.referencia, '') || coalesce(' · lo cambió ' || o.modifico, ''), o.lote, o.id
    from bma.odoo_cambios c join bma.odoo_movimientos o on o.id = c.movimiento_id
    left join bma.odoo_productos p on p.id = o.producto_id
  union all
  select 'negativo:' || e.almacen || ':' || e.producto_id || ':' || e.lote, 'negativo', e.almacen, e.desde,
         'Existencia en negativo', p.nombre || ' · ' || e.cantidad::text, e.lote, null
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    where e.hasta is null and e.cantidad < 0
  union all
  select 'serie:' || e.lote, 'serie', min(e.almacen), min(e.desde), 'Misma serie en dos lugares o repetida',
         min(p.nombre) || ' · ' || string_agg(e.almacen || ' (' || e.cantidad::text || ')', ', '), e.lote, null
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    where e.hasta is null and p.seguimiento = 'serial' and e.lote <> ''
    group by e.lote having count(*) > 1 or sum(e.cantidad) > 1
  union all
  -- Serie con un guion en lugar del dígito verificador o con texto de más entre paréntesis
  select 'serie_mal:' || e.lote, 'serie_mal', min(e.almacen), min(e.desde), 'Serie mal capturada',
         min(p.nombre) || ' · dice "' || split_part(e.lote, ' / ', 1) || '" · ' ||
         case when bma.odoo_serie_limpia(e.lote) ~ '-' then 'le falta un dígito' else 'tiene texto de más' end ||
         -- la misma serie bien capturada ya se vendió (al 25-nov: las dos "(NO INFO)" de Bodega 1 se vendieron
         -- en Guadalajara el 9 de octubre: Bodega 1 tendría dos unidades que ya no están)
         coalesce(' · la misma serie ya se vendió' || (
           select coalesce(' en ' || o.de_almacen, '') || coalesce(' a ' || o.cliente, '') || ' el ' || to_char(o.fecha at time zone 'America/Mexico_City', 'DD/MM/YYYY')
           from bma.odoo_movimientos o
           where o.lote <> e.lote and o.a_uso = 'customer' and bma.odoo_serie_limpia(o.lote) = bma.odoo_serie_limpia(e.lote)
           order by o.fecha desc limit 1), ''),
         e.lote, null
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    where e.hasta is null and p.seguimiento = 'serial' and e.lote <> ''
      and bma.odoo_serie_larga(bma.odoo_serie_limpia(e.lote))
      and (bma.odoo_serie_limpia(e.lote) ~ '-' or split_part(e.lote, ' / ', 1) ~ '\([^)]*\)\s*$')
    group by e.lote
  union all
  select 'sin_movimientos:' || a.codigo || ':' || to_char(now() at time zone 'America/Mexico_City', 'IYYY-IW'), 'sin_movimientos',
         a.codigo, u.ultimo, 'Lleva ' || (extract(day from now() - u.ultimo))::int || ' días sin movimientos en Odoo', a.nombre, '', null
    from bma.odoo_almacenes a
    join lateral (select max(fecha) as ultimo from bma.odoo_movimientos o where o.de_almacen = a.codigo or o.a_almacen = a.codigo) u on true
    where u.ultimo < now() - interval '7 days'
      and exists (select 1 from bma.odoo_existencias e where e.almacen = a.codigo and e.hasta is null)
$$;

revoke all on function bma.odoo_serie_limpia(text), bma.odoo_serie_larga(text) from public, anon, authenticated;
