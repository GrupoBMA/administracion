// Reglas del inventario de Odoo, sin DOM (se prueba con node --test tests/*.test.js). En el navegador: window.OdooL.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.OdooL = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var LARGO_ROLLO = 25;   // metros de un rollo completo de pasto

  function capital(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/(\d)\s*(Mm|Cc)\b/g, function (m, d, u) { return d + ' ' + u.toLowerCase(); });
  }

  // "Aguascalientes - SUNL Showroom" -> "Aguascalientes"; "Bodega 1 - SUNL (Granja)" -> "Bodega 1 (Granja)"
  function nombreAlmacen(nombre) {
    return String(nombre || '').replace(/\s*-\s*SUNL( Showroom)?/i, '').trim();
  }

  // El nombre de Odoo es muy largo: "[ATV125-CR-VEC] ATV O CUATRIMOTO … AUTOMÁTICA (VERDE CAMU)".
  // Se muestra el tipo (de la categoría, sin la empresa: "ATV 125 cc") y el color (lo último entre paréntesis).
  function producto(p) {
    var nombre = String(p.nombre || '').replace(/^\[[^\]]*\]\s*/, '');
    var partes = String(p.categoria || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean);
    var empresa = partes.length ? partes[0] : '';
    var tipo = partes.slice(1).join(' ');
    var paren = nombre.match(/\(([^()]*)\)\s*$/);
    var color = paren ? capital(paren[1]) : '';
    if (/^PASTITO/i.test(empresa)) {
      var sub = nombre.match(/SUBMARCA\s+(.+?)(\s*\(|$)/i);
      var ancho = anchoPasto(p);
      return {titulo: 'Pasto ' + capital(sub ? sub[1] : nombre) + (ancho ? ' · ' + ancho + ' m' : ''), color: '', empresa: 'Pastito', codigo: p.codigo || ''};
    }
    var siglas = function (s) { return s.replace(/\b(Atv|Utv)\b/g, function (x) { return x.toUpperCase(); }); };
    tipo = siglas(tipo ? capital(tipo) : capital(nombre.replace(/\([^()]*\)\s*$/, '').split(/\s+NUEV[OA]\b/i)[0]));
    // familia: "ATV" (todas las ATV juntas); variante: lo que la distingue dentro ("125 cc", "Eléctrica")
    var familia = partes.length > 1 ? siglas(capital(partes[1])) : tipo;
    var variante = partes.length > 2 ? siglas(capital(partes.slice(2).join(' '))) : '';
    return {titulo: tipo, color: color, empresa: capital(empresa), codigo: p.codigo || '', familia: familia, variante: variante};
  }
  // Número de serie corto: de un VIN de 17 solo sirven a simple vista los últimos 5. Lo que no parece VIN va completo.
  function serieCorta(s) {
    s = String(s || '');
    return /^[A-Z0-9]{11,}$/i.test(s) ? s.slice(-5) : s;
  }

  // Ancho del pasto (2 o 4 m): de la clave "P-OA-2M-18MM" o del nombre "(2 m)"
  function anchoPasto(p) {
    var m = String(p.codigo || '').match(/-(\d)M(-|$)/i) || String(p.nombre || '').match(/\((\d)\s*m\)/i);
    return m ? +m[1] : null;
  }
  // Metros cuadrados -> rollos completos equivalentes (con un decimal)
  function rollos(m2, ancho) {
    if (!ancho || !(m2 > 0)) return null;
    return Math.round(m2 / (ancho * LARGO_ROLLO) * 10) / 10;
  }

  // "ABCDE12345F000001 / 24 16 1234 4000001" -> {serie, pedimento}
  function serie(lote) {
    var t = String(lote || '').split(/\s*\/\s*/);
    return {serie: t[0] || '', pedimento: t.slice(1).join(' / ').replace(/\s+/g, ' ').trim()};
  }

  // Qué fue un movimiento visto desde un almacén (o en general si no se da almacén)
  // clave: qué ícono lleva; tono: entra (verde), venta (azul), neutro (gris) o alerta (rojo)
  function tipoMov(m, alm) {
    var de = m.de_uso, a = m.a_uso;
    if (de === 'inventory') return {texto: 'Ajuste: se agregó', signo: 1, alerta: true, clave: 'ajuste', tono: 'alerta'};
    if (a === 'inventory') return {texto: 'Ajuste: se quitó', signo: -1, alerta: true, clave: 'ajuste', tono: 'alerta'};
    if (a === 'customer') return {texto: 'Venta', signo: -1, clave: 'venta', tono: 'venta'};
    if (de === 'customer') return {texto: 'Regresó de cliente', signo: 1, alerta: true, clave: 'regreso', tono: 'alerta'};
    if (de === 'supplier') return {texto: 'Llegó de proveedor', signo: 1, clave: 'llego', tono: 'entra'};
    if (a === 'supplier') return {texto: 'Se regresó al proveedor', signo: -1, clave: 'regreso', tono: 'neutro'};
    if (a === 'transit') return {texto: 'Salió en tránsito', signo: -1, clave: 'transito', tono: 'neutro'};
    if (de === 'transit') return {texto: 'Llegó de tránsito', signo: 1, clave: 'transito', tono: 'entra'};
    if (m.de_almacen && m.a_almacen && m.de_almacen !== m.a_almacen) {
      if (alm && m.a_almacen === alm) return {texto: 'Traspaso de ' + m.de_almacen, signo: 1, clave: 'traspaso', tono: 'entra'};
      if (alm && m.de_almacen === alm) return {texto: 'Traspaso a ' + m.a_almacen, signo: -1, clave: 'traspaso', tono: 'neutro'};
      return {texto: 'Traspaso', signo: 0, clave: 'traspaso', tono: 'neutro'};
    }
    return {texto: 'Cambio de lugar', signo: 0, clave: 'lugar', tono: 'neutro'};
  }

  // Fecha y hora en México: "23 nov, 1:23 p. m."
  function fechaHora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = new Intl.DateTimeFormat('es-MX', {timeZone: 'America/Mexico_City', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})
      .formatToParts(d).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
    return p.day + ' ' + MESES[+p.month - 1] + ', ' + p.hour + ':' + p.minute + (p.dayPeriod ? ' ' + p.dayPeriod : '');
  }
  function diaMx(iso) {
    var d = new Date(iso);
    var p = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Mexico_City'}).format(d);
    return p; // YYYY-MM-DD
  }
  // "hoy", "ayer", "hace 5 días", "hace 3 semanas"
  function hace(iso, ahora) {
    if (!iso) return 'nunca';
    var a = Date.parse(diaMx(ahora ? new Date(ahora).toISOString() : new Date().toISOString())),
        b = Date.parse(diaMx(iso));
    var dias = Math.round((a - b) / 864e5);
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 14) return 'hace ' + dias + ' días';
    return 'hace ' + Math.round(dias / 7) + ' semanas';
  }
  // Lunes (en México) de la semana de una fecha, para agrupar
  function lunes(iso) {
    var p = diaMx(iso).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function semana(lunesIso) {
    var p = lunesIso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), f = new Date(d.getTime() + 6 * 864e5);
    var a = d.getUTCDate() + (d.getUTCMonth() !== f.getUTCMonth() ? ' ' + MESES[d.getUTCMonth()] : '');
    return 'Semana del ' + a + ' al ' + f.getUTCDate() + ' ' + MESES[f.getUTCMonth()];
  }

  // Cantidad legible: 1 pieza, 3 piezas, 434.89 m²
  function cantidad(n, unidad) {
    var v = Math.round(Number(n) * 100) / 100;
    var t = v.toLocaleString('en-US', {maximumFractionDigits: 2});
    if (/m²|m2/i.test(unidad || '')) return t + ' m²';
    return t + (Math.abs(v) === 1 ? ' pieza' : ' piezas');
  }

  // Agrupa existencias en Vehículos (con serie), Pasto y Otros
  function clase(e) {
    if (/^PASTITO/i.test(e.categoria || '')) return 'pasto';
    if (e.seguimiento === 'serial') return 'vehiculos';
    return 'otros';
  }

  var ALERTAS = {
    negativo: 'Existencia en negativo',
    serie: 'Misma serie en dos lugares o repetida',
    otra_persona: 'Salidas que no registró la sucursal',
    devolucion: 'Regresó de un cliente',
    ajuste: 'Ajustes de inventario',
    sin_venta: 'Salió a un cliente sin orden de venta',
    cambio: 'Se cambió después de registrarse',
    sin_movimientos: 'Sin movimientos en Odoo'
  };

  return {nombreAlmacen: nombreAlmacen, producto: producto, anchoPasto: anchoPasto, rollos: rollos, serie: serie, serieCorta: serieCorta,
          tipoMov: tipoMov, fechaHora: fechaHora, hace: hace, lunes: lunes, semana: semana, cantidad: cantidad, clase: clase,
          ALERTAS: ALERTAS, capital: capital};
});
