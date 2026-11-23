// Registrar en una sola pantalla con pasos numerados (window.Registrar), como el registro de GVF.
// "Nueva venta" se entra desde el menú (Registrar.abrir); un pago, solo desde la ficha de su venta (Registrar.pagoDe),
// para que haya un solo lugar donde registrarlo. Aparecen solo los pasos que tocan; nada se guarda hasta "Guardar".
(function () {
  var esc = BMA.esc, $ = function (id) { return document.getElementById(id); };
  var LINEAS = [{valor: 'motos', nombre: 'Motos'}, {valor: 'pasto', nombre: 'Pasto'}, {valor: 'otro', nombre: 'Otro'}];
  var PAGO_INICIAL = [{valor: 'contado', nombre: 'Contado'}, {valor: 'anticipo', nombre: 'Anticipo'}];
  var TIPOS_PAGO = BMA.TIPOS.filter(function (t) { return t.valor !== 'contado'; });
  var st, combos = {};

  function limpio(que) {
    return {que: que || 'nueva', venta: null, v: {linea: 'motos', fecha: BMA.hoy()}, m: {fecha: BMA.hoy()}, mas: false};
  }
  st = limpio();

  function cont() { return $('mod-registrar'); }
  function chips(grupo, ops, valor) {
    return '<div class="chips" role="group">' + ops.map(function (o) {
      return '<button type="button" class="chip-op' + (o.valor === valor ? ' on' : '') + '" aria-pressed="' + (o.valor === valor) +
        '" data-grupo="' + grupo + '" data-valor="' + esc(o.valor) + '">' + esc(o.nombre) + '</button>';
    }).join('') + '</div>';
  }
  function paso(n, titulo, cuerpo, opcional) {
    return '<section class="paso"><h3 class="paso-tit"><span class="paso-n">' + n + '</span>' + esc(titulo) +
      (opcional ? ' <span class="opcional">opcional</span>' : '') + '</h3>' + cuerpo + '</section>';
  }
  function campo(id, valor, o) {
    o = o || {};
    return '<input class="campo' + (o.num ? ' num' : '') + '" id="' + id + '" type="' + (o.tipo || 'text') + '"' +
      (o.num ? ' inputmode="decimal"' : '') + (o.max ? ' max="' + o.max + '"' : '') +
      ' value="' + esc(valor == null ? '' : valor) + '" placeholder="' + esc(o.ph || '') + '" autocomplete="off">';
  }
  function conDinero(tipo) { return BMA.TIPOS.some(function (t) { return t.valor === tipo && t.conDinero; }); }

  function pagoHtml(n, tipos) {
    var m = st.m, h = paso(n++, '¿Qué tipo de pago?', chips('tipo', tipos, m.tipo));
    if (m.tipo && conDinero(m.tipo)) {
      h += paso(n++, '¿Cuánto y cómo?', '<div class="fila2"><label class="lbl">Monto<span class="monto-in">$' +
        campo('r-monto', m.monto, {num: true, ph: '0.00'}) + '</span></label><label class="lbl">Cuenta<span>' +
        campo('r-cuenta', m.cuenta, {ph: 'Banco donde cayó, p. ej. HSBC'}) + '</span></label></div>' +
        '<div class="lbl">Método</div>' + chips('metodo', BMA.METODOS, m.metodo));
    }
    if (m.tipo) h += paso(n++, 'Fecha', campo('r-fecha', m.fecha, {tipo: 'date', max: BMA.hoy()}));
    return {html: h, n: n};
  }

  function pintar() {
    var n = 1, h = st.que === 'pago' && st.venta ? '<div class="ficha-top"><button class="volver" id="r-volver">‹ Volver a la venta</button></div>' : '';
    h += '<div class="registro">';
    if (st.que === 'nueva') {
      var v = st.v;
      h += paso(n++, 'Sucursal', chips('sucursal', BMA.SUCURSALES, v.sucursal));
      h += paso(n++, 'Cliente', '<div id="r-cliente"></div>');
      h += paso(n++, 'Producto', campo('r-producto', v.producto, {ph: 'p. ej. MC 200 PICK UP'}) +
        '<div class="lbl">Línea</div>' + chips('linea', LINEAS, v.linea));
      var p = pagoHtml(n, PAGO_INICIAL); h += p.html; n = p.n;
      h += '<button type="button" class="mas" id="r-mas">' + (st.mas ? 'Menos datos' : 'Más datos: vendedor, remisión, factura' +
        (st.m.tipo === 'anticipo' ? ', precio' : '') + ', nota') + '</button>';
      if (st.mas) {
        h += paso(n++, 'Más datos', '<div class="lbl">Vendedor</div><div id="r-vendedor"></div><div class="fila2">' +
          '<label class="lbl">Remisión o nota<span>' + campo('r-remision', v.remision) + '</span></label>' +
          '<label class="lbl">Factura<span>' + campo('r-factura', v.factura) + '</span></label></div>' +
          (st.m.tipo === 'anticipo' ? '<label class="lbl">Precio total<span class="monto-in">$' + campo('r-precio', v.precio_total, {num: true, ph: 'Si ya se sabe'}) + '</span></label>' : '') +
          '<label class="lbl">Nota<span>' + campo('r-nota', st.m.nota) + '</span></label>', true);
      }
    } else if (st.que === 'pago') {
      h += paso(n++, 'Venta', ventaElegida());
      var q = pagoHtml(n, TIPOS_PAGO); h += q.html; n = q.n;
      if (st.m.tipo) h += paso(n++, 'Nota', campo('r-nota', st.m.nota), true);
    }
    if (st.que) h += '<div class="guardar"><p class="resumen" id="r-resumen"></p><p class="error" id="r-falta" hidden></p>' +
      '<div class="acciones"><button type="button" class="btn" id="r-limpiar">Empezar de nuevo</button>' +
      '<button type="button" class="btn primario" id="r-guardar">Guardar</button></div></div>';
    cont().innerHTML = h + '</div>';
    conectar();
    resumen();
  }

  function ventaElegida() {
    var v = st.venta, e = BMA.etiquetaEstado(v);
    return '<div class="elegida"><div><b>' + (v.remision ? 'Rem. ' + esc(v.remision) + ' · ' : '') + esc(v.producto) + '</b><div class="sec">' + esc(v.folio) + ' · ' +
      esc(v.cliente ? v.cliente.nombre : 'Sin cliente') + ' · pagado ' + BMA.dinero(v.pagado) +
      (BMA.saldo(v) ? ' · saldo ' + BMA.dinero(BMA.saldo(v)) : '') + ' · <span class="chip-estado ' + e.clase + '">' + esc(e.texto) + '</span></div></div></div>';
  }

  function conectar() {
    var raiz = cont();
    raiz.onclick = function (ev) {
      var b = ev.target.closest('[data-grupo]');
      if (b) {
        var g = b.dataset.grupo, val = b.dataset.valor;
        if (g === 'tipo' || g === 'metodo') { leer(); st.m[g] = val; }
        else { leer(); st.v[g] = val; }
        pintar(); return;
      }
      if (ev.target.id === 'r-mas') { leer(); st.mas = !st.mas; pintar(); return; }
      if (ev.target.id === 'r-volver') { volverAVenta(); return; }
      if (ev.target.id === 'r-limpiar') { st.m = {fecha: BMA.hoy()}; if (st.que === 'nueva') st = limpio('nueva'); pintar(); return; }
      if (ev.target.id === 'r-guardar') { guardar(); return; }
    };
    raiz.oninput = function () { leer(); resumen(); };
    if ($('r-cliente')) combos.cliente = UI.combo($('r-cliente'), {tipo: 'cliente', placeholder: 'Escribe el nombre del cliente',
      valor: st.v.cliente, alCambiar: function (p) { st.v.cliente = p; resumen(); }});
    if ($('r-vendedor')) combos.vendedor = UI.combo($('r-vendedor'), {tipo: 'vendedor', placeholder: 'Escribe el nombre del vendedor',
      valor: st.v.vendedor, alCambiar: function (p) { st.v.vendedor = p; }});
  }

  function leer() {
    var val = function (id) { var e = $(id); return e ? e.value.trim() : undefined; };
    var n = function (id) { var s = val(id); if (s === undefined) return undefined; s = s.replace(/[$,\s]/g, ''); return s === '' ? null : Number(s); };
    if (val('r-producto') !== undefined) st.v.producto = val('r-producto');
    if (val('r-remision') !== undefined) st.v.remision = val('r-remision');
    if (val('r-factura') !== undefined) st.v.factura = val('r-factura');
    if (n('r-precio') !== undefined) st.v.precio_total = n('r-precio');
    if (n('r-monto') !== undefined) st.m.monto = n('r-monto');
    if (val('r-cuenta') !== undefined) st.m.cuenta = val('r-cuenta');
    if (val('r-fecha') !== undefined) st.m.fecha = val('r-fecha');
    if (val('r-nota') !== undefined) st.m.nota = val('r-nota');
  }

  // Lo que falta, en el orden de los pasos; null si ya se puede guardar
  function falta() {
    var m = st.m;
    if (st.que === 'nueva') {
      if (!st.v.sucursal) return 'Falta la sucursal';
      if (!st.v.cliente) return 'Falta el cliente';
      if (!st.v.producto) return 'Falta el producto';
    } else if (!st.venta) return 'Falta escoger la venta';
    if (!m.tipo) return 'Falta el tipo de pago';
    if (m.monto != null && !(m.monto > 0) && conDinero(m.tipo)) return 'El monto debe ser mayor que cero';
    if (st.v.precio_total != null && !(st.v.precio_total > 0)) return 'El precio debe ser mayor que cero';
    return BMA.validarMovimiento(m);
  }

  function resumen() {
    var r = $('r-resumen'); if (!r) return;
    var m = st.m, venta = st.que === 'nueva' ? st.v : st.venta;
    if (!m.tipo || !venta) { r.textContent = ''; return; }
    var t = BMA.nombreDe(BMA.TIPOS, m.tipo);
    var partes = [t + (conDinero(m.tipo) && m.monto > 0 ? ' de ' + BMA.dinero(m.monto) : '') +
      (conDinero(m.tipo) && m.metodo ? ' en ' + BMA.nombreDe(BMA.METODOS, m.metodo).toLowerCase() : '') + (m.cuenta ? ' a ' + m.cuenta : '')];
    if (venta.producto) partes.push('por ' + venta.producto);
    var cli = st.que === 'nueva' ? st.v.cliente : st.venta.cliente;
    if (cli) partes.push('para ' + cli.nombre);
    if (venta.sucursal) partes.push(BMA.nombreDe(BMA.SUCURSALES, venta.sucursal));
    r.textContent = partes.join(' · ') + (m.fecha ? ', ' + BMA.fecha(m.fecha) : '');
  }

  function guardar() {
    leer();
    var f = falta(), aviso = $('r-falta');
    if (f) { aviso.textContent = f; aviso.hidden = false; return; }
    aviso.hidden = true;
    var m = {tipo: st.m.tipo, monto: conDinero(st.m.tipo) ? st.m.monto : 0, metodo: st.m.metodo || null,
             cuenta: st.m.cuenta || null, fecha: st.m.fecha, nota: st.m.nota || null};
    var llamada = st.que === 'nueva'
      ? UI.guardar('bma_venta_nueva', {p: {sucursal: st.v.sucursal, fecha: st.m.fecha, producto: st.v.producto, linea: st.v.linea,
          cliente_id: st.v.cliente.id, vendedor_id: st.v.vendedor ? st.v.vendedor.id : null, remision: st.v.remision || null,
          factura: st.v.factura || null, precio_total: st.m.tipo === 'anticipo' ? st.v.precio_total : null, movimiento: m}})
          .then(function (r) { return r && r.id; })
      : UI.guardar('bma_movimiento_nuevo', {p_venta: st.venta.id, p: m}).then(function (r) { return r ? st.venta.id : null; });
    $('r-guardar').disabled = true;
    llamada.then(function (ventaId) {
      if (!ventaId) { $('r-guardar').disabled = false; return; }
      UI.aviso('Guardado');
      st = limpio(st.que === 'pago' ? 'nueva' : st.que);
      selModulo('ventas'); Ventas.abrir(ventaId);
    }).catch(function () { if ($('r-guardar')) $('r-guardar').disabled = false; });
  }

  // El único camino para registrar un pago: el botón "Registrar pago" de la ficha de la venta
  function pagoDe(venta) { st = limpio('pago'); st.venta = venta; ir('pago'); }
  function volverAVenta() { var id = st.venta && st.venta.id; st = limpio('nueva'); selModulo('ventas'); if (id) Ventas.abrir(id); }

  // Desde el menú (o el "atrás" del navegador): si ya estaba en esa misma opción, se conserva lo capturado.
  // Un pago sin su venta (p. ej. al regresar con "atrás" después de guardarlo) no tiene a qué aplicarse: vuelve a la lista.
  function abrir(que) {
    if (que === 'pago' && !(st.que === 'pago' && st.venta)) { ir('ventas', {reemplazar: true}); return; }
    if (st.que !== que) st = limpio(que);
    pintar();
  }
  function que() { return st.que; }

  window.Registrar = {pintar: pintar, pagoDe: pagoDe, abrir: abrir, que: que};
})();
