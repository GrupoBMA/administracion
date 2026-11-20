-- Dos motivos más de duda de la importación (revisión final, 20-nov-2026): monto que no se pudo leer
-- y cobro sin producto. Aplicada como migración "bma_dudas_motivos".
alter table bma.dudas_importacion drop constraint dudas_importacion_motivo_check;
alter table bma.dudas_importacion add constraint dudas_importacion_motivo_check
  check (motivo in ('sin_anticipo','varias_candidatas','sin_tipo_pago','entrega_sin_venta','cancelada_sin_venta',
                    'vendedor_parecido','sin_remision','monto_ilegible','sin_producto'));
