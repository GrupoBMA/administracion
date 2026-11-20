// Ventas: buscador, lista y ficha con el historial de cada venta (window.Ventas).
// La base decide estado, precio y saldo (bma.recalcular); aquí solo se muestra y se piden los cambios.
(function () {
  var esc = BMA.esc, $ = function (id) { return document.getElementById(id); };
  var LINEAS = [{valor: 'motos', nombre: 'Motos'}, {valor: 'pasto', nombre: 'Pasto'}, {valor: 'otro', nombre: 'Otro'}];
  var ESTADOS = [{valor: 'abierta', nombre: 'Abiertas'}, {valor: 'cerrada', nombre: 'Cerradas'},
                 {valor: 'cancelada', nombre: 'Canceladas'}, {valor: '', nombre: 'Todas'}];
  var LIMITE = 100;
  var st = {q: '', sucursal: null, estado: 'abierta', ficha: null, tiempo: null};

  function cont() { return $('mod-ventas'); }
  function esAdmin() { return window.SESION && SESION.rol === 'admin'; }

  function pintar() {
    if (st.ficha) { pintarFicha(st.ficha); return; }
    cont().innerHTML =
      '<div class="barra"><input class="campo-buscar" id="v-q" type="search" placeholder="Folio, remisión, factura, producto o cliente" aria-label="Buscar venta">' +
      '<button class="filtro" id="v-suc">Sucursal: <b>' + esc(st.sucursal ? BMA.nombreDe(BMA.SUCURSALES, st.sucursal) : 'Todas') + '</b></button>' +
      '<button class="filtro" id="v-est">Estado: <b>' + esc(BMA.nombreDe(ESTADOS, st.estado || '')) + '</b></button>' +
      '<button class="btn primario" id="v-registrar">Registrar</button></div>' +
      '<div id="v-lista" class="renglones"><p class="vacio">Cargando…</p></div>';
    var q = $('v-q'); q.value = st.q;
    q.oninput = function () { clearTimeout(st.tiempo); st.tiempo = setTimeout(function () { st.q = q.value; lista(); }, 300); };
    $('v-suc').onclick = function () {
      UI.abrirLista({titulo: 'Sucursal', elegido: st.sucursal || '', grupos: [{opciones: [{valor: '', nombre: 'Todas'}].concat(BMA.SUCURSALES)}]})
        .then(function (v) { if (v === null) return; st.sucursal = v || null; pintar(); });
    };
    $('v-est').onclick = function () {
      UI.abrirLista({titulo: 'Estado', elegido: st.estado || '', grupos: [{opciones: ESTADOS}]})
        .then(function (v) { if (v === null) return; st.estado = v || ''; pintar(); });
    };
    $('v-registrar').onclick = function () { selModulo('registrar'); };
    lista();
  }

  function renglon(v) {
    var e = BMA.etiquetaEstado(v);
    return '<button class="renglon" data-id="' + esc(v.id) + '"><span class="prin">' + esc(v.producto) + '</span>' +
      '<span class="der num">' + BMA.dinero(v.pagado) + '</span>' +
      '<span class="sec">' + esc(v.folio) + ' · ' + esc(v.cliente ? v.cliente.nombre : 'Sin cliente') +
      (v.remision ? ' · rem. ' + esc(v.remision) : '') + (v.ultimo ? ' · ' + BMA.fecha(v.ultimo) : '') + '</span>' +
      '<span class="sec der">' + (v.dudas ? '<span class="marca-duda">Duda</span> ' : '') +
      '<span class="chip-estado ' + e.clase + '">' + esc(e.texto) + '</span></span></button>';
  }

  function lista() {
    var pedida = [st.q, st.sucursal, st.estado].join('|');
    UI.llamar('bma_ventas_buscar', {p_q: st.q, p_sucursal: st.sucursal, p_estado: st.estado || null, p_limite: LIMITE}).then(function (vs) {
      var el = $('v-lista');
      if (!el || pedida !== [st.q, st.sucursal, st.estado].join('|')) return;     // llegó una búsqueda vieja
      if (!vs.length) { el.innerHTML = '<p class="vacio">No hay ventas con esa búsqueda.</p>'; return; }
      el.innerHTML = vs.map(renglon).join('') +
        (vs.length === LIMITE ? '<p class="mas-res">Se muestran las ' + LIMITE + ' más recientes. Escribe algo más para afinar.</p>' : '');
      el.onclick = function (e) { var b = e.target.closest('[data-id]'); if (b) abrir(b.dataset.id); };
    }).catch(function () {});
  }

  function abrir(id) { st.ficha = id; pintarFicha(id); window.scrollTo(0, 0); }

  function dato(campo, etiqueta, valor) {
    return '<button class="dato editable" data-campo="' + campo + '"><span class="e">' + etiqueta + '</span>' +
      '<span class="v' + (valor ? '' : ' vacio') + '">' + esc(valor || 'Agregar') + '</span></button>';
  }

  function movimiento(m) {
    var t = BMA.TIPOS.filter(function (x) { return x.valor === m.tipo; })[0];
    var det = [BMA.fecha(m.fecha), m.metodo ? BMA.nombreDe(BMA.METODOS, m.metodo) : '', m.cuenta || '',
               m.confirmado_banco ? '✓ banco' : '', m.quien || ''].filter(Boolean).join(' · ');
    return '<div class="mov"><span class="t">' + esc(t ? t.nombre : m.tipo) + '</span>' +
      '<span class="num">' + (t && t.conDinero ? (m.tipo === 'devolucion' ? '−' : '') + BMA.dinero(m.monto) : '') + '</span>' +
      '<span class="d">' + esc(det) + (m.nota ? '<br>' + esc(m.nota) : '') + '</span><span></span>' +
      '<span class="acc"><button data-corregir="' + esc(m.id) + '">Corregir</button>' +
      (esAdmin() ? '<button data-eliminar="' + esc(m.id) + '">Eliminar</button>' : '') + '</span></div>';
  }

  function cambio(c, nombres) {
    var t = BMA.textoCambio(c, nombres);
    if (!t.length) return '';
    var que = c.tabla === 'movimientos' ? 'Movimiento: ' : '';
    return '<div class="cambio">' + t.map(function (x) { return esc(que + x); }).join('<br>') +
      ' <span class="q">· ' + esc(c.quien || '') + ', ' + BMA.fecha(c.fecha) + '</span></div>';
  }

  function pintarFicha(id) {
    UI.llamar('bma_venta', {p_id: id}).then(function (r) {
      var v = r.venta, e = BMA.etiquetaEstado(v), s = BMA.saldo(v);
      var dudas = r.dudas.filter(function (d) { return d.estado === 'pendiente'; });
      cont().innerHTML = '<div class="ficha-top"><button class="volver" id="v-volver">← Ventas</button></div><div class="ficha">' +
        (dudas.length ? '<div class="aviso-duda">' + dudas.map(function (d) { return esc(BMA.MOTIVOS[d.motivo] || d.motivo) + ': ' + esc(d.detalle); }).join('<br>') + '</div>' : '') +
        '<h2>' + esc(v.producto) + '</h2><div class="sub">' + esc(v.folio) + ' · ' + esc(BMA.nombreDe(BMA.SUCURSALES, v.sucursal)) + ' · ' +
        BMA.fecha(v.fecha) + ' · <span class="chip-estado ' + e.clase + '">' + esc(e.texto) + '</span></div>' +
        '<div class="cifras"><button class="cifra dato editable" data-campo="precio_total"><span class="e">Precio</span><span class="v' + (v.precio_total == null ? ' texto' : '') + '">' +
        (v.precio_total == null ? 'Por confirmar' : BMA.dinero(v.precio_total)) + '</span></button>' +
        '<div class="cifra"><span class="e">Pagado</span><div class="v">' + BMA.dinero(v.pagado) + '</div></div>' +
        '<div class="cifra' + (s > 0 ? ' falta' : '') + '"><span class="e">Saldo</span><div class="v">' + BMA.dinero(s) + '</div></div></div>' +
        '<div class="datos">' + dato('cliente_id', 'Cliente', v.cliente && (v.cliente.nombre + ' · ' + v.cliente.numero)) +
        dato('vendedor_id', 'Vendedor', v.vendedor && v.vendedor.nombre) + dato('remision', 'Remisión', v.remision) +
        dato('factura', 'Factura', v.factura) + dato('producto', 'Producto', v.producto) +
        dato('linea', 'Línea', BMA.nombreDe(LINEAS, v.linea)) + dato('color', 'Color', v.color) + '</div>' +
        '<div class="btn-fila"><button class="btn primario" id="v-agregar">Agregar movimiento</button></div>' +
        '<div class="seccion">Movimientos</div>' + (r.movimientos.length ? r.movimientos.map(movimiento).join('') : '<p class="vacio">Sin movimientos.</p>') +
        (r.cambios.length ? '<div class="seccion">Cambios</div>' + r.cambios.map(function (c) { return cambio(c, r.nombres); }).join('') : '') +
        '</div>';
      $('v-volver').onclick = function () { st.ficha = null; pintar(); };
      $('v-agregar').onclick = function () { Registrar.pagoDe(v); };
      cont().querySelector('.ficha').onclick = function (ev) {
        var b = ev.target.closest('[data-campo]'); if (b) { editar(v, b.dataset.campo); return; }
        b = ev.target.closest('[data-corregir]');
        if (b) { corregir(r.movimientos.filter(function (m) { return m.id === b.dataset.corregir; })[0], v.id); return; }
        b = ev.target.closest('[data-eliminar]');
        if (b) eliminar(b.dataset.eliminar, v.id);
      };
    }).catch(function () { st.ficha = null; });
  }

  // ---------- Editar la venta ----------
  function pedirCampo(v, campo) {
    // escoger regresa null al cancelar y {id: null} al quitar; aquí quitar es '' (borrar)
    var persona = function (p) { return p ? (p.id || '') : null; };
    if (campo === 'cliente_id') return Personas.escoger({titulo: 'Cliente', tipo: 'cliente', quitar: 'Sin cliente', elegido: v.cliente && v.cliente.id}).then(persona);
    if (campo === 'vendedor_id') return Personas.escoger({titulo: 'Vendedor', tipo: 'vendedor', quitar: 'Sin vendedor', elegido: v.vendedor && v.vendedor.id}).then(persona);
    if (campo === 'linea') return UI.abrirLista({titulo: 'Línea', elegido: v.linea, grupos: [{opciones: LINEAS}]});
    if (campo === 'precio_total') return UI.pedirMonto({titulo: 'Precio total', ayuda: 'Déjalo vacío si aún no se sabe.', valor: v.precio_total, opcional: true});
    var t = {remision: 'Remisión', factura: 'Factura', producto: 'Producto', color: 'Color'}[campo];
    return UI.pedirTexto({titulo: t, valor: v[campo], opcional: campo !== 'producto'});
  }

  function editar(v, campo) {
    pedirCampo(v, campo).then(function (val) {
      if (val === null || val === undefined) return;
      var p = {}; p[campo] = val === '' ? null : val;
      return UI.guardar('bma_venta_editar', {p_id: v.id, p: p}).then(function (r) {
        if (r !== null) { UI.aviso('Guardado'); pintarFicha(v.id); }
      });
    }).catch(function () {});
  }

  // ---------- Corregir y eliminar movimientos ----------
  function corregir(m, ventaId) {
    var conDinero = BMA.TIPOS.some(function (t) { return t.valor === m.tipo && t.conDinero; });
    var ops = [{valor: 'fecha', nombre: 'Fecha', detalle: BMA.fecha(m.fecha)}];
    if (conDinero) ops.push({valor: 'monto', nombre: 'Monto', detalle: BMA.dinero(m.monto)},
      {valor: 'metodo', nombre: 'Método', detalle: m.metodo ? BMA.nombreDe(BMA.METODOS, m.metodo) : 'Sin método'},
      {valor: 'cuenta', nombre: 'Cuenta', detalle: m.cuenta || 'Sin cuenta'},
      {valor: 'confirmado_banco', nombre: m.confirmado_banco ? 'Quitar confirmación del banco' : 'Confirmar en el banco'});
    ops.push({valor: 'nota', nombre: 'Nota', detalle: m.nota || 'Sin nota'});
    UI.abrirLista({titulo: 'Corregir movimiento', grupos: [{opciones: ops}]}).then(function (campo) {
      if (!campo) return null;
      var paso;
      if (campo === 'fecha') paso = UI.pedirTexto({titulo: 'Fecha', tipo: 'date', valor: m.fecha, max: BMA.hoy()});
      else if (campo === 'monto') paso = UI.pedirMonto({titulo: 'Monto', valor: m.monto});
      else if (campo === 'metodo') paso = UI.abrirLista({titulo: 'Método', elegido: m.metodo, grupos: [{opciones: BMA.METODOS}]});
      else if (campo === 'cuenta') paso = UI.pedirTexto({titulo: 'Cuenta', ayuda: 'Banco donde cayó, p. ej. HSBC', valor: m.cuenta, opcional: true});
      else if (campo === 'nota') paso = UI.pedirTexto({titulo: 'Nota', tipo: 'largo', valor: m.nota, opcional: true});
      else paso = Promise.resolve(!m.confirmado_banco);
      return paso.then(function (val) {
        if (val === null || val === undefined) return;
        var p = {}; p[campo] = val;
        return UI.guardar('bma_movimiento_corregir', {p_id: m.id, p: p}).then(function (r) {
          if (r !== null) { UI.aviso('Corregido'); pintarFicha(ventaId); }
        });
      });
    }).catch(function () {});
  }

  function eliminar(movId, ventaId) {
    UI.confirmar({titulo: '¿Eliminar este movimiento?', ayuda: 'Queda registrado en los cambios de la venta.', si: 'Eliminar'}).then(function (ok) {
      if (!ok) return;
      return UI.guardar('bma_movimiento_eliminar', {p_id: movId}).then(function (r) {
        if (r !== null) { UI.aviso('Eliminado'); pintarFicha(ventaId); }
      });
    }).catch(function () {});
  }

  // ---------- Buscar una venta (lo usa Dudas) ----------
  // Busca y escoge una venta. -> Promise(id|null). Lo usan Registrar y Dudas.
  async function buscarVenta(titulo, sucursal) {
    var q = await UI.pedirTexto({titulo: titulo || '¿De qué venta?', placeholder: 'Folio, remisión, factura, producto o cliente', boton: 'Buscar'});
    if ((q === null || q === undefined)) return null;
    var vs = await UI.llamar('bma_ventas_buscar', {p_q: q, p_sucursal: sucursal || null, p_estado: null, p_limite: 50});
    if (!vs.length) { UI.aviso('No encontré ventas con "' + q + '"', true); return null; }
    var id = await UI.abrirLista({titulo: 'Escoge la venta', buscar: vs.length > 8, grupos: [{opciones: vs.map(function (v) {
      return {valor: v.id, nombre: v.producto, detalle: v.folio + ' · ' + (v.cliente ? v.cliente.nombre : 'Sin cliente') +
        (v.remision ? ' · rem. ' + v.remision : '') + ' · ' + BMA.etiquetaEstado(v).texto};
    })}]});
    return (id === null || id === undefined) ? null : id;
  }

  window.Ventas = {pintar: pintar, abrir: abrir, buscarVenta: buscarVenta,
                   recargar: function () { if (st.ficha) pintarFicha(st.ficha); else lista(); }};
})();
