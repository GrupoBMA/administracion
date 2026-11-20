// Egresos (window.Egresos): todo el dinero que sale, separado por lo que es.
//   Gasto: se fue de la empresa (lleva categoría y a quién se le carga). Traspaso: solo cambió de cuenta.
//   Préstamo: alguien lo debe regresar. Devolución: solo lo importado (en la captura va por Ventas).
// Pantallas del menú: Registrar egreso · Gastos · Otros egresos · Categorías. "Sale de" es la caja o cuenta de donde
// salió el dinero; "Se carga a" es la sucursal (o Dirección) a la que le toca el gasto.
(function () {
  var esc = BMA.esc, $ = function (id) { return document.getElementById(id); };
  var TIPOS = [{valor: 'gasto', nombre: 'Gasto'}, {valor: 'traspaso', nombre: 'Traspaso'}, {valor: 'prestamo', nombre: 'Préstamo'}];
  var NOMBRE_TIPO = {gasto: 'Gasto', traspaso: 'Traspaso', prestamo: 'Préstamo', devolucion: 'Devolución'};
  var PIDE = [{valor: '', nombre: 'Nada más'}, {valor: 'empleado', nombre: 'El empleado'}, {valor: 'vendedor', nombre: 'El vendedor'},
              {valor: 'venta', nombre: 'La venta (remisión)'}];
  var OTROS = [{valor: 'traspaso', nombre: 'Traspasos'}, {valor: 'prestamo', nombre: 'Préstamos'},
               {valor: 'devolucion', nombre: 'Devoluciones'}, {valor: 'aclarar', nombre: 'Por aclarar'}];
  var LIMITE = 200, CLAVE_CUENTA = 'bma.egresos.cuenta.v1';
  var cat = null;                           // catálogos: {categorias, cuentas, areas}
  var vista = 'registrar';                  // registrar | gastos | otros | categorias
  var lst = {gastos: {q: '', sucursal: null, categoria: null, ver: 'todos'}, otros: {q: '', sucursal: null, ver: 'traspaso'}};
  var ficha = null, st = null, tiempo = null, combo = null, verCats = 'activas';

  function cont() { return $('mod-egresos'); }
  function esAdmin() { return window.SESION && SESION.rol === 'admin'; }
  function catalogos(forzar) {
    if (cat && !forzar) return Promise.resolve(cat);
    return UI.llamar('bma_egresos_catalogos').then(function (c) { cat = c; return c; });
  }
  function cuenta(clave) { return (cat.cuentas.filter(function (c) { return c.clave === clave; })[0]) || null; }
  function categoria(id) { return (cat.categorias.filter(function (c) { return c.id === id; })[0]) || null; }
  function area(clave) { var a = cat.areas.filter(function (x) { return x.valor === clave; })[0]; return a ? a.nombre : clave; }
  function ultimaCuenta() { try { return localStorage.getItem(CLAVE_CUENTA); } catch (e) { return null; } }
  function recordarCuenta(c) { try { localStorage.setItem(CLAVE_CUENTA, c); } catch (e) {} }

  // ---------------------------------------------------------------- Entrar desde el menú
  function abrir(id, seguir) {
    var v = {'eg-nuevo': 'registrar', 'eg-gastos': 'gastos', 'eg-otros': 'otros', 'eg-categorias': 'categorias'}[id] || 'gastos';
    if (!seguir || v !== vista) ficha = null;
    if (v === 'registrar' && (!seguir || !st)) st = limpio();
    vista = v;
    catalogos().then(pintar).catch(function () {});
  }
  function pintar() {
    if (!cat) { catalogos().then(pintar).catch(function () {}); return; }
    if (ficha) return pintarFicha(ficha);
    if (vista === 'registrar') return pintarRegistro();
    if (vista === 'categorias') return pintarCategorias();
    pintarLista();
  }

  // ---------------------------------------------------------------- Registrar (y corregir)
  function limpio(base) {
    return base || {tipo: null, fecha: BMA.hoy(), sale_de: ultimaCuenta(), carga_a: null, mas: false};
  }
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
  function escoger(id, texto, vacio) {
    return '<button type="button" class="escoger' + (texto ? '' : ' vacio') + '" id="' + id + '"><span>' + esc(texto || vacio) +
      '</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>';
  }
  function catsActivas() { return cat.categorias.filter(function (c) { return c.activa || (st && c.id === st.categoria_id); }); }

  function pintarRegistro() {
    var n = 1, h = '<div class="registro">', editando = !!st.id;
    if (editando) h += '<div class="ficha-top"><button class="volver" id="e-cancelar">‹ Volver al egreso</button></div>';
    if (st.tipo === 'devolucion') h += paso(n++, 'Es una devolución a un cliente', '<p class="vacio">Las devoluciones nuevas se registran desde la venta.</p>');
    else h += paso(n++, '¿Qué salió?', chips('tipo', TIPOS, st.tipo));
    if (st.tipo === 'gasto') {
      var c = categoria(st.categoria_id);
      h += paso(n++, 'Categoría', chips('categoria_id', catsActivas().map(function (x) { return {valor: x.id, nombre: x.nombre}; }), st.categoria_id) +
        '<button type="button" class="mas" id="e-cat-nueva">+ Nueva categoría</button>');
      if (c && (c.pide === 'empleado' || c.pide === 'vendedor')) h += paso(n++, c.pide === 'empleado' ? '¿A quién se le pagó?' : '¿Qué vendedor?', '<div id="e-persona"></div>');
      if (c && c.pide === 'venta') h += paso(n++, '¿De qué venta?', st.venta
        ? '<div class="elegida"><div><b>' + esc(st.venta.producto) + '</b><div class="sec">' + esc(st.venta.folio) + (st.venta.remision ? ' · rem. ' + esc(st.venta.remision) : '') +
          '</div></div><button type="button" class="btn" id="e-venta">Cambiar</button></div>'
        : '<button type="button" class="btn" id="e-venta">Buscar la venta</button>', true);
      h += paso(n++, 'Concepto', campo('e-concepto', st.concepto, {ph: 'p. ej. Gasolina, papel, grúa'}), c && (c.pide === 'empleado' || c.pide === 'vendedor'));
    }
    if (st.tipo === 'prestamo') h += paso(n++, '¿A quién se le prestó?', '<div id="e-persona"></div>');
    if (st.tipo) {
      var sale = cuenta(st.sale_de);
      h += paso(n++, '¿Cuánto y de dónde salió?', '<div class="fila2"><label class="lbl">Monto<span class="monto-in">$' +
        campo('e-monto', st.monto, {num: true, ph: '0.00'}) + '</span></label><div class="lbl">Sale de' +
        escoger('e-sale', sale && sale.nombre, 'Escoge la caja o cuenta') + '</div></div>');
      if (st.tipo === 'traspaso') {
        var entra = cuenta(st.entra_a);
        h += paso(n++, '¿A dónde llegó?', escoger('e-entra', entra && entra.nombre, 'Escoge la cuenta'));
      }
      if (st.tipo === 'gasto') {
        var auto = sale && sale.sucursal, carga = st.carga_a || auto;
        h += paso(n++, 'Se carga a', escoger('e-carga', carga && area(carga), 'Escoge la sucursal o Dirección') +
          (carga && auto && carga !== auto ? '<p class="nota-paso">Salió de la caja de ' + esc(area(auto)) + ', pero el gasto es de ' + esc(area(carga)) + '.</p>' : ''));
      }
      h += paso(n++, 'Fecha', campo('e-fecha', st.fecha, {tipo: 'date', max: BMA.hoy()}));
      h += '<button type="button" class="mas" id="e-mas">' + (st.mas ? 'Menos datos' : 'Más datos: quién lo autorizó, nota') + '</button>';
      if (st.mas) h += paso(n++, 'Más datos', '<div class="lbl">¿Lo autorizó HEBQ?</div>' +
        chips('autorizo', [{valor: '', nombre: 'No'}, {valor: 'HEBQ', nombre: 'Sí, HEBQ'}], st.autorizo || '') +
        '<label class="lbl">Nota<span>' + campo('e-nota', st.nota) + '</span></label>', true);
      h += '<div class="guardar"><p class="resumen" id="e-resumen"></p><p class="error" id="e-falta" hidden></p><div class="acciones">' +
        (editando ? '' : '<button type="button" class="btn" id="e-limpiar">Empezar de nuevo</button>') +
        '<button type="button" class="btn primario" id="e-guardar">' + (editando ? 'Guardar cambios' : 'Guardar') + '</button></div></div>';
    }
    cont().innerHTML = h + '</div>';
    conectarRegistro();
    resumen();
  }

  function conectarRegistro() {
    var raiz = cont();
    raiz.onclick = function (ev) {
      var b = ev.target.closest('[data-grupo]');
      if (b) {
        leer();
        var g = b.dataset.grupo, val = b.dataset.valor;
        if (g === 'tipo' && val !== st.tipo) { st.tipo = val; st.persona = null; st.venta = null; }
        else if (g === 'categoria_id' && val !== st.categoria_id) { st.categoria_id = val; st.persona = null; st.venta = null; }
        else st[g] = val;
        pintarRegistro(); return;
      }
      var id = ev.target.closest('button') && ev.target.closest('button').id;
      if (id === 'e-mas') { leer(); st.mas = !st.mas; pintarRegistro(); }
      else if (id === 'e-limpiar') { st = limpio(); pintarRegistro(); }
      else if (id === 'e-cancelar') { var f = st.id; st = limpio(); ficha = f; pintar(); }
      else if (id === 'e-guardar') guardar();
      else if (id === 'e-sale') { leer(); escogerCuenta('¿De dónde salió el dinero?', st.sale_de).then(function (c) { if (c) { st.sale_de = c; pintarRegistro(); } }); }
      else if (id === 'e-entra') { leer(); escogerCuenta('¿A dónde llegó?', st.entra_a, st.sale_de).then(function (c) { if (c) { st.entra_a = c; pintarRegistro(); } }); }
      else if (id === 'e-carga') {
        leer();
        UI.abrirLista({titulo: 'Se carga a', elegido: st.carga_a || (cuenta(st.sale_de) || {}).sucursal, grupos: [{opciones: cat.areas}]})
          .then(function (v) { if (v) { st.carga_a = v; pintarRegistro(); } });
      }
      else if (id === 'e-venta') { leer(); Ventas.buscarVenta('¿De qué venta es la garantía?').then(function (vid) {
        if (!vid) return;
        UI.llamar('bma_venta', {p_id: vid}).then(function (r) { st.venta = r.venta; pintarRegistro(); });
      }); }
      else if (id === 'e-cat-nueva') { leer(); nuevaCategoria().then(function (cid) { if (cid) { st.categoria_id = cid; pintarRegistro(); } }); }
    };
    raiz.oninput = function () { leer(); resumen(); };
    var cp = $('e-persona');
    if (cp) {
      var c = categoria(st.categoria_id);
      var rol = st.tipo === 'prestamo' ? 'empleado' : (c && c.pide) || 'empleado';
      combo = UI.combo(cp, {tipo: rol, placeholder: rol === 'vendedor' ? 'Escribe el nombre del vendedor' : 'Escribe el nombre',
        valor: st.persona, alCambiar: function (p) { st.persona = p; resumen(); }});
    }
  }

  function escogerCuenta(titulo, elegida, quitar) {
    var grupos = [['caja', 'Cajas'], ['subcuenta', 'Subcuentas'], ['banco', 'Bancos'], ['otra', 'Otras']].map(function (g) {
      return {titulo: g[1], opciones: cat.cuentas.filter(function (c) { return c.tipo === g[0] && c.clave !== quitar; })
        .map(function (c) { return {valor: c.clave, nombre: c.nombre}; })};
    }).filter(function (g) { return g.opciones.length; });
    grupos.push({opciones: [{valor: '__nueva', nombre: '+ Agregar otra cuenta'}]});
    return UI.abrirLista({titulo: titulo, elegido: elegida, buscar: true, grupos: grupos}).then(function (v) {
      if (v !== '__nueva') return v;
      return UI.pedirTexto({titulo: 'Cuenta nueva', ayuda: 'Nombre del banco o de la cuenta', boton: 'Agregar'}).then(function (n) {
        if (!n) return null;
        return UI.guardar('bma_cuenta_nueva', {p_nombre: n, p_tipo: 'banco', p_sucursal: null}).then(function (clave) {
          return clave ? catalogos(true).then(function () { return clave; }) : null;
        });
      });
    });
  }

  function leer() {
    var v = function (id) { var e = $(id); return e ? e.value.trim() : undefined; };
    if (v('e-monto') !== undefined) { var m = v('e-monto').replace(/[$,\s]/g, ''); st.monto = m === '' ? null : Number(m); }
    if (v('e-concepto') !== undefined) st.concepto = v('e-concepto');
    if (v('e-fecha') !== undefined) st.fecha = v('e-fecha');
    if (v('e-nota') !== undefined) st.nota = v('e-nota');
  }

  function falta() {
    if (!st.tipo) return 'Falta qué salió';
    var c = categoria(st.categoria_id);
    if (st.tipo === 'gasto') {
      if (!c) return 'Falta la categoría';
      if ((c.pide === 'empleado' || c.pide === 'vendedor') && !st.persona) return 'Falta la persona';
      if (!st.concepto && !st.persona) return 'Falta el concepto';
    }
    if (st.tipo === 'prestamo' && !st.persona) return 'Falta a quién se le prestó';
    if (!(st.monto > 0)) return 'Falta el monto';
    if (!st.sale_de) return 'Falta de dónde salió';
    if (st.tipo === 'traspaso' && !st.entra_a) return 'Falta a dónde llegó';
    if (!st.fecha) return 'Falta la fecha';
    if (st.fecha > BMA.hoy()) return 'La fecha no puede ser futura';
    return null;
  }

  function resumen() {
    var r = $('e-resumen'); if (!r) return;
    if (!st.tipo || !(st.monto > 0)) { r.textContent = ''; return; }
    var c = categoria(st.categoria_id), sale = cuenta(st.sale_de), entra = cuenta(st.entra_a);
    var t = NOMBRE_TIPO[st.tipo] + ' de ' + BMA.dinero(st.monto);
    if (st.tipo === 'gasto' && c) t += ' en ' + c.nombre.toLowerCase();
    if (st.persona) t += (st.tipo === 'prestamo' ? ' a ' : ' · ') + st.persona.nombre;
    if (st.concepto) t += ' · ' + st.concepto;
    if (sale) t += ' · sale de ' + sale.nombre;
    if (entra && st.tipo === 'traspaso') t += ' a ' + entra.nombre;
    var carga = st.carga_a || (sale && sale.sucursal);
    if (st.tipo === 'gasto' && carga && sale && carga !== sale.sucursal) t += ' · se carga a ' + area(carga);
    r.textContent = t + (st.fecha ? ', ' + BMA.fecha(st.fecha) : '');
  }

  function guardar() {
    leer();
    var f = falta(), aviso = $('e-falta');
    if (f) { aviso.textContent = f; aviso.hidden = false; return; }
    aviso.hidden = true;
    var p = {tipo: st.tipo, monto: st.monto, fecha: st.fecha, sale_de: st.sale_de, entra_a: st.entra_a || null,
             carga_a: st.tipo === 'gasto' ? (st.carga_a || null) : null, categoria_id: st.tipo === 'gasto' ? st.categoria_id : null,
             concepto: st.concepto || null, persona_id: st.persona ? st.persona.id : null,
             venta_id: st.venta ? st.venta.id : null, autorizo: st.autorizo || null, nota: st.nota || null};
    if (st.id) p.id = st.id;
    $('e-guardar').disabled = true;
    UI.guardar('bma_egreso_guardar', {p: p}).then(function (id) {
      if (!id) { $('e-guardar').disabled = false; return; }
      recordarCuenta(st.sale_de);
      UI.aviso(st.id ? 'Cambios guardados' : 'Guardado');
      var tipo = st.tipo;
      st = limpio();
      ficha = id;
      vista = tipo === 'gasto' ? 'gastos' : 'otros';
      if (tipo !== 'gasto') lst.otros.ver = tipo;
      ir(vista === 'gastos' ? 'eg-gastos' : 'eg-otros', {seguir: true});
    }).catch(function () { if ($('e-guardar')) $('e-guardar').disabled = false; });
  }

  // ---------------------------------------------------------------- Listas: Gastos y Otros egresos
  function pintarLista() {
    var L = lst[vista], esGastos = vista === 'gastos';
    var catSel = L.categoria && categoria(L.categoria);
    cont().innerHTML = '<div class="barra"><input class="campo-buscar" id="l-q" type="search" placeholder="Buscar concepto, persona o cuenta" aria-label="Buscar">' +
      UI.filtro('l-suc', 'Sucursal', L.sucursal ? area(L.sucursal) : 'Todas') +
      (esGastos ? UI.filtro('l-cat', 'Categoría', catSel ? catSel.nombre : 'Todas') : '') +
      '<button class="btn primario" id="l-nuevo">Registrar egreso</button></div>' +
      (esGastos ? UI.seg('l-ver', [{valor: 'todos', nombre: 'Todos'}, {valor: 'aclarar', nombre: 'Por aclarar'}], L.ver) : UI.seg('l-ver', OTROS, L.ver)) +
      '<div class="totales-eg" id="l-tot"></div><div id="l-lista" class="renglones"><p class="vacio">Cargando…</p></div>';
    var q = $('l-q'); q.value = L.q;
    q.oninput = function () { clearTimeout(tiempo); tiempo = setTimeout(function () { L.q = q.value; listar(); }, 300); };
    $('l-suc').onclick = function () {
      UI.abrirLista({titulo: 'Sucursal', elegido: L.sucursal || '', grupos: [{opciones: [{valor: '', nombre: 'Todas'}].concat(cat.areas)}]})
        .then(function (v) { if (v === null || v === undefined) return; L.sucursal = v || null; pintarLista(); });
    };
    if ($('l-cat')) $('l-cat').onclick = function () {
      UI.abrirLista({titulo: 'Categoría', elegido: L.categoria || '', grupos: [{opciones: [{valor: '', nombre: 'Todas'}].concat(
        cat.categorias.map(function (c) { return {valor: c.id, nombre: c.nombre}; }))}]})
        .then(function (v) { if (v === null || v === undefined) return; L.categoria = v || null; pintarLista(); });
    };
    $('l-ver').onclick = function (ev) {
      var b = ev.target.closest('[data-valor]'); if (!b || b.dataset.valor === L.ver) return;
      L.ver = b.dataset.valor; pintarLista();
    };
    $('l-nuevo').onclick = function () { ir('eg-nuevo'); };
    listar();
  }

  function listar() {
    var L = lst[vista], esGastos = vista === 'gastos', pedida = vista + JSON.stringify(L);
    var tipos = esGastos ? 'gasto' : (L.ver === 'aclarar' ? 'traspaso,prestamo,devolucion' : L.ver);
    UI.llamar('bma_egresos_buscar', {p_tipos: tipos, p_q: L.q, p_sucursal: L.sucursal, p_categoria: esGastos ? L.categoria : null,
      p_aclarar: L.ver === 'aclarar', p_limite: LIMITE}).then(function (r) {
      var el = $('l-lista');
      if (!el || pedida !== vista + JSON.stringify(lst[vista])) return;
      $('l-tot').innerHTML = '<span><b class="num">' + BMA.dinero(r.total) + '</b> en ' + r.cuantos + ' renglón' + (r.cuantos === 1 ? '' : 'es') + '</span>' +
        (r.por_aclarar && L.ver !== 'aclarar' ? '<span class="aclarar-n">' + r.por_aclarar + ' por aclarar</span>' : '');
      if (!r.filas.length) { el.innerHTML = '<p class="vacio">' + (L.q ? 'No encontré nada con «' + esc(L.q) + '».' : 'No hay nada aquí.') + '</p>'; return; }
      var sem = null, h = '';
      r.filas.forEach(function (e) {
        if (e.lunes !== sem) { sem = e.lunes; h += '<div class="semana">Semana del ' + BMA.fecha(e.lunes) + '</div>'; }
        h += renglon(e);
      });
      if (r.cuantos > r.filas.length) h += '<p class="mas-res">Se muestran los ' + r.filas.length + ' más recientes de ' + r.cuantos + '. Escribe algo o escoge una sucursal para afinar.</p>';
      el.innerHTML = h;
      el.onclick = function (ev) { var b = ev.target.closest('[data-id]'); if (b) { ficha = b.dataset.id; pintar(); window.scrollTo(0, 0); } };
    }).catch(function () {});
  }

  function renglon(e) {
    var prin = e.tipo === 'traspaso' ? (e.sale_nombre + ' → ' + (e.entra_nombre || '')) : (e.persona || e.concepto || e.categoria || NOMBRE_TIPO[e.tipo]);
    var sec = [];
    if (e.tipo === 'gasto') sec.push(e.categoria || 'Sin categoría');
    if (e.tipo === 'gasto' && e.persona && e.concepto && BMA.esc(e.concepto) !== BMA.esc(e.persona)) sec.push(e.concepto);
    if (e.tipo === 'traspaso' && e.concepto) sec.push(e.concepto);
    if (e.tipo !== 'traspaso') sec.push('sale de ' + e.sale_nombre);
    if (e.tipo === 'gasto' && e.carga_a && e.carga_a !== e.sale_suc) sec.push('se carga a ' + (e.carga_a === 'DIR' ? 'Dirección' : area(e.carga_a)));
    if (e.venta_folio) sec.push(e.venta_folio);
    return '<button class="renglon" data-id="' + esc(e.id) + '"><span class="prin">' + esc(prin) + '</span>' +
      '<span class="der num">' + BMA.dinero(e.monto) + '</span><span class="sec">' + esc(sec.join(' · ')) + '</span>' +
      '<span class="sec der">' + (e.autorizo ? '<span class="chip-estado">' + esc(e.autorizo) + '</span> ' : '') +
      (e.por_aclarar ? '<span class="chip-estado abierta">Por aclarar</span>' : '') + '</span></button>';
  }

  // ---------------------------------------------------------------- Ficha
  function pintarFicha(id) {
    UI.llamar('bma_egreso', {p_id: id}).then(function (r) {
      var e = r.egreso, volver = e.tipo === 'gasto' ? 'Gastos' : 'Otros egresos';
      var datos = [['Tipo', NOMBRE_TIPO[e.tipo]], ['Categoría', e.categoria], ['Persona', e.persona && e.persona.nombre],
        ['Concepto', e.concepto], ['Sale de', e.sale_nombre], ['Entra a', e.entra_nombre], ['Se carga a', e.carga_nombre],
        ['Venta', e.venta && (e.venta.folio + ' · ' + e.venta.producto)], ['Fecha', BMA.fecha(e.fecha)],
        ['Semana', 'del ' + BMA.fecha(e.lunes)], ['Autorizó', e.autorizo], ['Nota', e.nota]]
        .filter(function (d) { return d[1]; });
      var ref = e.origen_ref ? 'Viene del Excel de Silvia: ' + e.origen_ref.hoja + ', renglón ' + e.origen_ref.fila : 'Capturado en la app';
      cont().innerHTML = '<div class="ficha-top"><button class="volver" id="f-volver">‹ ' + volver + '</button></div><div class="ficha">' +
        (e.por_aclarar ? '<div class="aviso-duda">Por aclarar. Corrígelo con los datos correctos y deja de estar por aclarar.</div>' : '') +
        '<h2 class="num">' + BMA.dinero(e.monto) + '</h2><div class="sub">' + esc(ref) + '</div>' +
        '<div class="datos">' + datos.map(function (d) { return '<div class="dato"><span class="e">' + esc(d[0]) + '</span><span class="v">' + esc(d[1]) + '</span></div>'; }).join('') + '</div>' +
        '<div class="btn-fila"><button class="btn primario" id="f-editar">' + (e.por_aclarar ? 'Aclarar' : 'Corregir') + '</button>' +
        (esAdmin() ? '<button class="btn" id="f-eliminar">Eliminar</button>' : '') + '</div>' +
        (r.cambios.length ? '<div class="seccion">Cambios</div>' + r.cambios.map(function (c) {
          return '<div class="cambio">' + esc(c.accion === 'alta' ? 'Se registró' : c.accion === 'baja' ? 'Se eliminó' : 'Se corrigió') +
            ' <span class="q">· ' + esc(c.quien || '') + ', ' + BMA.fecha(String(c.fecha).slice(0, 10)) + '</span></div>';
        }).join('') : '') + '</div>';
      $('f-volver').onclick = function () { ficha = null; pintar(); };
      $('f-editar').onclick = function () { editar(e); };
      if ($('f-eliminar')) $('f-eliminar').onclick = function () {
        UI.confirmar({titulo: 'Eliminar este egreso', ayuda: 'Queda guardado en la bitácora.', si: 'Eliminar'}).then(function (ok) {
          if (!ok) return;
          UI.guardar('bma_egreso_eliminar', {p_id: e.id}).then(function (ok) { if (!ok) return; UI.aviso('Eliminado'); ficha = null; pintar(); }).catch(function () {});
        });
      };
    }).catch(function () { ficha = null; });
  }

  function editar(e) {
    st = {id: e.id, tipo: e.tipo, monto: Number(e.monto), fecha: e.fecha, sale_de: e.sale_de, entra_a: e.entra_a, carga_a: e.carga_a,
          categoria_id: e.categoria_id, concepto: e.concepto, persona: e.persona, venta: e.venta, autorizo: e.autorizo, nota: e.nota,
          mas: !!(e.autorizo || e.nota)};
    if (st.sale_de === 'por-aclarar') st.sale_de = null;
    if (st.entra_a === 'por-aclarar') st.entra_a = null;
    ficha = null;
    pintarRegistro();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- Categorías
  function nuevaCategoria() {
    var nombre;
    return UI.pedirTexto({titulo: 'Nueva categoría', ayuda: 'Nombre de la categoría de gasto', boton: 'Siguiente'}).then(function (n) {
      if (!n) return null; nombre = n;
      return UI.abrirLista({titulo: '¿Qué más pide?', grupos: [{opciones: PIDE}]});
    }).then(function (pide) {
      if (pide === null || pide === undefined) return null;
      return UI.guardar('bma_categoria_guardar', {p: {nombre: nombre, pide: pide || null}});
    }).then(function (id) { return id ? catalogos(true).then(function () { return id; }) : null; });
  }

  function pintarCategorias() {
    var lista = cat.categorias.filter(function (c) { return verCats === 'activas' ? c.activa : !c.activa; });
    var pide = {empleado: 'Pide el empleado', vendedor: 'Pide el vendedor', venta: 'Pide la venta'};
    cont().innerHTML = '<div class="barra"><div class="relleno"></div><button class="btn primario" id="c-nueva">Nueva categoría</button></div>' +
      UI.seg('c-ver', [{valor: 'activas', nombre: 'En uso'}, {valor: 'quitadas', nombre: 'Quitadas'}], verCats) +
      '<div class="renglones">' + (lista.length ? lista.map(function (c) {
        return '<div class="renglon cat-fila"><span class="prin">' + esc(c.nombre) + '</span>' +
          '<span class="der"><button class="btn-chico" data-renombrar="' + esc(c.id) + '">Cambiar nombre</button>' +
          '<button class="btn-chico" data-quitar="' + esc(c.id) + '">' + (c.activa ? 'Quitar' : 'Volver a poner') + '</button></span>' +
          '<span class="sec">' + esc([pide[c.pide], c.usos + ' gasto' + (c.usos === 1 ? '' : 's')].filter(Boolean).join(' · ')) + '</span></div>';
      }).join('') : '<p class="vacio">' + (verCats === 'activas' ? 'No hay categorías.' : 'No hay categorías quitadas.') + '</p>') + '</div>';
    $('c-nueva').onclick = function () { nuevaCategoria().then(function (id) { if (id) pintarCategorias(); }); };
    $('c-ver').onclick = function (ev) { var b = ev.target.closest('[data-valor]'); if (b && b.dataset.valor !== verCats) { verCats = b.dataset.valor; pintarCategorias(); } };
    cont().querySelector('.renglones').onclick = function (ev) {
      var b = ev.target.closest('[data-renombrar]');
      if (b) {
        var c = categoria(b.dataset.renombrar);
        UI.pedirTexto({titulo: 'Cambiar nombre', ayuda: c.nombre, boton: 'Guardar'}).then(function (n) {
          if (!n) return null;
          return UI.guardar('bma_categoria_guardar', {p: {id: c.id, nombre: n}});
        }).then(function (ok) { if (ok) catalogos(true).then(pintarCategorias); }).catch(function () {});
        return;
      }
      b = ev.target.closest('[data-quitar]');
      if (b) {
        var k = categoria(b.dataset.quitar);
        UI.guardar('bma_categoria_quitar', {p_id: k.id, p_quitar: k.activa}).then(function (r) {
          if (r) catalogos(true).then(pintarCategorias);
        }).catch(function () {});
      }
    };
  }

  window.Egresos = {abrir: abrir, pintar: pintar};
})();
