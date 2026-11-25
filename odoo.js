// Inventario Odoo (window.Odoo), solo admin. Lee la copia de Odoo que guarda la función de Supabase "bma-odoo"
// (cada noche y con "Actualizar"). Pantallas: Existencias (por sucursal, hoy o cualquier día), Movimientos y Revisar
// (alertas para marcar como revisadas). Buscar serie no es pantalla: es el buscador de arriba de Existencias y
// Movimientos, y cada serie se abre en una ficha aparte con su recorrido (como el rastreo de un paquete).
// Nada aquí escribe en Odoo.
(function () {
  var esc = BMA.esc, L = OdooL, $ = function (id) { return document.getElementById(id); };
  var st = {op: 'od-existencias', dia: null, alm: null, fam: null, vari: {}, clase: 'vehiculos', abiertos: {}, movAlm: null, q: '', vista: 'pendiente', grupos: {}, pintado: null};
  var copiaEs = {clave: null, es: null};
  var resumen = null, actualizando = false, tBuscar = null, panelLote = null, panelProd = null;

  // ---------------------------------------------------------------- Íconos (mismo trazo que los del menú)
  var IC = {
    buscar: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    cerrar: '<path d="M7 7l10 10M17 7 7 17"/>',
    moto: '<circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="3"/><path d="M5.5 16.5h5.5l3.5-7H17l1.5 7"/><path d="M13 6.5h3l1 3M8 12.5h4.5"/>',
    pasto: '<path d="M4 20h16"/><path d="M7 20c0-4-1.5-7-3-9 2.5.8 4.5 3 5 6"/><path d="M12 20c0-5 .5-10 0-14 1.6 2.6 2.6 6 2 10"/><path d="M17 20c0-3 1.2-6 3-8-2.6.4-4.4 2.6-5 5"/>',
    caja: '<path d="M3.5 8 12 4l8.5 4-8.5 4z"/><path d="M3.5 8v8.5L12 20.5l8.5-4V8M12 12v8.5"/>',
    llego: '<path d="M2.5 6.5h11v9h-11z"/><path d="M13.5 9.5h4l3 3.2v2.8h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
    transito: '<path d="M2.5 6.5h11v9h-11z"/><path d="M13.5 9.5h4l3 3.2v2.8h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
    traspaso: '<path d="M4 8h13M13.5 4.5 17 8l-3.5 3.5M20 16H7M10.5 12.5 7 16l3.5 3.5"/>',
    venta: '<path d="M5.5 8.5h13l-1 11.5h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    regreso: '<path d="M9 6.5 4.5 11 9 15.5"/><path d="M4.5 11H15a4.5 4.5 0 0 1 0 9h-2.5"/>',
    ajuste: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    lugar: '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    tienda: '<path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6z"/><path d="M10 20v-5h4v5"/>',
    alerta: '<path d="M12 4.5 3 19.5h18z"/><path d="M12 10.5v3.5"/><path d="M12 16.8h.01" stroke-width="2.6"/>',
    editar: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="m12.5 7.5 4 4"/>',
    reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    copia: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    negativo: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
    persona: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.3-3.3 3.8-5 7-5s5.7 1.7 7 5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    flecha: '<path d="m9 6 6 6-6 6"/>',
    atv: '<circle cx="6" cy="16.5" r="3.2"/><circle cx="18" cy="16.5" r="3.2"/><path d="M2.5 13.5c1.2-2.6 5.8-2.6 7 0h5c1.2-2.6 5.8-2.6 7 0"/><path d="M8.5 10.5h6l1.2 3"/><path d="M16.2 10.5 17.8 7h2.2"/>',
    cross: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9.5 11h6l3 5.5"/><path d="M8 8.8h5.5"/><path d="M15.5 11 17 6.5h2.5"/>',
    utv: '<circle cx="6" cy="17" r="2.8"/><circle cx="18" cy="17" r="2.8"/><path d="M2.5 14h19"/><path d="M6.5 14V7h8.5l3.5 7"/><path d="M10.8 7v7"/>',
    gokart: '<circle cx="5.5" cy="17" r="2.5"/><circle cx="18.5" cy="17" r="2.5"/><path d="M2.5 14h19"/><path d="M7.5 14v-3.5h4l1 3.5"/><path d="M15.5 14 17 9.5"/><path d="M15.5 9.5h3"/>',
    motocarro: '<circle cx="6" cy="17.5" r="2.3"/><circle cx="18" cy="17.5" r="2.3"/><path d="M3.7 17.5V9.5h4.8l2.5 4v4"/><path d="M11 10.5h9.5v7"/><path d="M8.3 17.5h7.4"/>',
    mototaxi: '<circle cx="6" cy="17.5" r="2.3"/><circle cx="18" cy="17.5" r="2.3"/><path d="M3.7 15V8.5A2.5 2.5 0 0 1 6.2 6h10.3l4 7v4.5"/><path d="M3.7 15h16.8"/><path d="M8.3 17.5h7.4"/><path d="M10.5 6v9"/>',
    patin: '<circle cx="5.5" cy="17.5" r="2"/><circle cx="18.5" cy="17.5" r="2"/><path d="M7.5 17.5h9"/><path d="M18.5 17.5 15.5 5h-3"/>',
    bici: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 9 9.5h7l2.5 6.5"/><path d="M9 9.5l3.5 6.5H16"/><path d="M7.8 7.5h2.6M14.8 7h2.5"/>',
    silla: '<circle cx="10" cy="16" r="4"/><circle cx="18" cy="18.8" r="1.4"/><path d="M7 4.5V12h7.5l3 6.5"/><path d="M7 8h6"/>',
    montacargas: '<circle cx="6.5" cy="17.5" r="2.3"/><circle cx="14.5" cy="17.5" r="2.3"/><path d="M4.2 15V9.5h4l3 5.5h6"/><path d="M8.2 9.5V5.5h3.5"/><path d="M19 4v13.5h2.5"/>',
    chasis: '<path d="M3.5 8h17M3.5 16h17M7 8v8M12 8v8M17 8v8"/>',
    padel: '<ellipse cx="10" cy="9.5" rx="5.5" ry="6"/><path d="m13.6 14 5.4 5.5"/><path d="M8 8h.01M11 8h.01M9.5 11h.01" stroke-width="2.4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01" stroke-width="2.6"/>',
    actualizar: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>'
  };
  function ico(k) { return '<svg class="od-ic" viewBox="0 0 24 24" aria-hidden="true">' + (IC[k] || IC.lugar) + '</svg>'; }
  // Ícono en su casilla de color (tono: entra, venta, neutro o alerta)
  // Fotos de las portadas de sunldemexico.com (img/odoo). Las familias sin foto se quedan con su dibujo.
  var FOTOS = {atv: 1, cross: 1, gokart: 1, motocarro: 1, mototaxi: 1, patin: 1, utv: 1};
  function foto(fig, pista) {
    if (fig === 'cross' && /^50\b|\b50\s*cc\b/i.test(pista || '')) return 'img/odoo/minimoto.jpg';
    return FOTOS[fig] ? 'img/odoo/' + fig + '.jpg' : '';
  }
  // Foto (si hay) o dibujo en su casilla de color
  function imagen(fig, pista, clase, claseIco) {
    var f = foto(fig, pista);
    return f ? '<span class="od-foto ' + clase + '"><img src="' + f + '" alt="" decoding="async"></span>' : icoC(fig, 'venta', claseIco);
  }
  function icoC(k, tono, extra) { return '<span class="od-icc tono-' + (tono || 'neutro') + (extra ? ' ' + extra : '') + '">' + ico(k) + '</span>'; }
  var ICO_CLASE = {vehiculos: 'moto', pasto: 'pasto', otros: 'caja'};
  var ICO_ALERTA = {negativo: 'negativo', serie: 'copia', otra_persona: 'persona', devolucion: 'regreso', ajuste: 'ajuste',
                    sin_venta: 'venta', cambio: 'editar', sin_movimientos: 'reloj'};

  // Lo de Odoo se pinta en #od-base; la ficha de la serie va aparte, dentro del mismo módulo (se esconde con él)
  function cont() {
    var m = $('mod-odoo'), b = $('od-base');
    if (!b) { b = document.createElement('div'); b.id = 'od-base'; m.appendChild(b); }
    return b;
  }
  function nomAlm(codigo) {
    var a = resumen && resumen.almacenes.filter(function (x) { return x.codigo === codigo; })[0];
    return a ? L.nombreAlmacen(a.nombre) : (codigo || '');
  }
  function conNombres(t) { return String(t).replace(/(S-[A-Z0-9]+)/g, function (c) { return nomAlm(c); }); }
  function num(n) { return (Math.round(Number(n) * 100) / 100).toLocaleString('en-US', {maximumFractionDigits: 2}); }
  function cargarResumen() {
    return UI.llamar('bma_odoo_resumen', {p_dia: st.dia}).then(function (r) { resumen = r; marcarCuenta(r.pendientes); return r; });
  }
  function marcarCuenta(n) {
    document.querySelectorAll('.cuenta-odoo').forEach(function (c) { c.hidden = !n; c.textContent = n; });
  }
  function contar() { UI.llamar('bma_odoo_resumen', {p_dia: null}).then(function (r) { marcarCuenta(r.pendientes); }).catch(function () {}); }

  // estado: lo que guardó el historial del navegador (sucursal abierta y serie abierta).
  // Si solo cambió la serie (abrir o cerrar su ficha), no se vuelve a pintar lo de abajo.
  function abrir(op, seguir, estado) {
    var serie = seguir && estado ? estado.odSerie || null : null;
    if (seguir && estado && op === st.op && st.pintado === op + '|' + (estado.odAlm || '') + '|' + (estado.odFam || '')) { panel(serie); return; }
    st.op = op;
    if (!seguir) { st.alm = null; st.fam = null; st.abiertos = {}; st.q = ''; }
    else if (estado && op === 'od-existencias') { st.alm = estado.odAlm || null; st.fam = estado.odFam || null; }
    panel(serie);
    pintar();
  }

  function pintar() {
    var ex = st.op === 'od-existencias';
    st.pintado = st.op + '|' + (ex && st.alm || '') + '|' + (ex && st.fam || '');
    if (st.op === 'od-movimientos') return movimientos();
    if (st.op === 'od-revisar') return revisar();
    return existencias();
  }

  // ---------------------------------------------------------------- Barra de arriba: buscador, día y Actualizar
  function barra(o) {
    var copia = resumen && resumen.ultima_copia;
    return '<div class="barra od-barra">' + (o.buscar ? buscador() : '') + (o.extra || '') +
      (o.dia ? UI.filtro('od-dia', 'Ver', st.dia ? BMA.fecha(st.dia) : 'Hoy') : '') +
      (o.buscar ? '' : '<span class="relleno"></span>') +
      '<button type="button" class="btn od-act" id="od-act"' + (actualizando ? ' disabled' : '') +
      (copia ? ' title="Copia de Odoo ' + esc(L.fechaHora(copia.fin)) + '"' : '') + '>' + ico('actualizar') +
      '<span>' + (actualizando ? 'Actualizando…' : 'Actualizar') + '</span>' +
      '</button></div>';
  }
  function enganchar() {
    var d = $('od-dia');
    if (d) d.onclick = function () {
      UI.pedirTexto({titulo: '¿Qué día quieres ver?', ayuda: 'Vacío = hoy', tipo: 'date', valor: st.dia || '', max: BMA.hoy(), opcional: true, boton: 'Ver'})
        .then(function (v) { if (v === null) return; st.dia = v || null; pintar(); });
    };
    var a = $('od-act');
    if (a) a.onclick = actualizar;
    engancharBuscador();
  }
  function actualizar() {
    if (actualizando) return;
    actualizando = true; pintar();
    sb.functions.invoke('bma-odoo', {body: {accion: 'copiar'}}).then(function (r) {
      actualizando = false;
      var d = r.data || {};
      if (r.error || d.error) { UI.aviso(d.error || 'No se pudo actualizar', true); pintar(); return; }
      var cambios = (d.existencias_cambiadas || 0) + (d.movimientos_nuevos || 0) + (d.movimientos_cambiados || 0);
      UI.aviso(cambios ? 'Listo: ' + d.movimientos_nuevos + ' movimientos nuevos' : 'Listo: no hubo cambios en Odoo');
      pintar();
    }).catch(function () { actualizando = false; UI.aviso('No se pudo actualizar', true); pintar(); });
  }

  // ---------------------------------------------------------------- Buscador de series (arriba, siempre a la mano)
  // Mientras hay algo escrito, lo de abajo (#od-cuerpo) se esconde y salen los resultados (#od-res).
  function buscador() {
    return '<label class="od-buscar">' + ico('buscar') +
      '<input type="search" id="od-q" placeholder="Buscar serie" aria-label="Buscar número de serie" autocomplete="off" spellcheck="false" enterkeyhint="search" value="' + esc(st.q) + '">' +
      '<button type="button" class="od-limpiar" id="od-limpiar" aria-label="Borrar búsqueda"' + (st.q ? '' : ' hidden') + '>' + ico('cerrar') + '</button></label>';
  }
  function engancharBuscador() {
    var q = $('od-q'); if (!q) return;
    q.oninput = function () {
      $('od-limpiar').hidden = !q.value;
      clearTimeout(tBuscar); tBuscar = setTimeout(function () { st.q = q.value.trim(); resultados(); }, 250);
    };
    q.onkeydown = function (e) { if (e.key === 'Escape' && q.value) { e.stopPropagation(); limpiar(); } };
    $('od-limpiar').onclick = limpiar;
    if (st.q) resultados();
  }
  function limpiar() {
    var q = $('od-q'); q.value = ''; st.q = ''; $('od-limpiar').hidden = true; resultados(); q.focus();
  }
  function resultados() {
    var el = $('od-res'), cuerpo = $('od-cuerpo'); if (!el) return;
    var buscando = !!st.q;
    el.hidden = !buscando; if (cuerpo) cuerpo.hidden = buscando;
    if (!buscando) { el.innerHTML = ''; return; }
    if (st.q.replace(/\s/g, '').length < 4) { el.innerHTML = '<p class="vacio">Escribe al menos 4 letras o números de la serie.</p>'; return; }
    var buscado = st.q;
    el.innerHTML = '<p class="vacio">Buscando…</p>';
    UI.llamar('bma_odoo_serie', {p_q: st.q}).then(function (rs) {
      if (buscado !== st.q || !$('od-res')) return;
      if (!rs.length) { el.innerHTML = '<div class="od-nada">' + icoC('buscar', 'neutro') + '<b>No hay ninguna serie con “' + esc(st.q) + '”</b></div>'; return; }
      el.innerHTML = '<div class="renglones">' + rs.slice(0, 30).map(function (r, i) {
        var s = L.serie(r.lote), ahora = dondeEsta(r);
        return '<button type="button" class="renglon od-fila" data-i="' + i + '">' + icoC(L.figura('', r.producto || ''), ahora.tono) +
          '<span class="od-fila-txt"><b class="num">' + resaltar(L.serieCorta(s.serie), st.q) + '</b><small>' + esc(nombreProducto(r)) + '</small></span>' +
          '<span class="od-fila-der' + (ahora.tono === 'alerta' ? ' od-alerta' : '') + '">' + esc(ahora.corto) + '</span>' + ico('flecha') + '</button>';
      }).join('') + '</div>' + (rs.length > 30 ? '<p class="mas-res">Y ' + (rs.length - 30) + ' más. Escribe más números de la serie.</p>' : '');
      el.onclick = function (e) {
        var b = e.target.closest('[data-i]'); if (b) abrirSerie(rs[+b.dataset.i].lote, null, rs[+b.dataset.i]);
      };
    }).catch(function () {});
  }
  // Marca en negritas la parte que coincide con lo buscado (sin espacios ni mayúsculas)
  function resaltar(serie, q) {
    var limpio = q.replace(/\s/g, '').toUpperCase(), i = serie.toUpperCase().indexOf(limpio);
    if (i < 0 || !limpio) return esc(serie);
    return esc(serie.slice(0, i)) + '<mark>' + esc(serie.slice(i, i + limpio.length)) + '</mark>' + esc(serie.slice(i + limpio.length));
  }
  function nombreProducto(r) {
    var n = r.producto || (r.movimientos && r.movimientos.length ? r.movimientos[0].producto : '') || '';
    var p = L.producto({nombre: n});
    return n ? p.titulo + (p.color ? ' · ' + p.color : '') : '';
  }
  // Dónde está hoy una serie: en un almacén, vendida, en dos lugares (alerta) o en ningún lado
  function dondeEsta(r) {
    var hoy = (r.hoy || []).filter(function (x) { return Number(x.cantidad) !== 0; });
    var movs = r.movimientos || [], ult = movs[movs.length - 1];
    if (hoy.length > 1) return {tono: 'alerta', ico: 'copia', titulo: 'Aparece en dos lugares', lugar: hoy.map(function (x) { return nomAlm(x.almacen); }).join(' y '), corto: 'En dos lugares'};
    if (hoy.length === 1) {
      var raro = Number(hoy[0].cantidad) !== 1;
      return {tono: raro ? 'alerta' : 'entra', ico: 'lugar', titulo: raro ? 'Hoy está en (cantidad ' + num(hoy[0].cantidad) + ')' : 'Hoy está en',
              lugar: nomAlm(hoy[0].almacen), corto: nomAlm(hoy[0].almacen),
              desde: (movs.filter(function (m) { return m.a_almacen === hoy[0].almacen && m.de_almacen !== hoy[0].almacen && m.de_uso !== 'production'; }).pop() || {}).fecha || hoy[0].desde};
    }
    if (ult && ult.a_uso === 'customer') return {tono: 'venta', ico: 'venta', titulo: 'Se vendió', lugar: ult.cliente || 'Cliente', corto: 'Vendida', desde: ult.fecha};
    return {tono: 'neutro', ico: 'lugar', titulo: 'Hoy no está en ningún almacén', lugar: '', corto: 'Sin lugar'};
  }

  // ---------------------------------------------------------------- Ficha de una serie: su recorrido
  // Se abre encima (a la derecha en computadora, pantalla completa en celular). El "atrás" la cierra.
  function abrirSerie(lote, prod, datos) {
    if (!lote) return;
    try { history.pushState(Object.assign({}, history.state, {op: st.op, odAlm: st.op === 'od-existencias' ? st.alm : null, odFam: st.op === 'od-existencias' ? st.fam : null, odSerie: lote}), ''); } catch (x) {}
    panelProd = prod || null;
    panel(lote, datos);
  }
  function panelEl() {
    var p = $('od-panel');
    if (!p) {
      p = document.createElement('div'); p.id = 'od-panel'; p.className = 'od-capa'; p.hidden = true;
      p.innerHTML = '<div class="od-capa-fondo" data-cerrar></div><aside class="od-panel" role="dialog" aria-modal="true" aria-labelledby="od-p-tit">' +
        '<div class="od-panel-cab"><button type="button" class="volver" data-cerrar>‹ Volver</button>' +
        '<button type="button" class="od-info-btn" id="od-info-btn" aria-label="Información" aria-expanded="false" hidden>' + ico('info') + '</button></div><div class="od-panel-cuerpo" id="od-p-cuerpo"></div></aside>';
      $('mod-odoo').appendChild(p);
      p.addEventListener('click', function (e) {
        if (e.target.closest('[data-cerrar]')) { history.back(); return; }
        if (e.target.closest('#od-info-btn')) verInfo(!p.classList.contains('con-info'));
      });
    }
    return p;
  }
  function panel(lote, datos) {
    if (lote === panelLote) return;
    var p = panelEl(), cuerpo = $('od-p-cuerpo');
    panelLote = lote;
    if (!lote) {
      p.classList.remove('abierta');
      setTimeout(function () { if (!panelLote) { p.hidden = true; cuerpo.innerHTML = ''; } }, 320);
      return;
    }
    p.hidden = false; verInfo(false); $('od-info-btn').hidden = true;
    cuerpo.innerHTML = cabSerie(lote, datos) + (datos ? recorrido(datos) : '<p class="vacio">Cargando…</p>');
    cuerpo.scrollTop = 0;
    requestAnimationFrame(function () { requestAnimationFrame(function () { p.classList.add('abierta'); p.querySelector('.volver').focus({preventScroll: true}); }); });
    if (datos) return;
    var listo = resumen ? Promise.resolve() : cargarResumen();
    listo.then(function () { return UI.llamar('bma_odoo_serie', {p_q: L.serie(lote).serie}); }).then(function (rs) {
      if (panelLote !== lote) return;
      var r = rs.filter(function (x) { return x.lote === lote; })[0] || rs[0];
      cuerpo.innerHTML = r ? cabSerie(lote, r) + recorrido(r) : cabSerie(lote) + '<p class="vacio">No se encontró esta serie.</p>';
      $('od-info-btn').hidden = !r;
    }).catch(function () {});
  }
  function cabSerie(lote, r) {
    var s = L.serie(lote);
    var nombre = panelProd ? panelProd.titulo + (panelProd.color ? ' · ' + panelProd.color : '') : (r ? nombreProducto(r) : '');
    var crudo = r ? r.producto || (r.movimientos && r.movimientos.length ? r.movimientos[0].producto : '') || '' : '';
    return '<div class="od-s-cab">' + imagen(L.figura(panelProd ? panelProd.familia : '', crudo || nombre), panelProd ? panelProd.variante : crudo, 'od-foto-ficha', 'od-icc-xl') +
      '<h2 id="od-p-tit" class="num">' + esc(L.serieCorta(s.serie)) + '</h2>' +
      (nombre ? '<p class="od-s-prod">' + esc(nombre) + '</p>' : '') + '</div>' + (r ? info(lote, r) : '');
  }
  // Información (como "Obtener información" de un archivo): serie completa, pedimento, modelo, nombre en Odoo y llegada.
  // Está escondida; la abre el botón (i) de arriba a la derecha.
  function info(lote, r) {
    var s = L.serie(lote), n = r.producto || (r.movimientos && r.movimientos.length ? r.movimientos[0].producto : '') || '';
    var codigo = (n.match(/^\[([^\]]+)\]/) || [])[1] || (panelProd && panelProd.codigo) || '';
    var llego = (r.movimientos || []).filter(function (m) { return m.de_uso === 'supplier'; })[0];
    var filas = [['Número de serie', s.serie, true], ['Pedimento', s.pedimento, true], ['Modelo', codigo, true],
      ['En Odoo', L.capital(n.replace(/^\[[^\]]*\]\s*/, ''))], ['Llegó', llego ? L.fechaHora(llego.fecha).split(', ')[0] + ' a ' + lugarDe(llego, 'a') : '']];
    return '<div class="od-info" id="od-info"><div><dl>' + filas.filter(function (f) { return f[1]; }).map(function (f) {
      return '<div><dt>' + esc(f[0]) + '</dt><dd' + (f[2] ? ' class="num"' : '') + '>' + esc(f[1]) + '</dd></div>';
    }).join('') + '</dl></div></div>';
  }
  function verInfo(si) {
    var p = $('od-panel'), b = $('od-info-btn'); if (!p) return;
    p.classList.toggle('con-info', si); b.setAttribute('aria-expanded', si);
  }
  function recorrido(r) {
    var ahora = dondeEsta(r), movs = r.movimientos || [];
    var h = '<div class="od-ahora tono-' + ahora.tono + '">' + icoC(ahora.ico, ahora.tono, 'od-icc-lg') +
      '<div><small>' + esc(ahora.titulo) + '</small>' + (ahora.lugar ? '<b>' + esc(ahora.lugar) + '</b>' : '') +
      (ahora.desde ? '<span>' + (ahora.tono === 'venta' ? 'el ' : 'desde el ') + esc(L.fechaHora(ahora.desde).split(', ')[0]) +
        (ahora.tono === 'entra' ? diasAqui(ahora.desde) : '') + '</span>' : '') + '</div></div>';
    if (!movs.length) return h + '<p class="vacio">Sin movimientos en Odoo.</p>';
    h += '<ol class="od-ruta" aria-label="Su recorrido">' + movs.map(function (m, i) {
      var t = L.tipoMov(m), ultimo = i === movs.length - 1;
      var mas = [m.venta, m.referencia, m.creo ? 'Lo hizo ' + m.creo : ''].filter(Boolean).map(esc).join(' · ');
      return '<li class="od-paso tono-' + t.tono + (ultimo ? ' ultimo' : '') + '">' + icoC(t.clave, t.tono) +
        '<div class="od-paso-txt"><div class="od-paso-l1"><b>' + esc(conNombres(t.texto)) + '</b>' +
        '</div>' +
        '<div class="od-paso-ruta"><span>' + esc(lugarDe(m, 'de')) + '</span>' + ico('flecha') + '<span>' + esc(lugarDe(m, 'a')) + '</span></div>' +
        '<div class="od-paso-fecha">' + esc(L.fechaHora(m.fecha)) + '</div>' +
        (mas ? '<div class="od-paso-mas">' + mas + '</div>' : '') +
        (m.cambios ? '<div class="od-paso-aviso">' + ico('editar') + 'Se cambió después de registrarse</div>' : '') +
        '</div></li>';
    }).join('') + '</ol>';
    return h;
  }
  // " · 33 días" con su punto de semáforo
  function diasAqui(desde) {
    var d = L.dias(desde);
    return ' · <i class="od-sem sem-' + L.semaforo(d) + '"></i>' + d + (d === 1 ? ' día' : ' días');
  }
  // Nombre corto del lugar de salida o de llegada de un movimiento
  function lugarDe(m, lado) {
    var alm = m[lado + '_almacen'], uso = m[lado + '_uso'];
    if (alm) return nomAlm(alm);
    if (uso === 'supplier') return 'Proveedor';
    if (uso === 'customer') return m.cliente || 'Cliente';
    if (uso === 'inventory') return 'Ajuste de inventario';
    if (uso === 'transit') return 'En camino';
    return m[lado + '_ubicacion'] || '?';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panelLote && !document.documentElement.classList.contains('hoja-on')) history.back();
  });

  // ---------------------------------------------------------------- Existencias
  function existencias() {
    if (!resumen || !cont().innerHTML) cont().innerHTML = '<p class="vacio">Cargando…</p>';
    cargarResumen().then(function () {
      if (st.alm) return almacen();
      var h = barra({buscar: true, dia: true}) + '<div id="od-res" hidden></div><div id="od-cuerpo">';
      if (!resumen.almacenes.length) h += '<p class="vacio">Todavía no hay copia de Odoo. Dale Actualizar.</p>';
      h += antesDeLaCopia();
      h += '<div class="od-casillas">' + resumen.almacenes.map(casilla).join('') + '</div></div>';
      cont().innerHTML = h; enganchar();
      cont().querySelector('.od-casillas').onclick = function (e) {
        var b = e.target.closest('[data-alm]'); if (!b) return;
        st.alm = b.dataset.alm; st.fam = null; st.clase = 'vehiculos'; st.abiertos = {};
        try { history.pushState({op: st.op, odAlm: st.alm}, ''); } catch (x) {}
        pintar(); window.scrollTo(0, 0);
      };
    }).catch(function () {});
  }
  // Antes de la primera copia no hay foto guardada de ese día
  function antesDeLaCopia() {
    var p = resumen && resumen.primera_copia;
    if (!st.dia || !p || bma_fin(st.dia) > Date.parse(p)) return '';
    return '<p class="aviso-duda">La copia de Odoo empezó el ' + esc(BMA.fecha(p)) + '. De días anteriores no hay foto guardada.</p>';
  }
  function bma_fin(dia) { return Date.parse(dia + 'T23:59:59-06:00'); }
  function casilla(a) {
    var lineas = [];
    if (+a.vehiculos) lineas.push('<span>' + ico('moto') + '<b class="num">' + num(a.vehiculos) + '</b> ' + (+a.vehiculos === 1 ? 'vehículo' : 'vehículos') + '</span>');
    if (+a.pasto) lineas.push('<span>' + ico('pasto') + '<b class="num">' + num(a.pasto) + '</b> m² de pasto</span>');
    if (+a.otros) lineas.push('<span>' + ico('caja') + '<b class="num">' + num(a.otros) + '</b> ' + (+a.otros === 1 ? 'otro' : 'otros') + '</span>');
    if (!lineas.length) lineas.push('<span class="od-gris">Sin existencias</span>');
    var viejo = a.ultimo_mov && (Date.now() - Date.parse(a.ultimo_mov)) > 7 * 864e5;
    return '<button type="button" class="od-casilla" data-alm="' + esc(a.codigo) + '">' +
      '<span class="od-nom">' + esc(L.nombreAlmacen(a.nombre)) + (+a.pendientes ? '<span class="od-punto num" title="Por revisar">' + a.pendientes + '</span>' : '') + '</span>' +
      '<span class="od-cifras">' + lineas.join('') + '</span>' +
      (viejo || !a.ultimo_mov ? '<span class="od-pie od-alerta">' + ico('reloj') +
        (a.ultimo_mov ? 'Sin moverse ' + esc(L.hace(a.ultimo_mov).replace('hace ', '')) : 'Nunca ha tenido movimientos') + '</span>' : '') + '</button>';
  }

  // Una sucursal: casillas por familia (ATV, Cross…). Al picar una familia se entra a ella (con "atrás").
  function almacen() {
    var a = resumen.almacenes.filter(function (x) { return x.codigo === st.alm; })[0];
    if (!a) { st.alm = null; return existencias(); }
    var clave = st.alm + '|' + (st.dia || '') + '|' + (resumen.ultima_copia ? resumen.ultima_copia.fin : '');
    var listo = copiaEs.clave === clave ? Promise.resolve(copiaEs.es)
      : UI.llamar('bma_odoo_existencias', {p_almacen: st.alm, p_dia: st.dia}).then(function (es) { copiaEs = {clave: clave, es: es}; return es; });
    listo.then(function (es) {
      var por = {vehiculos: [], pasto: [], otros: []};
      es.forEach(function (e) { por[L.clase(e)].push(e); });
      if (st.fam) return familia(a, por);
      var suma = function (l) { return l.reduce(function (s, e) { return s + Number(e.cantidad); }, 0); };
      if (!por[st.clase].length) st.clase = ['vehiculos', 'pasto', 'otros'].filter(function (k) { return por[k].length; })[0] || 'vehiculos';
      var h = '<div class="ficha-top"><button type="button" class="volver" id="od-volver">‹ Todas</button></div>' +
        '<div class="od-tit"><h2>' + esc(L.nombreAlmacen(a.nombre)) + '</h2>' + barra({dia: true}) + '</div>' +
        UI.seg('od-clase', [
          {valor: 'vehiculos', nombre: 'Vehículos', cuenta: num(suma(por.vehiculos))},
          {valor: 'pasto', nombre: 'Pasto', cuenta: num(suma(por.pasto)) + ' m²'},
          {valor: 'otros', nombre: 'Otros', cuenta: num(suma(por.otros))}].filter(function (o) {
            return o.valor === 'vehiculos' || o.valor === st.clase || por[o.valor].length; }).map(function (o) {
            o.ico = ico(ICO_CLASE[o.valor]); return o; }), st.clase) + antesDeLaCopia();
      h += '<div id="od-lista">' + (st.clase === 'pasto' ? listaPasto(por.pasto) : casillasFamilia(por[st.clase])) + '</div>';
      cont().innerHTML = h; enganchar();
      $('od-volver').onclick = function () { history.back(); };
      $('od-clase').onclick = function (e) {
        var b = e.target.closest('[data-valor]'); if (b && b.dataset.valor !== st.clase) { st.clase = b.dataset.valor; almacen(); }
      };
      $('od-lista').onclick = function (e) {
        var g = e.target.closest('[data-fam]'); if (!g) return;
        st.fam = g.dataset.fam; st.abiertos = {};
        try { history.pushState({op: st.op, odAlm: st.alm, odFam: st.fam}, ''); } catch (x) {}
        pintar(); window.scrollTo(0, 0);
      };
    }).catch(function () {});
  }

  // Agrupa piezas: familia -> cilindrada (variante) -> modelo (color)
  function agrupar(es) {
    var fams = {}, orden = [];
    es.forEach(function (e) {
      var p = L.producto(e), n = Number(e.cantidad), f = p.familia;
      if (!fams[f]) { fams[f] = {nombre: f, n: 0, fig: L.figura(f, e.nombre), vars: {}, ordenV: []}; orden.push(f); }
      var F = fams[f], v = p.variante; F.n += n;
      if (!F.vars[v]) { F.vars[v] = {nombre: v, n: 0, prods: {}, lista: []}; F.ordenV.push(v); }
      var V = F.vars[v]; V.n += n;
      if (!V.prods[e.producto_id]) { V.prods[e.producto_id] = {id: e.producto_id, p: p, filas: [], n: 0}; V.lista.push(V.prods[e.producto_id]); }
      V.prods[e.producto_id].filas.push(e); V.prods[e.producto_id].n += n;
    });
    var cc = function (v) { return parseFloat(v) || 9999; };
    orden.sort(function (a, b) { return fams[b].n - fams[a].n || a.localeCompare(b); });
    orden.forEach(function (f) {
      var F = fams[f];
      F.ordenV.sort(function (a, b) { return cc(a) - cc(b) || a.localeCompare(b); });
      F.ordenV.forEach(function (v) { F.vars[v].lista.sort(function (a, b) { return b.n - a.n || (a.p.color || a.p.titulo).localeCompare(b.p.color || b.p.titulo); }); });
    });
    return {fams: fams, orden: orden};
  }

  function casillasFamilia(es) {
    if (!es.length) return '<p class="vacio">No hay nada aquí ' + (st.dia ? 'ese día' : 'hoy') + '.</p>';
    var g = agrupar(es);
    return '<div class="od-fams">' + g.orden.map(function (f) {
      var F = g.fams[f];
      return '<button type="button" class="od-ftile" data-fam="' + esc(f) + '"><span class="od-ftile-img">' + imagen(F.fig, '', 'od-foto-tile', 'od-icc-lg') + '</span>' +
        '<span class="od-ftile-n num' + (F.n < 0 ? ' od-alerta' : '') + '">' + num(F.n) + '</span><span class="od-ftile-nom">' + esc(f) + '</span></button>';
    }).join('') + '</div>';
  }

  // Dentro de una familia: casillas por cilindrada (si hay más de una) y abajo los colores de la elegida;
  // al picar un color, sus series en casillas con los últimos 5 y el semáforo de días.
  function familia(a, por) {
    var piezas = st.clase === 'otros' ? por.otros : por.vehiculos, g = agrupar(piezas), F = g.fams[st.fam];
    if (!F) { st.fam = null; return almacen(); }
    var v = F.vars[st.vari[F.nombre]] ? st.vari[F.nombre] : F.ordenV[0];
    var h = '<div class="ficha-top"><button type="button" class="volver" id="od-volver">‹ ' + esc(L.nombreAlmacen(a.nombre)) + '</button></div>' +
      '<div class="od-fcab">' + imagen(F.fig, v, 'od-foto-cab', 'od-icc-xl') + '<h2>' + esc(F.nombre) + '</h2><span class="num">' + num(F.n) + '</span></div>';
    if (F.ordenV.length > 1) h += '<div class="od-vars" id="od-vars">' + F.ordenV.map(function (k) {
      var on = k === v;
      return '<button type="button" class="od-vtile' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-var="' + esc(k) + '"><b>' + esc(k || 'Otros') + '</b>' +
        '<span class="num">' + num(F.vars[k].n) + '</span></button>';
    }).join('') + '</div>';
    h += '<div id="od-lista">' + colores(F.vars[v]) + '</div>';
    cont().innerHTML = h;
    $('od-volver').onclick = function () { history.back(); };
    if ($('od-vars')) $('od-vars').onclick = function (e) {
      var b = e.target.closest('[data-var]'); if (!b) return;
      st.vari[F.nombre] = b.dataset.var; st.abiertos = {}; familia(a, por);
    };
    $('od-lista').onclick = function (e) {
      var s = e.target.closest('[data-serie]');
      if (s) { var x = piezas.filter(function (y) { return y.lote === s.dataset.serie; })[0]; abrirSerie(s.dataset.serie, x ? L.producto(x) : null); return; }
      var m = e.target.closest('[data-prod]'); if (!m) return;
      st.abiertos[m.dataset.prod] = !st.abiertos[m.dataset.prod]; familia(a, por);
    };
  }
  function muestra(color) {
    var c = L.muestraColor(color);
    var fondo = !c.length ? '' : c.length === 1 ? c[0] : 'linear-gradient(135deg,' + c[0] + ' 50%,' + c[1] + ' 50%)';
    return '<span class="od-muestra' + (c.length ? '' : ' sin') + '"' + (fondo ? ' style="background:' + fondo + '"' : '') + '></span>';
  }
  // Desde cuándo está en esta sucursal (llegó de otro lugar); el "llego" de Odoo se reinicia con movimientos internos
  function llegada(e) { return e.aqui_desde || e.llego || e.desde; }
  function colores(V) {
    var ref = st.dia ? st.dia + 'T23:00:00-06:00' : null;
    // Si dos modelos tienen el mismo color (p. ej. súper patín Mimi y Tom, ambos rojos), se agrega el modelo
    // y si aun así se repite (el nombre de Odoo no los distingue), la clave del modelo
    var cuenta = function (f) { var v = {}; V.lista.forEach(function (x) { var k = f(x); v[k] = (v[k] || 0) + 1; }); return v; };
    var base = function (x) { return x.p.color || x.p.titulo; };
    var conModelo = function (x) { return base(x) + ' · ' + (L.modelo(x.filas[0].nombre) || x.p.codigo); };
    var veces = cuenta(base), veces2 = cuenta(conModelo);
    return '<div class="renglones od-colores">' + V.lista.map(function (x) {
      var ab = st.abiertos[x.id], conSerie = x.filas.some(function (e) { return e.lote; });
      var nom = base(x);
      if (veces[nom] > 1) nom = veces2[conModelo(x)] > 1 ? nom + ' · ' + x.p.codigo : conModelo(x);
      // En "Otros" (toldos, plataformas…) el color solo no dice qué es: va el nombre corto de Odoo y el color
      if (st.clase === 'otros') nom = L.nombreCorto(x.filas[0].nombre) + (x.p.color ? ' · ' + x.p.color : '');
      return '<button type="button" class="od-color' + (ab ? ' abierto' : '') + '" data-prod="' + x.id + '"' + (conSerie ? ' aria-expanded="' + !!ab + '"' : '') + '>' +
        muestra(x.p.color) + '<span class="od-color-nom">' + esc(nom) + '</span>' +
        '<span class="num' + (x.n < 0 ? ' od-alerta' : '') + '">' + num(x.n) + '</span>' + (conSerie ? ico('flecha') : '<span></span>') + '</button>' +
        (ab && conSerie ? '<div class="od-chips">' + x.filas.slice().sort(function (p, q) { return Date.parse(llegada(p)) - Date.parse(llegada(q)); }).map(function (e) {
          var raro = Number(e.cantidad) !== 1, d = L.dias(llegada(e), ref);
          return '<button type="button" class="od-chip num sem-' + L.semaforo(d) + (raro ? ' raro' : '') + '" data-serie="' + esc(e.lote) + '" title="' +
            d + (d === 1 ? ' día' : ' días') + ' aquí' + (raro ? ' · cantidad ' + num(e.cantidad) : '') + '">' + esc(L.serieCorta(L.serie(e.lote).serie)) + '</button>';
        }).join('') + '</div>' : '');
    }).join('') + '</div>';
  }

  function listaPasto(es) {
    if (!es.length) return '<p class="vacio">No hay pasto aquí ' + (st.dia ? 'ese día' : 'hoy') + '.</p>';
    var por = {}, orden = [];
    es.forEach(function (e) { if (!por[e.producto_id]) { por[e.producto_id] = []; orden.push(e.producto_id); } por[e.producto_id].push(e); });
    return '<div class="renglones">' + orden.map(function (id) {
      var fs = por[id], e = fs[0], p = L.producto(e), ancho = L.anchoPasto(e);
      var m2 = fs.reduce(function (s, x) { return s + Number(x.cantidad); }, 0), r = L.rollos(m2, ancho);
      return '<div class="renglon od-fija"><span class="prin">' + esc(p.titulo) + '</span><span class="prin der num">' + num(m2) + ' m²</span>' +
        '<span class="sec">' + (r !== null ? '≈ ' + num(r) + (r === 1 ? ' rollo' : ' rollos') + ' de ' + ancho + ' × 25 m · ' : '') +
        esc(fs.map(function (x) { return x.lote; }).filter(Boolean).join(', ') || p.codigo) + '</span><span></span></div>';
    }).join('') + '</div>';
  }

  // ---------------------------------------------------------------- Movimientos
  function movimientos() {
    var pinta = function () {
      cont().innerHTML = barra({buscar: true, extra: UI.filtro('od-malm', 'Sucursal', st.movAlm ? nomAlm(st.movAlm) : 'Todas')}) +
        '<div id="od-res" hidden></div><div id="od-cuerpo"><div id="od-movs"><p class="vacio">Cargando…</p></div></div>';
      enganchar();
      $('od-malm').onclick = function () {
        UI.abrirLista({titulo: 'Sucursal', elegido: st.movAlm || '', grupos: [{opciones: [{valor: '', nombre: 'Todas'}].concat(resumen.almacenes.map(function (a) {
          return {valor: a.codigo, nombre: L.nombreAlmacen(a.nombre)};
        }))}]}).then(function (v) { if (v === null) return; st.movAlm = v || null; movimientos(); });
      };
      UI.llamar('bma_odoo_movimientos', {p_almacen: st.movAlm, p_limite: 300}).then(function (ms) {
        var el = $('od-movs'); if (!el) return;
        if (!ms.length) { el.innerHTML = '<p class="vacio">Sin movimientos.</p>'; return; }
        var h = '', semana = null;
        ms.forEach(function (m, i) {
          var l = L.lunes(m.fecha);
          if (l !== semana) { h += (semana ? '</div>' : '') + '<div class="od-grupo-tit"><span>' + esc(L.semana(l)) + '</span></div><div class="renglones">'; semana = l; }
          h += filaMov(m, st.movAlm, i);
        });
        h += '</div>' + (ms.length >= 300 ? '<p class="mas-res">Se ven los últimos 300. Para uno en particular, busca su serie.</p>' : '');
        el.innerHTML = h;
        el.onclick = function (e) {
          var s = e.target.closest('[data-i]'); if (!s) return;
          var m = ms[+s.dataset.i]; abrirSerie(m.lote, L.producto(m));
        };
      }).catch(function () {});
    };
    if (resumen) pinta(); else cargarResumen().then(pinta).catch(function () {});
  }
  function filaMov(m, alm, i) {
    var t = L.tipoMov(m, alm), p = L.producto(m), s = L.serie(m.lote);
    var ruta = alm && t.clave === 'traspaso' ? '' : lugarDe(m, 'de') + ' → ' + lugarDe(m, 'a');
    var sec = [m.lote ? L.serieCorta(s.serie) : (m.unidad ? L.cantidad(m.cantidad, m.unidad) : ''), ruta].filter(Boolean).map(esc).join(' · ');
    var hora = L.fechaHora(m.fecha).split(', ');
    var etiqueta = m.lote ? 'button type="button" data-i="' + i + '"' : 'div';
    return '<' + etiqueta + ' class="renglon od-mov' + (m.lote ? '' : ' od-fija') + '">' + icoC(t.clave, t.tono) +
      '<span class="od-mov-txt"><b><span class="' + (t.alerta ? 'od-alerta' : '') + '">' + esc(conNombres(t.texto)) + '</span> · ' + esc(p.titulo) + (p.color ? ' ' + esc(p.color) : '') + '</b>' +
      '<small>' + sec + (m.cambios ? ' · <span class="od-alerta">se cambió después</span>' : '') + '</small></span>' +
      '<span class="od-mov-fecha"><b>' + esc(hora[0]) + '</b><small>' + esc(hora[1] || '') + '</small></span></' + (m.lote ? 'button' : 'div') + '>';
  }

  // ---------------------------------------------------------------- Revisar
  function revisar() {
    cont().innerHTML = UI.seg('od-vista', [{valor: 'pendiente', nombre: 'Por revisar'}, {valor: 'revisado', nombre: 'Revisados'}], st.vista) +
      '<div id="od-alertas"><p class="vacio">Cargando…</p></div>';
    $('od-vista').onclick = function (e) {
      var b = e.target.closest('[data-valor]'); if (b && b.dataset.valor !== st.vista) { st.vista = b.dataset.valor; revisar(); }
    };
    var pinta = function () {
      UI.llamar('bma_odoo_revisar', {p_estado: st.vista}).then(function (as) {
        var el = $('od-alertas'); if (!el) return;
        if (st.vista === 'pendiente') marcarCuenta(as.length);
        if (!as.length) {
          el.innerHTML = '<div class="od-nada">' + icoC('check', 'entra', 'od-icc-lg') + '<b>' + (st.vista === 'pendiente' ? 'Nada por revisar' : 'Todavía no revisas ninguna') + '</b></div>';
          return;
        }
        var grupos = {}, orden = Object.keys(L.ALERTAS);
        as.forEach(function (a) { (grupos[a.tipo] = grupos[a.tipo] || []).push(a); });
        el.innerHTML = orden.filter(function (t) { return grupos[t]; }).map(function (t) {
          var abierto = st.grupos[t] || Object.keys(grupos).length === 1;
          return '<button class="d-grupo od-agrupo' + (abierto ? ' abierto' : '') + '" data-grupo="' + t + '" aria-expanded="' + abierto + '">' +
            icoC(ICO_ALERTA[t], st.vista === 'pendiente' ? 'alerta' : 'neutro') +
            '<span class="d-mot">' + esc(L.ALERTAS[t]) + '</span><span class="d-n">' + grupos[t].length + '</span>' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>' +
            (abierto ? '<div class="renglones">' + grupos[t].map(function (a) { return filaAlerta(a, as.indexOf(a)); }).join('') + '</div>' : '');
        }).join('');
        el.onclick = function (e) {
          var g = e.target.closest('[data-grupo]');
          if (g) { st.grupos[g.dataset.grupo] = !st.grupos[g.dataset.grupo]; pinta(); return; }
          var b = e.target.closest('[data-accion]'); if (!b) return;
          var a = as[+b.dataset.i];
          if (b.dataset.accion === 'serie') abrirSerie(a.lote);
          else if (b.dataset.accion === 'revisado') marcar(a, pinta);
        };
      }).catch(function () {});
    };
    if (!resumen) cargarResumen().then(pinta).catch(function () {}); else pinta();
  }
  // "[DR300-PK/CON-BL] MOTOCARRO NUEVO … (BLANCO)" -> "DR300-PK/CON-BL (Blanco)"
  function corto(t) {
    return String(t || '').replace(/\[([^\]]+)\][^·]*?\(([^()]*)\)(?=\s*·|\s*$)/g, function (m, c, col) { return c + ' (' + L.capital(col) + ')'; })
      .replace(/\[([^\]]+)\][^·]*/g, '$1 ');
  }
  function filaAlerta(a, i) {
    var s = a.lote ? L.serieCorta(L.serie(a.lote).serie) : '';
    var acciones = (s ? '<button type="button" class="btn-chico" data-accion="serie" data-i="' + i + '">' + ico('moto') + 'Ver su recorrido</button>' : '') +
      (st.vista === 'pendiente' ? '<button type="button" class="btn-chico" data-accion="revisado" data-i="' + i + '">' + ico('check') + 'Ya lo revisé</button>' : '');
    // Si el título repite el nombre del grupo, arriba va la sucursal (no se repite lo que ya dice el grupo)
    var repite = a.titulo === L.ALERTAS[a.tipo], alm = a.almacen ? nomAlm(a.almacen) : '';
    var resto = [repite ? '' : alm, a.detalle ? corto(a.detalle) : ''].filter(Boolean).map(esc);
    if (s) resto.push('<span class="num">' + esc(s) + '</span>');
    return '<div class="mov od-alerta-fila"><span class="t">' + esc(repite ? alm || a.titulo : a.titulo) + '</span><span class="d">' + esc(L.fechaHora(a.fecha)) + '</span>' +
      '<span class="d">' + resto.join(' · ') +
      (a.revisado ? '<br>Revisado por ' + esc(a.quien) + ', ' + esc(L.fechaHora(a.revisado)) + (a.nota ? ': ' + esc(a.nota) : '') : '') + '</span><span></span>' +
      (acciones ? '<span class="acc">' + acciones + '</span>' : '') + '</div>';
  }
  function marcar(a, despues) {
    UI.pedirTexto({titulo: 'Ya lo revisé', ayuda: 'Nota opcional: qué encontraste', tipo: 'largo', opcional: true, boton: 'Marcar'})
      .then(function (nota) {
        if (nota === null || nota === undefined) return null;
        return UI.guardar('bma_odoo_revisado', {p_clave: a.clave, p_nota: nota || null});
      }).then(function (r) { if (r === true) { UI.aviso('Marcado como revisado'); despues(); } })
      .catch(function () {});
  }

  window.Odoo = {abrir: abrir, pintar: pintar, contar: contar};
})();
