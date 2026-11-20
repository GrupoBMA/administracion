-- Movimiento "devolucion": dinero que se le regresa al cliente. Se guarda en positivo y resta del total.
-- Aplicada como migración "bma_devolucion" (20-nov-2026). También: DELETE con "where true" en
-- bma_borrar_importado (migración "bma_borrar_con_where"), porque Supabase rechaza DELETE sin WHERE en la API.
alter table bma.movimientos drop constraint movimientos_tipo_check;
alter table bma.movimientos add constraint movimientos_tipo_check
  check (tipo in ('contado','anticipo','abono','liquidacion','cancelacion','entrega','devolucion'));
