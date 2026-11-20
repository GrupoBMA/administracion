// Dudas de la importación para revisar con Silvia (window.Dudas).
// Cada una se resuelve uniéndola a la venta correcta o marcándola como "está bien así".
// Resolver la primera duda cierra la importación (ya no se puede repetir).
(function () {
  var esc = BMA.esc, $ = function (id) { return document.getElementById(id); };
  // Motivos que traen un movimiento que se puede mover a otra venta
  var SE_UNEN = ['sin_anticipo', 'varias_candidatas', 'sin_tipo_pago', 'cancelada_sin_venta', 'sin_remision', 'sin_producto'];
  var st = {vista: 'pendiente', abiertos: {}};

  function cont() { return $('mod-dudas'); }

  function contar() {
    UI.llamar('bma_dudas', {p_estado: 'pendiente'}).then(function (ds) {
      var c = $('cuenta-dudas'); if (!c) return;
      c.hidden = !ds.length; c.textContent = ds.length;
    }).catch(function () {});
  }

  function pintar() {
    cont().innerHTML = '<div class="barra">' +
      ['pendiente', 'resuelta'].map(function (v) {
        return '<button class="filtro" data-vista="' + v + '">' + (st.vista === v ? '<b>' : '') + (v === 'pendiente' ? 'Pendientes' : 'Resueltas') +
          (st.vista === v ? '</b>' : '') + '</button>';
      }).join('') + '</div><div id="d-lista"><p class="vacio">Cargando…</p></div>';
    cont().querySelector('.barra').onclick = function (e) {
      var b = e.target.closest('[data-vista]'); if (b) { st.vista = b.dataset.vista; pintar(); }
    };
    UI.llamar('bma_dudas', {p_estado: st.vista}).then(function (ds) {
      var el = $('d-lista'); if (!el) return;
      if (!ds.length) { el.innerHTML = '<p class="vacio">' + (st.vista === 'pendiente' ? 'No hay dudas pendientes.' : 'Todavía no se resuelve ninguna.') + '</p>'; return; }
      var grupos = {};
      ds.forEach(function (d) { (grupos[d.motivo] = grupos[d.motivo] || []).push(d); });
      el.innerHTML = Object.keys(grupos).map(function (m) {
        var abierto = st.abiertos[m] || Object.keys(grupos).length === 1;
        return '<div class="seccion"><button class="volver" data-grupo="' + esc(m) + '">' + (abierto ? '▾ ' : '▸ ') +
          esc(BMA.MOTIVOS[m] || m) + ' · ' + grupos[m].length + '</button></div>' +
          (abierto ? '<div class="renglones">' + grupos[m].map(duda).join('') + '</div>' : '');
      }).join('');
      el.onclick = function (e) {
        var g = e.target.closest('[data-grupo]');
        if (g) { st.abiertos[g.dataset.grupo] = !st.abiertos[g.dataset.grupo]; pintar(); return; }
        var b = e.target.closest('[data-accion]'); if (!b) return;
        var d = ds.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (b.dataset.accion === 'abrir') { selModulo('ventas'); Ventas.abrir(d.venta.id); }
        else if (b.dataset.accion === 'unir') unir(d);
        else if (b.dataset.accion === 'bien') bien(d);
      };
    }).catch(function () {});
  }

  function duda(d) {
    var v = d.venta;
    var acciones = st.vista === 'pendiente'
      ? (v ? '<button data-accion="abrir" data-id="' + esc(d.id) + '">Abrir venta</button>' : '') +
        (SE_UNEN.indexOf(d.motivo) >= 0 ? '<button data-accion="unir" data-id="' + esc(d.id) + '">Unir a otra venta</button>' : '') +
        '<button data-accion="bien" data-id="' + esc(d.id) + '">Está bien así</button>'
      : (v ? '<button data-accion="abrir" data-id="' + esc(d.id) + '">Abrir venta</button>' : '');
    return '<div class="mov" style="padding:12px 16px"><span class="t" style="font-weight:500">' + esc(d.detalle) + '</span><span></span>' +
      '<span class="d">' + (v ? esc(v.folio) + ' · ' + esc(v.producto) : 'Sin venta') +
      (d.estado === 'resuelta' ? ' · resuelta' + (d.quien ? ' por ' + esc(d.quien) : '') + ', ' + BMA.fecha(d.resuelta_en) : '') +
      '</span><span></span><span class="acc">' + acciones + '</span></div>';
  }

  // Antes de la primera duda resuelta, avisa que la importación se cierra
  function avisoPrimera() {
    return UI.llamar('bma_dudas', {p_estado: 'resuelta'}).then(function (rs) {
      if (rs.length) return true;
      return UI.confirmar({titulo: 'Al resolver dudas ya no se puede repetir la importación',
                           ayuda: 'Lo importado se queda como está y se corrige desde la app.', si: 'Entendido'});
    });
  }

  function unir(d) {
    avisoPrimera().then(function (ok) {
      if (!ok) return null;
      return Ventas.buscarVenta('¿A qué venta pertenece?', d.venta && d.venta.sucursal);
    }).then(function (id) {
      if (!id) return null;
      if (d.venta && id === d.venta.id) { UI.aviso('Es la misma venta', true); return null; }
      return UI.confirmar({titulo: '¿Unir?', ayuda: 'El movimiento de ' + (d.venta ? d.venta.folio : 'esta duda') +
        ' pasa a la venta escogida. Si ' + (d.venta ? d.venta.folio : 'la venta') + ' queda vacía, se borra.', si: 'Unir'})
        .then(function (ok) { return ok ? UI.guardar('bma_duda_resolver', {p_id: d.id, p_unir_a: id, p_nota: null}) : null; })
        .then(function (r) { if (r !== null) { UI.aviso('Duda resuelta'); contar(); pintar(); } });
    }).catch(function () {});
  }

  function bien(d) {
    avisoPrimera().then(function (ok) {
      if (!ok) return null;
      return UI.pedirTexto({titulo: 'Está bien así', ayuda: 'Nota opcional: por qué está bien', tipo: 'largo', opcional: true, boton: 'Resolver'});
    }).then(function (nota) {
      if (nota === null || nota === undefined) return;
      return UI.guardar('bma_duda_resolver', {p_id: d.id, p_unir_a: null, p_nota: nota || null})
        .then(function (r) { if (r !== null) { UI.aviso('Duda resuelta'); contar(); pintar(); } });
    }).catch(function () {});
  }

  window.Dudas = {pintar: pintar, contar: contar};
})();
