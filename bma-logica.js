// Lógica de las pantallas de ventas, personas y dudas, sin DOM (se prueba con node --test tests/*.test.js).
// En el navegador queda como window.BMA. La base decide estado y saldo al guardar; aquí solo se muestra.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.BMA = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function dinero(v) {
    var n = num(v);
    if (n === null) return '—';
    var t = Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return (n < 0 ? '−$' : '$') + t;
  }

  function fecha(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return (+p[2]) + ' ' + MESES[+p[1] - 1] + ' ' + p[0].slice(2);
  }

  function lunesDe(iso) {
    var p = iso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  function hoy() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function saldo(v) {
    var p = num(v.precio_total);
    if (p === null) return null;
    return Math.round((p - (num(v.pagado) || 0)) * 100) / 100;
  }

  function etiquetaEstado(v) {
    if (v.estado === 'cancelada') return {texto: 'Cancelada', clase: 'cancelada'};
    if (v.estado === 'cerrada') return {texto: 'Cerrada', clase: 'cerrada'};
    return {texto: num(v.precio_total) === null ? 'Abierta · precio por confirmar' : 'Abierta', clase: 'abierta'};
  }

  var TIPOS = [
    {valor: 'anticipo', nombre: 'Anticipo', conDinero: true},
    {valor: 'abono', nombre: 'Abono', conDinero: true},
    {valor: 'liquidacion', nombre: 'Liquidación', conDinero: true},
    {valor: 'contado', nombre: 'Contado', conDinero: true},
    {valor: 'devolucion', nombre: 'Devolución', conDinero: true},
    {valor: 'entrega', nombre: 'Entrega sin dinero', conDinero: false},
    {valor: 'cancelacion', nombre: 'Cancelación', conDinero: false}
  ];
  var METODOS = [
    {valor: 'efectivo', nombre: 'Efectivo'}, {valor: 'transferencia', nombre: 'Transferencia'},
    {valor: 'tarjeta', nombre: 'Tarjeta'}, {valor: 'deposito', nombre: 'Depósito'},
    {valor: 'mercado_pago', nombre: 'Mercado Pago'}, {valor: 'cheque', nombre: 'Cheque'}
  ];
  function nombreDe(lista, valor) {
    for (var i = 0; i < lista.length; i++) if (lista[i].valor === valor) return lista[i].nombre;
    return valor || '';
  }

  function validarMovimiento(m, hoyIso) {
    var t = null;
    for (var i = 0; i < TIPOS.length; i++) if (TIPOS[i].valor === m.tipo) t = TIPOS[i];
    if (!t) return 'Falta el tipo';
    if (t.conDinero) {
      if (!(num(m.monto) > 0)) return 'Falta el monto';
      if (!m.metodo) return 'Falta el método';
    }
    if (!m.fecha) return 'Falta la fecha';
    if (m.fecha > (hoyIso || hoy())) return 'La fecha no puede ser futura';
    return null;
  }

  // Cómo se lee cada campo en el historial de cambios
  var CAMPOS = {
    cliente_id: 'Cliente', vendedor_id: 'Vendedor', producto: 'Producto', categoria: 'Categoría', linea: 'Línea',
    remision: 'Remisión', factura: 'Factura', color: 'Color', precio_total: 'Precio', estado: 'Estado',
    fecha: 'Fecha', monto: 'Monto', metodo: 'Método', cuenta: 'Cuenta', nota: 'Nota', confirmado_banco: 'Banco',
    tipo: 'Tipo', venta_id: 'Venta', nombre: 'Nombre', tipos: 'Tipos', telefono: 'Teléfono', sucursal: 'Sucursal', notas: 'Notas'
  };
  function valorLegible(campo, v, nombres) {
    if (campo === 'cliente_id') return v ? (nombres[v] || 'otra persona') : 'sin cliente';
    if (campo === 'vendedor_id') return v ? (nombres[v] || 'otra persona') : 'sin vendedor';
    if (v === null || v === undefined || v === '') return '—';
    if (campo === 'precio_total' || campo === 'monto') return dinero(v);
    if (campo === 'metodo') return nombreDe(METODOS, v);
    if (campo === 'tipo') return nombreDe(TIPOS, v);
    if (campo === 'confirmado_banco') return v ? 'confirmado' : 'sin confirmar';
    if (campo === 'fecha') return fecha(v);
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }
  function textoCambio(c, nombres) {
    nombres = nombres || {};
    if (c.accion === 'alta') return ['Se registró'];
    if (c.accion === 'baja') return ['Se eliminó'];
    var a = c.antes || {}, d = c.despues || {}, out = [];
    Object.keys(CAMPOS).forEach(function (k) {
      if (!(k in a) && !(k in d)) return;
      if (JSON.stringify(a[k]) === JSON.stringify(d[k])) return;
      if (k === 'precio_total' || k === 'monto') { if (num(a[k]) === num(d[k])) return; }
      out.push(CAMPOS[k] + ': ' + valorLegible(k, a[k], nombres) + ' → ' + valorLegible(k, d[k], nombres));
    });
    return out;
  }

  var MOTIVOS = {
    sin_anticipo: 'Liquidación o abono sin su anticipo',
    varias_candidatas: 'Se unió a una venta, pero había otras parecidas',
    sin_tipo_pago: 'Sin tipo de pago claro',
    entrega_sin_venta: 'Entrega sin su venta',
    cancelada_sin_venta: 'Cancelación o devolución sin su venta',
    vendedor_parecido: 'Vendedores con nombre parecido',
    sin_remision: 'Liquidación sin remisión',
    monto_ilegible: 'Monto que no se pudo leer',
    sin_producto: 'Cobro sin producto'
  };

  return {esc: esc, num: num, dinero: dinero, fecha: fecha, lunesDe: lunesDe, hoy: hoy, saldo: saldo,
          etiquetaEstado: etiquetaEstado, TIPOS: TIPOS, METODOS: METODOS, nombreDe: nombreDe,
          validarMovimiento: validarMovimiento, textoCambio: textoCambio, MOTIVOS: MOTIVOS};
});
