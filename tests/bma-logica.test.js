// Pruebas de la lógica de las pantallas de ventas (sin navegador). Correr: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bma-logica.js');

test('esc escapa lo que podría volverse HTML', () => {
  assert.equal(B.esc(`<script>"x" & 'y'</script>`), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  assert.equal(B.esc(null), '');
});

test('dinero con dos decimales y signo', () => {
  assert.equal(B.dinero(12500), '$12,500.00');
  assert.equal(B.dinero(0.5), '$0.50');
  assert.equal(B.dinero(-300), '−$300.00');
  assert.equal(B.dinero(null), '—');
});

test('lunesDe', () => {
  assert.equal(B.lunesDe('2026-11-19'), '2026-11-16');
  assert.equal(B.lunesDe('2026-11-16'), '2026-11-16');
  assert.equal(B.lunesDe('2026-11-22'), '2026-11-16');
});

test('saldo', () => {
  assert.equal(B.saldo({precio_total: 30000, pagado: 25000}), 5000);
  assert.equal(B.saldo({precio_total: '30000.00', pagado: '30000.00'}), 0);
  assert.equal(B.saldo({precio_total: null, pagado: 10000}), null);
});

test('etiquetaEstado', () => {
  assert.deepEqual(B.etiquetaEstado({estado: 'abierta', precio_total: 1}), {texto: 'Abierta', clase: 'abierta'});
  assert.deepEqual(B.etiquetaEstado({estado: 'abierta', precio_total: null}), {texto: 'Abierta · precio por confirmar', clase: 'abierta'});
  assert.deepEqual(B.etiquetaEstado({estado: 'cerrada'}), {texto: 'Cerrada', clase: 'cerrada'});
  assert.deepEqual(B.etiquetaEstado({estado: 'cancelada'}), {texto: 'Cancelada', clase: 'cancelada'});
});

test('TIPOS y METODOS cuadran con la base', () => {
  assert.deepEqual(B.TIPOS.map(t => t.valor),
    ['anticipo', 'abono', 'liquidacion', 'contado', 'devolucion', 'entrega', 'cancelacion']);
  assert.deepEqual(B.TIPOS.filter(t => !t.conDinero).map(t => t.valor), ['entrega', 'cancelacion']);
  assert.deepEqual(B.METODOS.map(m => m.valor), ['efectivo', 'transferencia', 'tarjeta', 'deposito', 'mercado_pago', 'cheque']);
});

test('validarMovimiento', () => {
  const hoy = '2026-11-19';
  assert.equal(B.validarMovimiento({tipo: 'abono', monto: null, metodo: 'efectivo', fecha: hoy}, hoy), 'Falta el monto');
  assert.equal(B.validarMovimiento({tipo: 'anticipo', monto: 100, metodo: '', fecha: hoy}, hoy), 'Falta el método');
  assert.equal(B.validarMovimiento({tipo: 'entrega', monto: 0, metodo: '', fecha: hoy}, hoy), null);
  assert.equal(B.validarMovimiento({tipo: 'abono', monto: 100, metodo: 'tarjeta', fecha: '2026-11-20'}, hoy), 'La fecha no puede ser futura');
  assert.equal(B.validarMovimiento({tipo: 'abono', monto: 100, metodo: 'tarjeta', fecha: hoy}, hoy), null);
  assert.equal(B.validarMovimiento({tipo: '', monto: 100, metodo: 'tarjeta', fecha: hoy}, hoy), 'Falta el tipo');
});

test('textoCambio describe solo lo que cambió, con nombres', () => {
  const c = {accion: 'cambio',
    antes: {cliente_id: null, precio_total: null, producto: 'ATV', creado_en: 'x', estado: 'abierta'},
    despues: {cliente_id: 'p1', precio_total: 30000, producto: 'ATV', creado_en: 'y', estado: 'abierta'}};
  assert.deepEqual(B.textoCambio(c, {p1: 'Ana López'}), ['Cliente: sin cliente → Ana López', 'Precio: — → $30,000.00']);
  assert.deepEqual(B.textoCambio({accion: 'alta', despues: {tipo: 'abono', monto: 500}}, {}), ['Se registró']);
});

test('SUCURSALES son las 11 de la base', () => {
  assert.deepEqual(B.SUCURSALES.map(s => s.valor), ['AGS', 'GDL', 'LPZ', 'MAZ', 'MLM', 'NAU', 'PUE', 'QRO', 'TEP', 'TIJ', 'ZAP']);
  assert.equal(B.nombreDe(B.SUCURSALES, 'MLM'), 'Morelia');
});

test('MOTIVOS tiene texto para cada motivo de duda', () => {
  for (const m of ['sin_anticipo', 'varias_candidatas', 'sin_tipo_pago', 'entrega_sin_venta', 'cancelada_sin_venta',
                   'vendedor_parecido', 'sin_remision', 'monto_ilegible', 'sin_producto']) {
    assert.ok(B.MOTIVOS[m], m);
  }
});
