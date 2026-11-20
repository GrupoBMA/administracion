// Utilidades de pantalla para Ventas, Personas y Dudas (window.UI). Adaptadas de Logística/inventario.js.
// Nada de <select>: toda elección abre la "lista para escoger" en una hoja.
(function () {
  var esc = BMA.esc, fin = null, regresando = false;
  function q(s, el) { return (el || document).querySelector(s); }
  function hojaEl() {
    var h = document.getElementById('hoja');
    if (!h) { h = document.createElement('div'); h.id = 'hoja'; h.className = 'hoja'; h.hidden = true; document.body.appendChild(h); }
    return h;
  }
  function abrirHoja(html, alTerminar) {
    var h = hojaEl();
    h.innerHTML = '<div class="hoja-fondo" data-hoja-cerrar></div><div class="hoja-caja" role="dialog" aria-modal="true">' + html + '</div>';
    fin = alTerminar; h.hidden = false; document.documentElement.classList.add('hoja-on');
    history.pushState(Object.assign({}, history.state, {bmaHoja: true}), '');
    requestAnimationFrame(function () {
      h.classList.add('abierta');
      var s = q('.h-op.sel', h) || q('input,textarea', h) || q('.h-op', h) || q('[data-si]', h);
      if (s) { s.focus({preventScroll: true}); if (s.classList.contains('sel')) s.scrollIntoView({block: 'center'}); }
    });
  }
  function cerrarHoja(valor, desdeHistorial) {
    if (!fin) return;
    var f = fin; fin = null;
    var h = hojaEl(); h.classList.remove('abierta'); document.documentElement.classList.remove('hoja-on');
    if (!desdeHistorial && history.state && history.state.bmaHoja) { regresando = true; history.back(); }
    setTimeout(function () { if (!fin) { h.hidden = true; h.innerHTML = ''; } }, 200);
    f(valor);
  }
  window.addEventListener('popstate', function () {
    if (regresando) { regresando = false; return; }
    if (fin) cerrarHoja(null, true);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && fin) { e.stopPropagation(); cerrarHoja(null); } }, true);

  function cab(titulo, ayuda) {
    return '<div class="hoja-cab"><b>' + esc(titulo) + '</b>' + (ayuda ? '<span>' + esc(ayuda) + '</span>' : '') +
      '<button type="button" class="hoja-x" data-hoja-cerrar aria-label="Cerrar">✕</button></div>';
  }
  function botones(si) {
    return '<div class="acciones"><button type="button" class="btn" data-hoja-cerrar>Cancelar</button>' +
      '<button type="submit" class="btn primario">' + esc(si || 'Listo') + '</button></div>';
  }

  // abrirLista({titulo, ayuda, grupos:[{titulo, opciones:[{valor, nombre, detalle, n}]}], elegido, buscar}) -> Promise(valor|null)
  function abrirLista(o) {
    return new Promise(function (res) {
      var vals = [], html = '';
      (o.grupos || []).forEach(function (g) {
        var filas = (g.opciones || []).map(function (op) {
          var i = vals.push(op.valor) - 1;
          return '<button type="button" class="h-op' + (op.valor === o.elegido ? ' sel' : '') + '" data-i="' + i + '" data-t="' +
            esc((op.nombre + ' ' + (op.detalle || '')).toLowerCase()) + '"><span class="h-nom">' + esc(op.nombre) +
            (op.detalle ? '<small>' + esc(op.detalle) + '</small>' : '') + '</span>' +
            (op.n != null && op.n !== '' ? '<span class="h-n num">' + esc(op.n) + '</span>' : '') + '</button>';
        }).join('');
        if (filas) html += '<div class="h-grupo">' + (g.titulo ? '<div class="h-tit-grupo">' + esc(g.titulo) + '</div>' : '') + filas + '</div>';
      });
      abrirHoja(cab(o.titulo, o.ayuda) + (o.buscar ? '<div class="hoja-buscar"><input type="search" placeholder="Buscar" aria-label="Buscar"></div>' : '') +
        '<div class="hoja-lista">' + (html || '<p class="vacio">Nada que escoger.</p>') + '</div>', res);
      var h = hojaEl();
      h.onclick = function (e) {
        if (e.target.closest('[data-hoja-cerrar]')) { cerrarHoja(null); return; }
        var b = e.target.closest('[data-i]'); if (b) cerrarHoja(vals[+b.dataset.i]);
      };
      var bus = q('.hoja-buscar input', h);
      if (bus) bus.oninput = function () {
        var t = bus.value.trim().toLowerCase();
        h.querySelectorAll('.h-op').forEach(function (b) { b.hidden = t && b.dataset.t.indexOf(t) < 0; });
      };
    });
  }

  // escogerVarios({titulo, opciones:[{valor, nombre}], elegidos, falta}) -> Promise([valores]|null)
  function escogerVarios(o) {
    return new Promise(function (res) {
      var sel = (o.elegidos || []).slice();
      var filas = o.opciones.map(function (op, i) {
        return '<button type="button" class="h-op h-check' + (sel.indexOf(op.valor) >= 0 ? ' sel' : '') + '" data-i="' + i +
          '" aria-pressed="' + (sel.indexOf(op.valor) >= 0) + '"><span class="h-casilla"></span><span class="h-nom">' + esc(op.nombre) + '</span></button>';
      }).join('');
      abrirHoja(cab(o.titulo, o.ayuda) + '<form class="hoja-cuerpo" novalidate><div class="hoja-lista suelta">' + filas +
        '</div><p class="error" hidden></p>' + botones(o.boton) + '</form>', res);
      var h = hojaEl(), f = q('form', h);
      h.onclick = function (e) {
        if (e.target.closest('[data-hoja-cerrar]')) { cerrarHoja(null); return; }
        var b = e.target.closest('[data-i]'); if (!b) return;
        var v = o.opciones[+b.dataset.i].valor, k = sel.indexOf(v);
        if (k >= 0) sel.splice(k, 1); else sel.push(v);
        b.classList.toggle('sel', k < 0); b.setAttribute('aria-pressed', k < 0);
      };
      f.onsubmit = function (e) {
        e.preventDefault();
        if (!sel.length) { var er = q('.error', f); er.textContent = o.falta || 'Escoge al menos una.'; er.hidden = false; return; }
        cerrarHoja(sel);
      };
    });
  }

  // pedirTexto({titulo, ayuda, valor, tipo:'text'|'date'|'largo', placeholder, opcional, boton}) -> Promise(texto|null)
  // Si es opcional y queda vacío regresa '' (borrar); cancelar regresa null.
  function pedirTexto(o) {
    return new Promise(function (res) {
      var campo = o.tipo === 'largo' ? '<textarea name="t" maxlength="500" rows="3"></textarea>'
        : '<input name="t" type="' + (o.tipo === 'date' ? 'date' : 'text') + '" maxlength="160" autocomplete="off"' +
          (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.max ? ' max="' + esc(o.max) + '"' : '') + '>';
      abrirHoja(cab(o.titulo, o.ayuda) + '<form class="hoja-cuerpo" novalidate>' + campo + '<p class="error" hidden></p>' + botones(o.boton) + '</form>', res);
      var h = hojaEl(), f = q('form', h), t = f.elements.t;
      t.value = o.valor || '';
      h.onclick = function (e) { if (e.target.closest('[data-hoja-cerrar]')) cerrarHoja(null); };
      f.onsubmit = function (e) {
        e.preventDefault();
        var v = t.value.trim();
        if (!v && !o.opcional) { var er = q('.error', f); er.textContent = o.falta || 'Escribe algo para continuar.'; er.hidden = false; t.focus(); return; }
        cerrarHoja(v);
      };
    });
  }

  // pedirMonto({titulo, valor, opcional}) -> Promise(número|'' |null). '' = borrar (si es opcional).
  function pedirMonto(o) {
    return new Promise(function (res) {
      abrirHoja(cab(o.titulo, o.ayuda) + '<form class="hoja-cuerpo" novalidate><div class="monto"><span>$</span>' +
        '<input name="t" inputmode="decimal" autocomplete="off" placeholder="0.00"></div><p class="error" hidden></p>' + botones(o.boton) + '</form>', res);
      var h = hojaEl(), f = q('form', h), t = f.elements.t;
      t.value = o.valor != null && o.valor !== '' ? String(o.valor) : '';
      h.onclick = function (e) { if (e.target.closest('[data-hoja-cerrar]')) cerrarHoja(null); };
      f.onsubmit = function (e) {
        e.preventDefault();
        var txt = t.value.replace(/[$,\s]/g, ''), er = q('.error', f);
        if (!txt && o.opcional) { cerrarHoja(''); return; }
        var n = Number(txt);
        if (!txt || !isFinite(n) || n <= 0) { er.textContent = 'Escribe un monto mayor que cero.'; er.hidden = false; t.focus(); return; }
        cerrarHoja(Math.round(n * 100) / 100);
      };
    });
  }

  // confirmar({titulo, ayuda, si, no}) -> Promise(bool)
  function confirmar(o) {
    return new Promise(function (res) {
      abrirHoja(cab(o.titulo, o.ayuda) + '<div class="hoja-cuerpo"><div class="acciones">' +
        '<button type="button" class="btn" data-hoja-cerrar>' + esc(o.no || 'Cancelar') + '</button>' +
        '<button type="button" class="btn primario" data-si>' + esc(o.si || 'Sí') + '</button></div></div>', function (v) { res(!!v); });
      hojaEl().onclick = function (e) {
        if (e.target.closest('[data-si]')) { cerrarHoja(true); return; }
        if (e.target.closest('[data-hoja-cerrar]')) cerrarHoja(false);
      };
    });
  }

  // Aviso breve arriba de la pantalla
  var tAviso = null;
  function aviso(msg, error) {
    var a = document.getElementById('bma-aviso');
    if (!a) { a = document.createElement('div'); a.id = 'bma-aviso'; a.setAttribute('role', 'status'); document.body.appendChild(a); }
    a.textContent = msg; a.className = 'bma-aviso on' + (error ? ' error' : '');
    clearTimeout(tAviso); tAviso = setTimeout(function () { a.className = 'bma-aviso'; }, error ? 6000 : 2600);
  }

  // Llama una función bma_* de Supabase. Una cuenta sin acceso sale de la sesión; otro error se avisa y se lanza.
  function llamar(nombre, args) {
    return sb.rpc(nombre, args || {}).then(function (r) {
      if (r.error) {
        var m = r.error.message || 'No se pudo completar.';
        if (/Esta cuenta no tiene acceso/.test(m)) { salir(); }
        aviso(m, true);
        throw new Error(m);
      }
      return r.data;
    });
  }

  // Igual que llamar, pero en la copia local pide confirmar: no hay base de pruebas.
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  function guardar(nombre, args) {
    var paso = LOCAL ? confirmar({titulo: 'Esto guarda en la base real', ayuda: 'Estás en la copia local de la app.', si: 'Guardar'})
                     : Promise.resolve(true);
    return paso.then(function (ok) { return ok ? llamar(nombre, args) : null; });
  }

  window.UI = {abrirLista: abrirLista, escogerVarios: escogerVarios, pedirTexto: pedirTexto, pedirMonto: pedirMonto,
               confirmar: confirmar, aviso: aviso, llamar: llamar, guardar: guardar, LOCAL: LOCAL};
})();
