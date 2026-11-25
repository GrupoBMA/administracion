// node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../odoo-logica.js');

test('nombre del almacén sin "SUNL Showroom"', () => {
  assert.strictEqual(L.nombreAlmacen('Aguascalientes - SUNL Showroom'), 'Aguascalientes');
  assert.strictEqual(L.nombreAlmacen('Bodega 1 - SUNL (Granja)'), 'Bodega 1 (Granja)');
});

test('producto: tipo de la categoría y color del paréntesis', () => {
  const p = L.producto({nombre: '[ATV125-CR-VEC] ATV O CUATRIMOTO NUEVA IMPORTADA 125 CC MARCA SUNL DE MEXICO, DOBLE PARRILLA (VERDE CAMU)',
    categoria: 'SUNL / ATV / 125 cc', codigo: 'ATV125-CR-VEC'});
  assert.strictEqual(p.titulo, 'ATV 125 cc');
  assert.strictEqual(p.color, 'Verde Camu');
  assert.strictEqual(p.codigo, 'ATV125-CR-VEC');
});

test('tipo en tipo oración, sin tocar ATV ni UTV', () => {
  assert.strictEqual(L.producto({nombre: 'X', categoria: 'SUNL / CROSS / 125 cc'}).titulo, 'Cross 125 cc');
  assert.strictEqual(L.producto({nombre: 'X', categoria: 'SUNL / ATV / ELÉCTRICA'}).titulo, 'ATV Eléctrica');
  assert.strictEqual(L.producto({nombre: 'X', categoria: 'SUNL / GO KART / 200 cc'}).titulo, 'Go Kart 200 cc');
  assert.strictEqual(L.producto({nombre: 'X', categoria: 'SUNL / UTV / 400 cc'}).titulo, 'UTV 400 cc');
});

test('producto sin subcategoría usa el principio del nombre', () => {
  const p = L.producto({nombre: '[SILLA-E] SILLA ELECTRICA NUEVA IMPORTADA MARCA SUNL', categoria: 'SUNL'});
  assert.strictEqual(p.titulo, 'Silla Electrica');
});

test('pasto: submarca y ancho', () => {
  const p = {nombre: '[P-OA-2M-18MM] PASTO SINTETICO NUEVO IMPORTADO MARCA PASTITO SUBMARCA OASIS 18 MM (2 m)',
    categoria: 'PASTITO / RESIDENCIAL', codigo: 'P-OA-2M-18MM'};
  assert.strictEqual(L.anchoPasto(p), 2);
  assert.strictEqual(L.producto(p).titulo, 'Pasto Oasis 18 mm · 2 m');
  assert.strictEqual(L.anchoPasto({codigo: 'P-CA-4M-25MM'}), 4);
  assert.strictEqual(L.anchoPasto({codigo: 'P-BI-AG-2M', nombre: 'X (2 m)'}), 2);
});

test('rollos: 2 m × 25 m = 50 m²; 4 m = 100 m²', () => {
  assert.strictEqual(L.rollos(434.89, 2), 8.7);
  assert.strictEqual(L.rollos(100, 4), 1);
  assert.strictEqual(L.rollos(0, 2), null);
  assert.strictEqual(L.rollos(50, null), null);
});

test('serie y pedimento', () => {
  assert.deepStrictEqual(L.serie('ABCDE12345F000001 / 24  16  1234  4000001'), {serie: 'ABCDE12345F000001', pedimento: '24 16 1234 4000001'});
  assert.deepStrictEqual(L.serie('LOTE'), {serie: 'LOTE', pedimento: ''});
});

test('tipo de movimiento visto desde un almacén', () => {
  assert.strictEqual(L.tipoMov({de_uso: 'internal', a_uso: 'customer'}).texto, 'Venta');
  assert.strictEqual(L.tipoMov({de_uso: 'customer', a_uso: 'internal'}).signo, 1);
  assert.strictEqual(L.tipoMov({de_uso: 'internal', a_uso: 'inventory'}).texto, 'Ajuste: se quitó');
  const t = {de_uso: 'internal', a_uso: 'internal', de_almacen: 'S-BD1', a_almacen: 'S-AGS'};
  assert.deepStrictEqual([L.tipoMov(t, 'S-AGS').texto, L.tipoMov(t, 'S-AGS').signo], ['Traspaso de S-BD1', 1]);
  assert.deepStrictEqual([L.tipoMov(t, 'S-BD1').texto, L.tipoMov(t, 'S-BD1').signo], ['Traspaso a S-AGS', -1]);
  assert.strictEqual(L.tipoMov({de_uso: 'internal', a_uso: 'internal', de_almacen: 'S-AGS', a_almacen: 'S-AGS'}).texto, 'Cambio de lugar');
});

test('hace: hoy, ayer, días y semanas (hora de México)', () => {
  const ahora = '2026-11-24T22:00:00Z';                 // 24 nov 4 p. m. en México
  assert.strictEqual(L.hace('2026-11-24T15:00:00Z', ahora), 'hoy');
  assert.strictEqual(L.hace('2026-11-24T03:00:00Z', ahora), 'ayer');   // 23 nov 9 p. m. en México
  assert.strictEqual(L.hace('2026-11-09T18:45:28Z', ahora), 'hace 2 semanas');
  assert.strictEqual(L.hace('2026-11-18T17:41:39Z', ahora), 'hace 6 días');
  assert.strictEqual(L.hace(null, ahora), 'nunca');
});

test('semana de un movimiento', () => {
  assert.strictEqual(L.lunes('2026-11-24T03:00:00Z'), '2026-11-23');   // domingo 23? no: lunes 23 nov
  assert.strictEqual(L.semana('2026-11-23'), 'Semana del 23 al 29 nov');
  assert.strictEqual(L.semana('2026-10-26'), 'Semana del 26 oct al 1 nov');
});

test('cantidad legible', () => {
  assert.strictEqual(L.cantidad(1, 'PZA'), '1 pieza');
  assert.strictEqual(L.cantidad(3, 'PZA'), '3 piezas');
  assert.strictEqual(L.cantidad(434.89, 'm²'), '434.89 m²');
});

test('clase de existencia', () => {
  assert.strictEqual(L.clase({categoria: 'PASTITO / RESIDENCIAL', seguimiento: 'lot'}), 'pasto');
  assert.strictEqual(L.clase({categoria: 'SUNL / ATV', seguimiento: 'serial'}), 'vehiculos');
  assert.strictEqual(L.clase({categoria: 'SUNL', seguimiento: 'none'}), 'otros');
});

test('familia y variante: todas las ATV juntas', () => {
  const p = L.producto({nombre: '[ATV125-CR-VEC] ATV O CUATRIMOTO 125 CC (VERDE CAMU)', categoria: 'SUNL / ATV / 125 cc'});
  assert.deepStrictEqual([p.familia, p.variante, p.color], ['ATV', '125 cc', 'Verde Camu']);
  assert.deepStrictEqual([L.producto({nombre: 'X', categoria: 'SUNL / GO KART / 200 cc'}).familia, L.producto({nombre: 'X', categoria: 'SUNL / ATV / ELÉCTRICA'}).variante], ['Go Kart', 'Eléctrica']);
  const s = L.producto({nombre: 'SILLA ELECTRICA', categoria: 'SUNL'});
  assert.deepStrictEqual([s.familia, s.variante], ['Silla Electrica', '']);
});

test('serie corta: últimos 5 de un VIN', () => {
  assert.strictEqual(L.serieCorta('L0SSAAL08ST000535'), '00535');
  assert.strictEqual(L.serieCorta('SILLA-E-AGS-01'), 'SILLA-E-AGS-01');
  assert.strictEqual(L.serieCorta(''), '');
});
