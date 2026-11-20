// Personas: clientes, empleados y vendedores, cada uno con su ficha e historial (window.Personas).
// Personas.escoger() es el buscador con "Nueva persona" que usan Ventas y Registrar.
(function () {
  var esc = BMA.esc, $ = function (id) { return document.getElementById(id); };
  var TIPOS = [{valor: 'cliente', nombre: 'Cliente'}, {valor: 'empleado', nombre: 'Empleado'}, {valor: 'vendedor', nombre: 'Vendedor'}];
  var st = {q: '', tipo: null, quitadas: false, ficha: null, tiempo: null};

  function cont() { return $('mod-personas'); }
  function tiposTxt(t) { return (t || []).map(function (x) { return BMA.nombreDe(TIPOS, x); }).join(', '); }

  function pintar() {
    if (st.ficha) { abrir(st.ficha); return; }
    cont().innerHTML =
      '<div class="barra"><input class="campo-buscar" id="p-q" type="search" placeholder="Buscar por nombre o número" aria-label="Buscar persona">' +
      '<button class="filtro" id="p-tipo">Tipo: <b>' + esc(st.tipo ? BMA.nombreDe(TIPOS, st.tipo) : 'Todos') + '</b></button>' +
      '<button class="filtro" id="p-ver">Ver: <b>' + (st.quitadas ? 'Quitadas' : 'En las listas') + '</b></button>' +
      '<button class="btn" id="p-nueva">Nueva persona</button></div><div id="p-lista" class="renglones"><p class="vacio">Cargando…</p></div>';
    var q = $('p-q'); q.value = st.q;
    q.oninput = function () { clearTimeout(st.tiempo); st.tiempo = setTimeout(function () { st.q = q.value; lista(); }, 300); };
    $('p-tipo').onclick = function () {
      UI.abrirLista({titulo: 'Tipo', elegido: st.tipo || '', grupos: [{opciones: [{valor: '', nombre: 'Todos'}].concat(TIPOS)}]})
        .then(function (v) { if (v === null) return; st.tipo = v || null; pintar(); });
    };
    $('p-ver').onclick = function () {
      UI.abrirLista({titulo: 'Ver', elegido: st.quitadas ? 'q' : 'a', grupos: [{opciones: [
        {valor: 'a', nombre: 'En las listas'}, {valor: 'q', nombre: 'Quitadas', detalle: 'Las que alguien quitó de las listas'}]}]})
        .then(function (v) { if (v === null) return; st.quitadas = v === 'q'; pintar(); });
    };
    $('p-nueva').onclick = function () { nueva().then(function (p) { if (p) { st.ficha = p.id; pintar(); } }); };
    lista();
  }

  function lista() {
    UI.llamar('bma_personas_buscar', {p_q: st.q, p_tipo: st.tipo, p_incluir_ocultas: st.quitadas}).then(function (ps) {
      var el = $('p-lista'); if (!el) return;
      if (st.quitadas) ps = ps.filter(function (p) { return p.activa === false; });
      if (!ps.length) { el.innerHTML = '<p class="vacio">No hay personas con esa búsqueda.</p>'; return; }
      el.innerHTML = ps.map(function (p) {
        var cuenta = [p.ventas ? p.ventas + ' compra' + (p.ventas > 1 ? 's' : '') : '', p.vendidas ? p.vendidas + ' vendida' + (p.vendidas > 1 ? 's' : '') : '']
          .filter(Boolean).join(' · ');
        return '<button class="renglon" data-id="' + esc(p.id) + '"><span class="prin">' + esc(p.nombre) + '</span>' +
          '<span class="der num">' + esc(p.numero) + '</span><span class="sec">' + esc(tiposTxt(p.tipos)) +
          (p.sucursal ? ' · ' + esc(p.sucursal) : '') + '</span><span class="sec der">' + esc(cuenta) + '</span></button>';
      }).join('');
      el.onclick = function (e) { var b = e.target.closest('[data-id]'); if (b) { st.ficha = b.dataset.id; pintar(); } };
    }).catch(function () {});
  }

  function abrir(id) {
    st.ficha = id;
    UI.llamar('bma_persona', {p_id: id}).then(function (r) {
      var p = r.persona;
      var dato = function (campo, etiqueta, valor) {
        return '<button class="dato editable" data-campo="' + campo + '"><span class="e">' + etiqueta + '</span>' +
          '<span class="v' + (valor ? '' : ' vacio') + '">' + esc(valor || 'Agregar') + '</span></button>';
      };
      var ventaRen = function (v, conSaldo) {
        var s = BMA.saldo(v), e = BMA.etiquetaEstado(v);
        return '<button class="renglon" data-venta="' + esc(v.id) + '"><span class="prin">' + esc(v.producto) + '</span>' +
          '<span class="der num">' + BMA.dinero(v.pagado) + '</span><span class="sec">' + esc(v.folio) + ' · ' + BMA.fecha(v.fecha) + '</span>' +
          '<span class="sec der"><span class="chip-estado ' + e.clase + '">' + esc(e.texto) + '</span>' +
          (conSaldo && s ? ' · saldo ' + BMA.dinero(s) : '') + '</span></button>';
      };
      cont().innerHTML = '<div class="ficha-top"><button class="volver" id="p-volver">← Personas</button></div><div class="ficha">' +
        '<h2>' + esc(p.nombre) + '</h2><div class="sub">Número ' + esc(p.numero) + (p.activa ? '' : ' · <span class="chip-estado cancelada">Quitada de las listas</span>') + '</div><div class="datos">' +
        dato('nombre', 'Nombre', p.nombre) + dato('tipos', 'Es', tiposTxt(p.tipos)) + dato('telefono', 'Teléfono', p.telefono) +
        dato('sucursal', 'Sucursal', p.sucursal ? BMA.nombreDe(BMA.SUCURSALES, p.sucursal) : '') + dato('notas', 'Notas', p.notas) + '</div>' +
        '<div class="btn-fila"><button class="btn" id="p-quitar">' + (p.activa ? 'Quitar de las listas' : 'Volver a poner en las listas') + '</button></div>' +
        (r.compras.length ? '<div class="seccion">Compras</div><div class="renglones">' + r.compras.map(function (v) { return ventaRen(v, true); }).join('') + '</div>' : '') +
        (r.vendidas.length ? '<div class="seccion">Vendió · ' + r.vendidas.length + (r.vendidas.length === 300 ? '+' : '') + '</div><div class="renglones">' +
          r.vendidas.map(function (v) { return ventaRen(v, false); }).join('') + '</div>' : '') +
        (r.cambios.length ? '<div class="seccion">Cambios</div>' + r.cambios.map(cambio).join('') : '') + '</div>';
      $('p-volver').onclick = function () { st.ficha = null; pintar(); };
      $('p-quitar').onclick = function () {
        UI.guardar('bma_persona_quitar', {p_id: p.id, p_quitar: p.activa}).then(function (r) {
          if (r === null) return;
          UI.olvidarPersonas(); UI.aviso(p.activa ? 'Ya no sale en las listas' : 'Otra vez en las listas'); abrir(p.id);
        }).catch(function () {});
      };
      cont().querySelector('.ficha').onclick = function (e) {
        var v = e.target.closest('[data-venta]');
        if (v && window.Ventas && Ventas.abrir) { selModulo('ventas'); Ventas.abrir(v.dataset.venta); return; }
        var d = e.target.closest('[data-campo]'); if (d) editar(p, d.dataset.campo);
      };
    }).catch(function () { st.ficha = null; });
  }

  function cambio(c) {
    var t = BMA.textoCambio(c, {});
    return '<div class="cambio">' + t.map(esc).join('<br>') + ' <span class="q">· ' + esc(c.quien || 'Importado') + ', ' +
      BMA.fecha(c.fecha) + '</span></div>';
  }

  function pedirCampo(p, campo) {
    if (campo === 'tipos') return UI.escogerVarios({titulo: '¿Qué es?', opciones: TIPOS, elegidos: p.tipos || [], falta: 'Escoge al menos uno.'});
    if (campo === 'sucursal') return UI.abrirLista({titulo: 'Sucursal', elegido: p.sucursal || '',
      grupos: [{opciones: [{valor: '', nombre: 'Sin sucursal'}].concat(BMA.SUCURSALES)}]});
    var t = {nombre: 'Nombre', telefono: 'Teléfono', notas: 'Notas'}[campo];
    return UI.pedirTexto({titulo: t, valor: p[campo], opcional: campo !== 'nombre', tipo: campo === 'notas' ? 'largo' : 'text'});
  }

  function editar(p, campo) {
    pedirCampo(p, campo).then(function (v) {
      if (v === null) return;
      var datos = {id: p.id, nombre: p.nombre, tipos: p.tipos, telefono: p.telefono, sucursal: p.sucursal, notas: p.notas};
      datos[campo] = v;
      return UI.guardar('bma_persona_guardar', {p: datos}).then(function (id) { if (id) { UI.aviso('Guardado'); abrir(p.id); } });
    }).catch(function () {});
  }

  // Alta paso a paso. -> Promise({id, nombre}|null)
  function nueva(tipoInicial) {
    var p = {tipos: tipoInicial ? [tipoInicial] : []};
    return UI.pedirTexto({titulo: 'Nueva persona', ayuda: 'Nombre completo', boton: 'Siguiente'}).then(function (n) {
      if (!n) return null; p.nombre = n;
      return UI.escogerVarios({titulo: '¿Qué es?', opciones: TIPOS, elegidos: p.tipos, boton: 'Siguiente', falta: 'Escoge al menos uno.'});
    }).then(function (t) {
      if (!t) return null; p.tipos = t;
      return UI.abrirLista({titulo: 'Sucursal', grupos: [{opciones: [{valor: '', nombre: 'Sin sucursal'}].concat(BMA.SUCURSALES)}]});
    }).then(function (s) {
      if (s === null || s === undefined) return null; p.sucursal = s;
      return UI.pedirTexto({titulo: 'Teléfono', ayuda: 'Opcional', opcional: true, boton: 'Guardar'});
    }).then(function (tel) {
      if (tel === null || tel === undefined) return null; p.telefono = tel;
      return UI.guardar('bma_persona_guardar', {p: p});
    }).then(function (id) {
      if (!id) return null;
      UI.aviso('Persona dada de alta'); UI.olvidarPersonas();
      return {id: id, nombre: p.nombre};
    }).catch(function () { return null; });
  }

  // Buscador de personas para escoger una (cliente o vendedor). -> Promise({id, nombre}|null); {id:null} = quitar
  function escoger(o) {
    o = o || {};
    var TOPE = 300;   // lo que regresa bma_personas_buscar como máximo
    return UI.llamar('bma_personas_buscar', {p_q: '', p_tipo: o.tipo || null}).then(function (ps) {
      if (ps.length < TOPE) return ps;
      // Ya son muchas para cargarlas todas: se busca en la base por nombre o número
      return UI.pedirTexto({titulo: o.titulo || 'Escoger persona', placeholder: 'Nombre o número', boton: 'Buscar'}).then(function (q) {
        if (q === null || q === undefined) return null;
        return UI.llamar('bma_personas_buscar', {p_q: q, p_tipo: o.tipo || null});
      });
    }).then(function (ps) {
      if (!ps) return null;
      var ops = [{valor: '+nueva', nombre: '+ Nueva persona'}];
      if (o.quitar) ops.push({valor: '-', nombre: o.quitar});
      return UI.abrirLista({titulo: o.titulo || 'Escoger persona', buscar: true, elegido: o.elegido || null, grupos: [
        {opciones: ops},
        {titulo: ps.length ? 'Personas' : '', opciones: ps.map(function (p) {
          return {valor: p.id, nombre: p.nombre, detalle: 'Número ' + p.numero + (p.sucursal ? ' · ' + p.sucursal : '')};
        })}]}).then(function (v) {
          if (v === null) return null;
          if (v === '+nueva') return nueva(o.tipo);
          if (v === '-') return {id: null, nombre: ''};
          var p = ps.filter(function (x) { return x.id === v; })[0];
          return {id: p.id, nombre: p.nombre};
        });
    }).catch(function () { return null; });
  }

  window.Personas = {pintar: pintar, abrir: function (id) { st.ficha = id; pintar(); }, escoger: escoger, nueva: nueva, contar: function () {}};
})();
