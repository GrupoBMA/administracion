// Inventario Odoo (window.Odoo), solo admin. Lee la copia de Odoo que guarda la función de Supabase "bma-odoo"
// (cada noche y con "Actualizar"). Pantallas: Existencias (por sucursal, hoy o cualquier día), Movimientos,
// Buscar serie y Revisar (alertas para marcar como revisadas). Nada aquí escribe en Odoo.
(function () {
  var esc = BMA.esc, L = OdooL, $ = function (id) { return document.getElementById(id); };
  var st = {op: 'od-existencias', dia: null, alm: null, clase: 'vehiculos', abiertos: {}, movAlm: null, q: '', vista: 'pendiente', grupos: {}};
  var resumen = null, actualizando = false, tBuscar = null;

  function cont() { return $('mod-odoo'); }
  function nomAlm(codigo) {
    var a = resumen && resumen.almacenes.filter(function (x) { return x.codigo === codigo; })[0];
    return a ? L.nombreAlmacen(a.nombre) : (codigo || '');
  }
  function num(n) { return (Math.round(Number(n) * 100) / 100).toLocaleString('en-US', {maximumFractionDigits: 2}); }
  function cargarResumen() {
    return UI.llamar('bma_odoo_resumen', {p_dia: st.dia}).then(function (r) { resumen = r; marcarCuenta(r.pendientes); return r; });
  }
  function marcarCuenta(n) {
    document.querySelectorAll('.cuenta-odoo').forEach(function (c) { c.hidden = !n; c.textContent = n; });
  }
  function contar() { UI.llamar('bma_odoo_resumen', {p_dia: null}).then(function (r) { marcarCuenta(r.pendientes); }).catch(function () {}); }

  // estado: lo que guardó el historial del navegador (el "atrás" desde una sucursal regresa a las casillas)
  function abrir(op, seguir, estado) {
    st.op = op;
    if (!seguir) { st.alm = null; st.abiertos = {}; if (op === 'od-serie') st.q = ''; }
    else if (estado && op === 'od-existencias') st.alm = estado.odAlm || null;
    pintar();
  }

  function pintar() {
    if (st.op === 'od-movimientos') return movimientos();
    if (st.op === 'od-serie') return buscarSerie();
    if (st.op === 'od-revisar') return revisar();
    return existencias();
  }

  // ---------------------------------------------------------------- Barra de arriba: día y Actualizar
  function barra(conDia) {
    var copia = resumen && resumen.ultima_copia;
    return '<div class="barra">' + (conDia ? UI.filtro('od-dia', 'Ver', st.dia ? BMA.fecha(st.dia) : 'Hoy') : '') +
      '<span class="relleno"></span>' +
      (copia ? '<span class="od-copia">Copia de Odoo ' + esc(L.hace(copia.fin)) + ', ' + esc(L.fechaHora(copia.fin).split(', ')[1] || '') + '</span>' : '') +
      '<button type="button" class="btn" id="od-act"' + (actualizando ? ' disabled' : '') + '>' + (actualizando ? 'Actualizando…' : 'Actualizar') + '</button></div>';
  }
  function enganchar() {
    var d = $('od-dia');
    if (d) d.onclick = function () {
      UI.pedirTexto({titulo: '¿Qué día quieres ver?', ayuda: 'Vacío = hoy', tipo: 'date', valor: st.dia || '', max: BMA.hoy(), opcional: true, boton: 'Ver'})
        .then(function (v) { if (v === null) return; st.dia = v || null; pintar(); });
    };
    var a = $('od-act');
    if (a) a.onclick = actualizar;
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

  // ---------------------------------------------------------------- Existencias
  function existencias() {
    cont().innerHTML = '<p class="vacio">Cargando…</p>';
    cargarResumen().then(function () {
      if (st.alm) return almacen();
      var h = barra(true);
      if (!resumen.almacenes.length) h += '<p class="vacio">Todavía no hay copia de Odoo. Dale Actualizar.</p>';
      h += antesDeLaCopia();
      h += '<div class="od-casillas">' + resumen.almacenes.map(casilla).join('') + '</div>';
      cont().innerHTML = h; enganchar();
      cont().querySelector('.od-casillas').onclick = function (e) {
        var b = e.target.closest('[data-alm]'); if (!b) return;
        st.alm = b.dataset.alm; st.clase = 'vehiculos'; st.abiertos = {};
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
    if (+a.vehiculos) lineas.push('<span><b class="num">' + num(a.vehiculos) + '</b> ' + (+a.vehiculos === 1 ? 'vehículo' : 'vehículos') + '</span>');
    if (+a.pasto) lineas.push('<span><b class="num">' + num(a.pasto) + '</b> m² de pasto</span>');
    if (+a.otros) lineas.push('<span><b class="num">' + num(a.otros) + '</b> ' + (+a.otros === 1 ? 'otro' : 'otros') + '</span>');
    if (!lineas.length) lineas.push('<span class="od-gris">Sin existencias</span>');
    var viejo = a.ultimo_mov && (Date.now() - Date.parse(a.ultimo_mov)) > 7 * 864e5;
    return '<button type="button" class="od-casilla" data-alm="' + esc(a.codigo) + '">' +
      '<span class="od-nom">' + esc(L.nombreAlmacen(a.nombre)) + (+a.pendientes ? '<span class="od-punto num" title="Por revisar">' + a.pendientes + '</span>' : '') + '</span>' +
      '<span class="od-cifras">' + lineas.join('') + '</span>' +
      '<span class="od-pie' + (viejo || !a.ultimo_mov ? ' od-alerta' : '') + '">' +
      (a.ultimo_mov ? 'Último movimiento ' + esc(L.hace(a.ultimo_mov)) : 'Nunca ha tenido movimientos') + '</span></button>';
  }

  function almacen() {
    var a = resumen.almacenes.filter(function (x) { return x.codigo === st.alm; })[0];
    if (!a) { st.alm = null; return existencias(); }
    UI.llamar('bma_odoo_existencias', {p_almacen: st.alm, p_dia: st.dia}).then(function (es) {
      var por = {vehiculos: [], pasto: [], otros: []};
      es.forEach(function (e) { por[L.clase(e)].push(e); });
      var suma = function (l) { return l.reduce(function (s, e) { return s + Number(e.cantidad); }, 0); };
      if (!por[st.clase].length) st.clase = ['vehiculos', 'pasto', 'otros'].filter(function (k) { return por[k].length; })[0] || 'vehiculos';
      var h = '<div class="ficha-top"><button type="button" class="volver" id="od-volver">‹ Todas</button></div>' +
        '<div class="od-tit"><h2>' + esc(L.nombreAlmacen(a.nombre)) + '</h2>' + barra(true) + '</div>' +
        UI.seg('od-clase', [
          {valor: 'vehiculos', nombre: 'Vehículos', cuenta: num(suma(por.vehiculos))},
          {valor: 'pasto', nombre: 'Pasto', cuenta: num(suma(por.pasto)) + ' m²'},
          {valor: 'otros', nombre: 'Otros', cuenta: num(suma(por.otros))}].filter(function (o) {
            return o.valor === 'vehiculos' || o.valor === st.clase || por[o.valor].length; }), st.clase) + antesDeLaCopia();
      h += '<div id="od-lista">' + (st.clase === 'pasto' ? listaPasto(por.pasto) : listaPiezas(por[st.clase])) + '</div>';
      cont().innerHTML = h; enganchar();
      $('od-volver').onclick = function () { history.back(); };
      $('od-clase').onclick = function (e) {
        var b = e.target.closest('[data-valor]'); if (b && b.dataset.valor !== st.clase) { st.clase = b.dataset.valor; almacen(); }
      };
      $('od-lista').onclick = function (e) {
        var s = e.target.closest('[data-serie]');
        if (s) { st.q = L.serie(s.dataset.serie).serie; ir('od-serie', {seguir: true}); return; }
        var g = e.target.closest('[data-prod]');
        if (g) { st.abiertos[g.dataset.prod] = !st.abiertos[g.dataset.prod]; almacen(); }
      };
    }).catch(function () {});
  }

  // Vehículos y otros: por tipo, y dentro una tarjeta por modelo y color; al picar, sus series
  function listaPiezas(es) {
    if (!es.length) return '<p class="vacio">No hay nada aquí ' + (st.dia ? 'ese día' : 'hoy') + '.</p>';
    var tipos = {}, orden = [];
    es.forEach(function (e) {
      var p = L.producto(e);
      if (!tipos[p.titulo]) { tipos[p.titulo] = {}; orden.push(p.titulo); }
      var k = e.producto_id;
      (tipos[p.titulo][k] = tipos[p.titulo][k] || {p: p, e: e, filas: []}).filas.push(e);
    });
    return orden.map(function (t) {
      var prods = Object.keys(tipos[t]).map(function (k) { return tipos[t][k]; });
      var total = prods.reduce(function (s, x) { return s + x.filas.reduce(function (a, e) { return a + Number(e.cantidad); }, 0); }, 0);
      return '<div class="od-grupo-tit"><span>' + esc(t) + '</span><span class="num">' + num(total) + '</span></div><div class="renglones">' +
        prods.map(function (x) {
          var n = x.filas.reduce(function (a, e) { return a + Number(e.cantidad); }, 0), abierto = st.abiertos[x.e.producto_id];
          var conSerie = x.filas.some(function (e) { return e.lote; });
          return '<button type="button" class="renglon od-prod' + (abierto ? ' abierto' : '') + '" data-prod="' + x.e.producto_id + '" aria-expanded="' + !!abierto + '">' +
            '<span class="prin">' + esc(x.p.color || x.p.titulo) + '</span><span class="prin der num' + (n < 0 ? ' od-alerta' : '') + '">' + num(n) + '</span>' +
            '<span class="sec">' + esc(x.p.codigo) + (conSerie ? ' · ' + (abierto ? 'ocultar series' : 'ver series') : '') + '</span><span></span></button>' +
            (abierto && conSerie ? '<div class="od-series">' + x.filas.map(function (e) {
              var s = L.serie(e.lote);
              return '<button type="button" class="od-serie" data-serie="' + esc(e.lote) + '"><span class="num">' + esc(s.serie) + '</span>' +
                '<small>' + (s.pedimento ? 'Pedimento ' + esc(s.pedimento) + ' · ' : '') + (e.llego ? 'llegó el ' + esc(BMA.fecha(e.llego)) : 'aquí desde el ' + esc(BMA.fecha(e.desde))) +
                (Number(e.cantidad) !== 1 ? ' · <b class="od-alerta">' + num(e.cantidad) + '</b>' : '') + '</small></button>';
            }).join('') + '</div>' : '');
        }).join('') + '</div>';
    }).join('');
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
      cont().innerHTML = barra(false).replace('<div class="barra">', '<div class="barra">' + UI.filtro('od-malm', 'Sucursal', st.movAlm ? nomAlm(st.movAlm) : 'Todas')) +
        '<div id="od-movs"><p class="vacio">Cargando…</p></div>';
      enganchar();
      $('od-malm').onclick = function () {
        UI.abrirLista({titulo: 'Sucursal', elegido: st.movAlm || '', grupos: [{opciones: [{valor: '', nombre: 'Todas'}].concat(resumen.almacenes.map(function (a) {
          return {valor: a.codigo, nombre: L.nombreAlmacen(a.nombre)};
        }))}]}).then(function (v) { if (v === null) return; st.movAlm = v || null; movimientos(); });
      };
      UI.llamar('bma_odoo_movimientos', {p_almacen: st.movAlm, p_limite: 300}).then(function (ms) {
        var el = $('od-movs'); if (!el) return;
        if (!ms.length) { el.innerHTML = '<p class="vacio">Sin movimientos.</p>'; return; }
        var h = '<div class="renglones">', semana = null;
        ms.forEach(function (m) {
          var l = L.lunes(m.fecha);
          if (l !== semana) { semana = l; h += '<div class="semana">' + esc(L.semana(l)) + '</div>'; }
          h += filaMov(m, st.movAlm);
        });
        h += '</div>' + (ms.length >= 300 ? '<p class="mas-res">Se ven los últimos 300. Para uno en particular, busca su serie.</p>' : '');
        el.innerHTML = h;
        el.onclick = function (e) {
          var s = e.target.closest('[data-serie]'); if (!s) return;
          st.q = L.serie(s.dataset.serie).serie; ir('od-serie', {seguir: true});
        };
      }).catch(function () {});
    };
    if (resumen) pinta(); else cargarResumen().then(pinta).catch(function () {});
  }
  function filaMov(m, alm) {
    var t = L.tipoMov(m, alm), p = L.producto(m), s = L.serie(m.lote);
    var donde = alm ? '' : (m.de_almacen && m.a_almacen && m.de_almacen !== m.a_almacen ? nomAlm(m.de_almacen) + ' → ' + nomAlm(m.a_almacen)
      : nomAlm(m.de_almacen || m.a_almacen));
    var tipoTxt = t.texto.replace(/(S-[A-Z0-9]+)/g, function (c) { return nomAlm(c); });
    var sec = [donde, m.cliente, m.venta || m.origen, m.referencia, 'lo hizo ' + (m.creo || '?')].filter(Boolean).map(esc).join(' · ');
    return '<' + (m.lote ? 'button type="button" data-serie="' + esc(m.lote) + '"' : 'div') + ' class="renglon' + (m.lote ? '' : ' od-fija') + '">' +
      '<span class="prin"><span class="od-tipo' + (t.alerta ? ' od-alerta' : '') + '">' + esc(tipoTxt) + '</span> ' + esc(p.titulo) + (p.color ? ' · ' + esc(p.color) : '') + '</span>' +
      '<span class="sec der">' + esc(L.fechaHora(m.fecha)) + '</span>' +
      '<span class="sec">' + (m.lote ? '<span class="num">' + esc(s.serie) + '</span> · ' : (m.unidad ? esc(L.cantidad(m.cantidad, m.unidad)) + ' · ' : '')) + sec +
      (m.cambios ? ' · <b class="od-alerta">se cambió después</b>' : '') + '</span><span></span></' + (m.lote ? 'button' : 'div') + '>';
  }

  // ---------------------------------------------------------------- Buscar serie
  function buscarSerie() {
    cont().innerHTML = '<div class="barra"><input type="search" class="campo-buscar" id="od-q" placeholder="Número de serie (basta una parte)" autocomplete="off" spellcheck="false" value="' + esc(st.q) + '"></div>' +
      '<div id="od-res"></div>';
    var q = $('od-q');
    q.oninput = function () { clearTimeout(tBuscar); tBuscar = setTimeout(function () { st.q = q.value.trim(); resultados(); }, 300); };
    if (!resumen) cargarResumen().then(resultados).catch(function () {}); else resultados();
    if (!st.q) q.focus();
  }
  function resultados() {
    var el = $('od-res'); if (!el) return;
    if (st.q.replace(/\s/g, '').length < 4) { el.innerHTML = st.q ? '<p class="vacio">Escribe al menos 4 letras o números.</p>' : ''; return; }
    var buscado = st.q;
    UI.llamar('bma_odoo_serie', {p_q: st.q}).then(function (rs) {
      if (buscado !== st.q || !$('od-res')) return;
      if (!rs.length) { el.innerHTML = '<p class="vacio">No hay ninguna serie con "' + esc(st.q) + '".</p>'; return; }
      el.innerHTML = rs.map(function (r) {
        var s = L.serie(r.lote);
        var hoy = (r.hoy || []).filter(function (x) { return Number(x.cantidad) !== 0; });
        return '<div class="ficha od-ficha"><h2 class="num">' + esc(s.serie) + '</h2>' +
          '<div class="sub">' + esc(r.producto || (r.movimientos && r.movimientos.length ? r.movimientos[0].producto : '') || '') + (s.pedimento ? '<br>Pedimento ' + esc(s.pedimento) : '') + '</div>' +
          '<div class="od-hoy' + (hoy.length > 1 ? ' od-alerta' : '') + '">' + (hoy.length
            ? 'Hoy está en ' + hoy.map(function (x) { return esc(nomAlm(x.almacen)) + (Number(x.cantidad) !== 1 ? ' (' + num(x.cantidad) + ')' : ''); }).join(' y ')
            : 'Hoy no está en ningún almacén') + '</div>' +
          '<div class="seccion">Su historia</div>' + (r.movimientos || []).map(function (m) {
            var t = L.tipoMov(m);
            var ruta = (m.de_almacen ? nomAlm(m.de_almacen) : m.de_ubicacion) + ' → ' + (m.a_almacen ? nomAlm(m.a_almacen) : m.a_ubicacion);
            return '<div class="mov"><span class="t' + (t.alerta ? ' od-alerta' : '') + '">' + esc(t.texto.replace(/(S-[A-Z0-9]+)/g, function (c) { return nomAlm(c); })) + '</span>' +
              '<span class="d">' + esc(L.fechaHora(m.fecha)) + '</span>' +
              '<span class="d">' + [ruta, m.cliente, m.venta, m.referencia, 'lo hizo ' + (m.creo || '?')].filter(Boolean).map(esc).join(' · ') +
              (m.cambios ? ' · <b class="od-alerta">se cambió después</b>' : '') + '</span><span></span></div>';
          }).join('') + '</div>';
      }).join('');
    }).catch(function () {});
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
        if (!as.length) { el.innerHTML = '<p class="vacio">' + (st.vista === 'pendiente' ? 'Nada por revisar.' : 'Todavía no revisas ninguna.') + '</p>'; return; }
        var grupos = {}, orden = Object.keys(L.ALERTAS);
        as.forEach(function (a) { (grupos[a.tipo] = grupos[a.tipo] || []).push(a); });
        el.innerHTML = orden.filter(function (t) { return grupos[t]; }).map(function (t) {
          var abierto = st.grupos[t] || Object.keys(grupos).length === 1;
          return '<button class="d-grupo' + (abierto ? ' abierto' : '') + '" data-grupo="' + t + '" aria-expanded="' + abierto + '">' +
            '<span class="d-mot">' + esc(L.ALERTAS[t]) + '</span><span class="d-n">' + grupos[t].length + '</span>' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>' +
            (abierto ? '<div class="renglones">' + grupos[t].map(function (a) { return filaAlerta(a, as.indexOf(a)); }).join('') + '</div>' : '');
        }).join('');
        el.onclick = function (e) {
          var g = e.target.closest('[data-grupo]');
          if (g) { st.grupos[g.dataset.grupo] = !st.grupos[g.dataset.grupo]; pinta(); return; }
          var b = e.target.closest('[data-accion]'); if (!b) return;
          var a = as[+b.dataset.i];
          if (b.dataset.accion === 'serie') { st.q = L.serie(a.lote).serie; ir('od-serie', {seguir: true}); }
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
    var s = a.lote ? L.serie(a.lote).serie : '';
    var acciones = (s ? '<button data-accion="serie" data-i="' + i + '">Ver la serie</button>' : '') +
      (st.vista === 'pendiente' ? '<button data-accion="revisado" data-i="' + i + '">Ya lo revisé</button>' : '');
    return '<div class="mov od-alerta-fila"><span class="t">' + esc(a.titulo) + '</span><span class="d">' + esc(L.fechaHora(a.fecha)) + '</span>' +
      '<span class="d">' + esc(a.almacen ? nomAlm(a.almacen) : '') + (a.detalle ? ' · ' + esc(corto(a.detalle)) : '') + (s ? ' · <span class="num">' + esc(s) + '</span>' : '') +
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
