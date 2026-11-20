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
    $('v-registrar').onclick = function () { if (Ventas.registrar) Ventas.registrar(); };
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
      $('v-agregar').onclick = function () { if (Ventas.agregarMovimiento) Ventas.agregarMovimiento(v); };
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

  // ---------- Registrar ----------
  // Cada paso es una hoja; cancelar en cualquiera deja todo sin guardar.
  var PAGO_INICIAL = [{valor: 'contado', nombre: 'Contado', detalle: 'Se paga completa'},
                      {valor: 'anticipo', nombre: 'Anticipo', detalle: 'Primer pago; la venta queda abierta'}];
  function paso(n, de, que) { return 'Paso ' + n + ' de ' + de + ' · ' + que; }
  function cancelado(v) { return v === null || v === undefined; }

  function frase(m, venta, cliente) {
    var t = BMA.nombreDe(BMA.TIPOS, m.tipo);
    var conDinero = BMA.TIPOS.some(function (x) { return x.valor === m.tipo && x.conDinero; });
    return t + (conDinero ? ' de ' + BMA.dinero(m.monto) + ' en ' + BMA.nombreDe(BMA.METODOS, m.metodo).toLowerCase() +
      (m.cuenta ? ' a ' + m.cuenta : '') : '') + ' por ' + venta.producto + (cliente ? ' para ' + cliente : '') +
      ', ' + BMA.nombreDe(BMA.SUCURSALES, venta.sucursal) + ', ' + BMA.fecha(m.fecha) + '.';
  }

  async function pedirPago(m, n0, total, que) {
    m.monto = await UI.pedirMonto({titulo: 'Monto', ayuda: paso(n0, total, que), valor: m.monto});
    if (cancelado(m.monto)) return false;
    m.metodo = await UI.abrirLista({titulo: 'Método', ayuda: paso(n0, total, que), elegido: m.metodo, grupos: [{opciones: BMA.METODOS}]});
    if (cancelado(m.metodo)) return false;
    m.cuenta = await UI.pedirTexto({titulo: 'Cuenta', ayuda: 'Opcional · banco donde cayó, p. ej. HSBC', opcional: true});
    return !cancelado(m.cuenta);
  }

  async function agregarMovimiento(v) {
    try {
      var tipos = BMA.TIPOS.filter(function (t) { return t.valor !== 'contado'; });
      var m = {fecha: BMA.hoy()};
      m.tipo = await UI.abrirLista({titulo: 'Agregar movimiento', ayuda: v.producto + ' · ' + v.folio,
        grupos: [{opciones: tipos.map(function (t) { return {valor: t.valor, nombre: t.nombre}; })}]});
      if (cancelado(m.tipo)) return;
      var conDinero = tipos.some(function (t) { return t.valor === m.tipo && t.conDinero; });
      if (conDinero && !(await pedirPago(m, 1, 2, 'Pago'))) return;
      m.fecha = await UI.pedirTexto({titulo: 'Fecha', tipo: 'date', valor: m.fecha, max: BMA.hoy()});
      if (cancelado(m.fecha)) return;
      m.nota = await UI.pedirTexto({titulo: 'Nota', ayuda: 'Opcional', tipo: 'largo', opcional: true, boton: 'Siguiente'});
      if (cancelado(m.nota)) return;
      var error = BMA.validarMovimiento(m);
      if (error) { UI.aviso(error, true); return; }
      if (!(await UI.confirmar({titulo: '¿Guardar?', ayuda: frase(m, v, v.cliente && v.cliente.nombre), si: 'Guardar'}))) return;
      var r = await UI.guardar('bma_movimiento_nuevo', {p_venta: v.id, p: m});
      if (r === null) return;
      UI.aviso('Movimiento guardado');
      abrir(v.id);
    } catch (e) { /* el aviso ya se mostró */ }
  }

  async function ventaNueva() {
    try {
      var T = 3, v = {fecha: BMA.hoy()}, m = {};
      v.sucursal = await UI.abrirLista({titulo: 'Sucursal', ayuda: paso(1, T, 'Venta'), grupos: [{opciones: BMA.SUCURSALES}]});
      if (cancelado(v.sucursal)) return;
      v.fecha = await UI.pedirTexto({titulo: 'Fecha de la venta', ayuda: paso(1, T, 'Venta'), tipo: 'date', valor: v.fecha, max: BMA.hoy()});
      if (cancelado(v.fecha)) return;
      v.producto = await UI.pedirTexto({titulo: 'Producto', ayuda: paso(1, T, 'Venta'), placeholder: 'p. ej. MC 200 PICK UP', boton: 'Siguiente'});
      if (cancelado(v.producto)) return;
      v.linea = await UI.abrirLista({titulo: 'Línea', ayuda: paso(1, T, 'Venta'), grupos: [{opciones: LINEAS}]});
      if (cancelado(v.linea)) return;
      var cli = await Personas.escoger({titulo: 'Cliente', tipo: 'cliente'});
      if (!cli || !cli.id) return;
      v.cliente_id = cli.id;
      var ven = await Personas.escoger({titulo: 'Vendedor', tipo: 'vendedor', quitar: 'Sin vendedor'});
      if (cancelado(ven)) return;
      v.vendedor_id = ven.id || null;
      v.remision = await UI.pedirTexto({titulo: 'Remisión o nota de venta', ayuda: 'Opcional', opcional: true, boton: 'Siguiente'});
      if (cancelado(v.remision)) return;
      v.factura = await UI.pedirTexto({titulo: 'Factura', ayuda: 'Opcional', opcional: true, boton: 'Siguiente'});
      if (cancelado(v.factura)) return;
      m.tipo = await UI.abrirLista({titulo: '¿Cómo paga?', ayuda: paso(2, T, 'Pago'), grupos: [{opciones: PAGO_INICIAL}]});
      if (cancelado(m.tipo)) return;
      if (!(await pedirPago(m, 2, T, 'Pago'))) return;
      if (m.tipo === 'anticipo') {
        var precio = await UI.pedirMonto({titulo: 'Precio total', ayuda: 'Opcional · déjalo vacío si aún no se sabe', opcional: true});
        if (cancelado(precio)) return;
        v.precio_total = precio === '' ? null : precio;
      }
      m.fecha = v.fecha;
      m.nota = await UI.pedirTexto({titulo: 'Nota', ayuda: 'Opcional', tipo: 'largo', opcional: true, boton: 'Siguiente'});
      if (cancelado(m.nota)) return;
      var error = BMA.validarMovimiento(m);
      if (error) { UI.aviso(error, true); return; }
      if (!(await UI.confirmar({titulo: paso(3, T, '¿Guardar?'), ayuda: frase(m, v, cli.nombre), si: 'Guardar'}))) return;
      v.movimiento = m;
      var r = await UI.guardar('bma_venta_nueva', {p: v});
      if (r === null) return;
      UI.aviso('Venta ' + r.folio + ' guardada');
      abrir(r.id);
    } catch (e) { /* el aviso ya se mostró */ }
  }

  async function escogerVenta() {
    try {
      var q = await UI.pedirTexto({titulo: '¿De qué venta?', placeholder: 'Folio, remisión, factura, producto o cliente', boton: 'Buscar'});
      if (cancelado(q)) return;
      var vs = await UI.llamar('bma_ventas_buscar', {p_q: q, p_sucursal: null, p_estado: null, p_limite: 50});
      if (!vs.length) { UI.aviso('No encontré ventas con "' + q + '"', true); return; }
      var id = await UI.abrirLista({titulo: 'Escoge la venta', buscar: vs.length > 8, grupos: [{opciones: vs.map(function (v) {
        return {valor: v.id, nombre: v.producto, detalle: v.folio + ' · ' + (v.cliente ? v.cliente.nombre : 'Sin cliente') +
          (v.remision ? ' · rem. ' + v.remision : '') + ' · ' + BMA.etiquetaEstado(v).texto};
      })}]});
      if (cancelado(id)) return;
      var r = await UI.llamar('bma_venta', {p_id: id});
      abrir(id);
      agregarMovimiento(r.venta);
    } catch (e) { /* el aviso ya se mostró */ }
  }

  function registrar() {
    UI.abrirLista({titulo: 'Registrar', grupos: [{opciones: [
      {valor: 'nueva', nombre: 'Venta nueva', detalle: 'De contado o con anticipo'},
      {valor: 'mov', nombre: 'Movimiento de una venta', detalle: 'Abono, liquidación, devolución, entrega…'}]}]})
      .then(function (v) { if (v === 'nueva') ventaNueva(); else if (v === 'mov') escogerVenta(); });
  }

  window.Ventas = {pintar: pintar, abrir: abrir, registrar: registrar, agregarMovimiento: agregarMovimiento,
                   recargar: function () { if (st.ficha) pintarFicha(st.ficha); else lista(); }};
})();
