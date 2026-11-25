-- Folio de cada unidad (25-nov-2026, a pedido): clave del producto en Odoo + "/" + últimos 5 de la serie
-- ("ATV200-RO/00010"). Si dos unidades del mismo modelo terminan igual, va antes la letra del año del VIN
-- (la 10.ª): "ATV200-RO/T00001" y "ATV200-RO/N00001". Lo que no parece número de serie (atv110-057,
-- LING251-274, SILLA-E-AGS-01) va tal cual; sin clave en Odoo (maquinaria), los últimos 5 como antes.
-- Se cuentan todas las series conocidas (también las vendidas), así un folio no cambia al venderse otra.

create or replace function bma.odoo_folios() returns table (lote text, folio text)
language sql stable set search_path to '' as $$
  with l as (  -- producto más reciente de cada lote
    select distinct on (t.lote) t.lote, t.producto_id from (
      select e.lote, e.producto_id, e.desde as f from bma.odoo_existencias e where e.lote <> ''
      union all select o.lote, o.producto_id, o.fecha from bma.odoo_movimientos o where o.lote <> '') t
    order by t.lote, t.f desc),
  s as (
    select l.lote, upper(trim(split_part(l.lote, ' / ', 1))) as serie, p.codigo
    from l join bma.odoo_productos p on p.id = l.producto_id
    where p.seguimiento = 'serial'),
  k as (select s.*, s.serie ~ '^[A-Z0-9]{11,}$' as larga from s),
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

create or replace function public.bma_odoo_existencias(p_almacen text, p_dia date default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare corte timestamptz := case when p_dia is null then null else bma.fin_del_dia(p_dia) end;
begin
  perform bma.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'codigo', p.codigo, 'categoria', p.categoria,
             'unidad', p.unidad, 'seguimiento', p.seguimiento, 'lote', e.lote, 'folio', f.folio, 'cantidad', e.cantidad, 'desde', e.desde,
             'llego', e.llego,
             'aqui_desde', case when e.lote <> '' then (
               select max(o.fecha) from bma.odoo_movimientos o
               where o.lote = e.lote and o.lote <> '' and o.a_almacen = p_almacen and o.de_almacen is distinct from p_almacen
                 and o.de_uso is distinct from 'production'
                 and (corte is null or o.fecha < corte)) end)
           order by p.categoria, p.nombre, e.lote)
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    left join bma.odoo_folios() f on f.lote = e.lote
    where e.almacen = p_almacen
      and (case when corte is null then e.hasta is null else e.desde < corte and (e.hasta is null or e.hasta >= corte) end)), '[]'::jsonb);
end $$;

create or replace function public.bma_odoo_movimientos(p_almacen text default null, p_limite int default 300) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform bma.exigir_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.fecha desc, x.id desc) from (
      select o.id, o.fecha, o.creo, o.referencia, o.origen, o.tipo, o.lote, f.folio, o.cantidad, o.de_almacen, o.a_almacen,
             o.de_ubicacion, o.a_ubicacion, o.de_uso, o.a_uso, o.cliente, o.venta, o.cambios,
             p.nombre as producto, p.codigo, p.categoria, p.unidad
      from bma.odoo_movimientos o left join bma.odoo_productos p on p.id = o.producto_id
      left join bma.odoo_folios() f on f.lote = o.lote
      where p_almacen is null or o.de_almacen = p_almacen or o.a_almacen = p_almacen
      order by o.fecha desc, o.id desc
      limit least(greatest(coalesce(p_limite, 300), 1), 1000)) x), '[]'::jsonb);
end $$;

-- Busca por serie (como antes) o por folio ("ATV200-RO/00010", "200-RO/000")
create or replace function public.bma_odoo_serie(p_q text) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare q text := upper(regexp_replace(coalesce(p_q, ''), '\s+', '', 'g')); lotes text[];
begin
  perform bma.exigir_admin();
  if length(q) < 4 then return '[]'::jsonb; end if;
  select array_agg(distinct l) into lotes from (
    select lote as l from bma.odoo_existencias where upper(replace(lote, ' ', '')) like '%' || q || '%'
    union select lote from bma.odoo_movimientos where upper(replace(lote, ' ', '')) like '%' || q || '%'
    union select f.lote from bma.odoo_folios() f where upper(replace(f.folio, ' ', '')) like '%' || q || '%') t
  where l <> '';
  if lotes is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'lote', l,
      'folio', f.folio,
      'producto', (select p.nombre from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id where e.lote = l limit 1),
      'hoy', (select jsonb_agg(jsonb_build_object('almacen', e.almacen, 'cantidad', e.cantidad, 'desde', e.desde))
                from bma.odoo_existencias e where e.lote = l and e.hasta is null),
      'movimientos', (select jsonb_agg(jsonb_build_object('fecha', o.fecha, 'referencia', o.referencia, 'tipo', o.tipo, 'cantidad', o.cantidad,
                        'de_almacen', o.de_almacen, 'a_almacen', o.a_almacen, 'de_ubicacion', o.de_ubicacion, 'a_ubicacion', o.a_ubicacion,
                        'de_uso', o.de_uso, 'a_uso', o.a_uso, 'cliente', o.cliente, 'venta', o.venta, 'creo', o.creo, 'cambios', o.cambios,
                        'producto', p.nombre) order by o.fecha, o.id)
                      from bma.odoo_movimientos o left join bma.odoo_productos p on p.id = o.producto_id where o.lote = l))
    order by l), '[]'::jsonb) from unnest(lotes[1:30]) l left join bma.odoo_folios() f on f.lote = l);
end $$;

create or replace function public.bma_odoo_revisar(p_estado text default 'pendiente') returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform bma.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('clave', a.clave, 'tipo', a.tipo, 'almacen', a.almacen, 'almacen_nombre', al.nombre,
             'fecha', a.fecha, 'titulo', a.titulo, 'detalle', a.detalle, 'lote', a.lote, 'folio', f.folio,
             'revisado', r.cuando, 'quien', r.quien, 'nota', r.nota)
           order by coalesce(r.cuando, a.fecha) desc)
    from bma.odoo_alertas() a
    left join bma.odoo_almacenes al on al.codigo = a.almacen
    left join bma.odoo_revisados r on r.clave = a.clave
    left join bma.odoo_folios() f on f.lote = a.lote
    where (p_estado = 'revisado') = (r.clave is not null)), '[]'::jsonb);
end $$;

revoke all on function bma.odoo_folios() from public, anon, authenticated;
