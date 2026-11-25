-- Existencias de un almacén con "aqui_desde": cuándo llegó cada serie a ese almacén desde otro lugar
-- (último movimiento hacia él que no venía de él mismo). El "llego" de Odoo (in_date) se reinicia con
-- movimientos internos, p. ej. ir a Producción y regresar (por eso tampoco cuenta lo que viene de Producción), y no sirve para contar los días en la sucursal.
-- Solo lectura; mismo candado de admin.
create or replace function public.bma_odoo_existencias(p_almacen text, p_dia date default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare corte timestamptz := case when p_dia is null then null else bma.fin_del_dia(p_dia) end;
begin
  perform bma.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'codigo', p.codigo, 'categoria', p.categoria,
             'unidad', p.unidad, 'seguimiento', p.seguimiento, 'lote', e.lote, 'cantidad', e.cantidad, 'desde', e.desde,
             'llego', e.llego,
             'aqui_desde', case when e.lote <> '' then (
               select max(o.fecha) from bma.odoo_movimientos o
               where o.lote = e.lote and o.lote <> '' and o.a_almacen = p_almacen and o.de_almacen is distinct from p_almacen
                 and o.de_uso is distinct from 'production'
                 and (corte is null or o.fecha < corte)) end)
           order by p.categoria, p.nombre, e.lote)
    from bma.odoo_existencias e join bma.odoo_productos p on p.id = e.producto_id
    where e.almacen = p_almacen
      and (case when corte is null then e.hasta is null else e.desde < corte and (e.hasta is null or e.hasta >= corte) end)), '[]'::jsonb);
end $$;
