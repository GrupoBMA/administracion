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
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01" stroke-width="2.6"/>',
    actualizar: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>'
  };
  function ico(k) { return '<svg class="od-ic" viewBox="0 0 24 24" aria-hidden="true">' + (IC[k] || IC.lugar) + '</svg>'; }
  // Siluetas de lado (viewBox 0 0 64 40), todas mirando a la derecha y sobre el mismo piso (y = 37).
  // UTV, ATV, motocarro y go kart están calcados de los ejemplos del usuario (25-nov-2026); el mototaxi es la moto
  // del motocarro con cabina de pasajeros y el chasis es la base vista desde arriba (también ejemplo suyo).
  // Lo común: relleno del color del texto, ".h" = hueco del color del fondo (--hueco), y la misma llanta
  // (gruesa, aro blanco delgado, maza grande) separada del cuerpo por un hueco que forma el arco.
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var RUEDA = function (x, r) {
    var y = 37 - r;
    return '<circle class="h" cx="' + x + '" cy="' + y + '" r="' + r2(r + 1.4) + '"/><circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>' +
      '<circle class="h" cx="' + x + '" cy="' + y + '" r="' + r2(r * 0.64) + '"/><circle cx="' + x + '" cy="' + y + '" r="' + r2(r * 0.5) + '"/>';
  };
  // Rueda de aro (bici, silla)
  var ARO = function (x, y, r, g) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/><circle class="h" cx="' + x + '" cy="' + y + '" r="' + r2(r - (g || 2.2)) + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + r2(r * 0.22) + '"/>';
  };
  // Llanta vista desde arriba (chasis)
  var LLANTA_ARRIBA = function (x, y, w, h) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2.6"/>' +
      '<rect class="h" x="' + (x + 1.7) + '" y="' + (y + 1.7) + '" width="' + (w - 3.4) + '" height="' + (h - 3.4) + '" rx="1.4"/>' +
      '<rect x="' + (x + 2.7) + '" y="' + (y + 2.7) + '" width="' + (w - 5.4) + '" height="' + (h - 5.4) + '" rx=".8"/>';
  };
  var TRAZO = function (d, g, color) {
    return '<path d="' + d + '" fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="' + (g || 3) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  };
  // Línea del color del fondo, para marcar un borde dentro de una pieza rellena
  var LINEA = function (d, g) { return TRAZO(d, g || 1.3, 'var(--hueco)'); };
  // Calcos de los ejemplos (coordenadas del calco; CALCO los acomoda sobre el piso). motoBase = el motocarro sin plataforma.
  var CALCOS = {
    utv: 'M11.33 0.07L29.37 0.11L29.75 0.35L30.24 0.93L31.20 2.27L32.23 3.44L37.54 10.16L39.28 10.67L40.74 10.70L42.99 11.11L44.76 11.19L45.70 11.47L47.47 11.54L48.35 11.83L48.64 12.37L48.85 14.62L49.13 15.71L49.17 17.13L48.88 17.25L45.04 17.25L44.77 17.34L44.69 17.59L45.05 18.67L45.21 18.87L46.34 18.91L46.94 19.24L47.60 19.34L49.15 20.26L50.70 21.83L51.10 22.39L51.23 22.83L51.55 23.33L51.68 24.02L51.95 24.41L52.05 24.87L52.03 27.26L51.69 27.84L51.58 28.55L51.18 29.37L50.34 30.63L48.96 31.86L48.24 32.32L47.17 32.78L45.56 33.12L44.53 33.17L42.37 32.76L40.68 31.85L39.42 30.65L38.62 29.55L38.22 28.83L37.81 27.45L37.74 25.24L37.65 24.90L37.41 24.72L36.08 24.57L35.79 24.68L35.57 25.28L35.26 25.39L29.57 25.37L29.27 25.48L28.68 26.53L28.25 26.97L27.28 27.38L18.78 27.38L17.79 27.04L17.32 26.55L17.13 25.97L17.07 24.85L16.91 24.60L16.59 24.52L14.72 24.65L14.37 24.81L14.25 25.05L14.25 26.89L13.87 28.46L13.48 29.30L12.23 31.02L10.57 32.27L9.57 32.75L8.05 33.08L6.34 33.13L4.61 32.75L3.04 31.92L2.10 31.12L0.96 29.75L0.13 27.97L0 26.51L0.12 24.07L0.94 22.29L1.83 21.08L2.89 20.19L4.38 19.33L4.56 18.99L4.29 18.44L4.09 17.56L3.94 17.36L3.53 17.25L1.13 17.25L0.80 17.06L0.80 10.88L1.18 10.70L3.89 10.70L4.36 10.55L4.53 10.21L4.63 9.18L4.94 8.26L5.46 5.20L5.81 4.32L10 1ZM12.15 2.83L11.64 2.99L10.93 3.66L8.52 5.45L8.10 5.85L7.90 6.21L7.06 10.49L7.17 10.64L7.42 10.70L10.03 10.70L13.41 10.70L13.80 10.58L13.91 10.38L14.05 8.88L14.30 8.11L14.87 4.07L15.14 3.08L15.03 2.88L14.79 2.81ZM17.98 2.83L17.74 2.95L17.63 3.20L17.59 4.38L17.28 5.25L17.17 6.63L16.83 7.93L16.76 9.14L16.43 10.19L16.42 10.91L17 11.45L18.97 12.66L19.57 12.88L22.16 13.15L30.95 13.23L31.35 13.08L32.03 12.48L34.35 10.65L34.41 10.37L28.55 2.97L28 2.81ZM6.52 17.21L6.18 17.34L6.12 17.54L6.66 18.83L8.63 18.91L9.22 19.27L9.39 19.22L9.66 18.93L10.33 18.01L10.38 17.62L10.21 17.38L9.66 17.21ZM41.02 17.68L39.55 18.51L38.86 19.05L38.07 19.74L36.92 21.11L36.28 22.41L36.42 22.54L37.38 22.81L37.98 22.97L38.37 22.87L39.02 21.83L39.98 20.74L41.17 19.82L41.69 19.63L41.89 19.43L41.95 19.06L41.58 17.90L41.37 17.70ZM13.78 19.26L12.82 20.34L12.44 20.89L12.39 21.20L13.03 21.93L13.63 22.86L13.97 22.93L14.88 22.71L16.35 22.54L16.50 22.39L16.49 22.16L15.11 20.26L14.15 19.32ZM7.03 22.79L5.78 23.03L4.70 23.84L4.19 24.50L3.81 25.66L3.79 26.05L4.15 27.33L4.77 28.24L5.20 28.63L6.08 29.08L7.06 29.16L8.18 29.07L8.93 28.64L9.46 28.19L10.19 27.03L10.34 25.85L10.19 24.97L9.84 24.29L9.15 23.55L8.41 23.02ZM44.54 22.79L43.48 23.05L43.21 23.30L42.79 23.49L42.30 24.03L41.94 24.54L41.79 24.95L41.71 26.36L41.95 27.40L42.34 27.98L43 28.60L43.88 29.10L45.19 29.17L45.98 29.04L46.60 28.69L47.33 28.04L47.90 27.12L48.06 25.85L47.85 24.77L47.47 24.08L47.02 23.61L46.13 23.02L45.16 22.80Z',
    atv: 'M31.23 -0.12L37.04 -0.14L37.93 0.11L38.33 0.52L38.67 1.23L39.11 3.41L39.27 3.74L39.60 3.91L40.66 4.12L41.90 4.77L43.04 5.90L43.65 7.24L44 7.38L44.91 7.42L45.53 7.84L46.29 10.02L46.30 10.52L46.06 11.01L45.63 11.34L45.14 11.44L37.27 11.44L36.70 11.64L36.39 12.01L35.91 13.03L32.22 21.55L31.69 22.10L31 22.36L24.15 22.39L23.28 22.08L22.82 21.64L22.56 21.17L20.53 16.02L19.13 12.48L18.79 11.84L18.52 11.60L17.96 11.44L5.62 11.43L5.41 11.28L5.34 10.99L5.34 9.09L5.59 8.30L5.94 7.83L6.47 7.51L7.06 7.37L8.16 7.35L8.48 6.71L8.83 6.34L9.41 6.15L25.42 6.15L26 6.34L26.30 6.71L26.47 7.18L26.74 7.36L30.99 7.38L31.17 7.20L31.51 6.32L32.05 5.81L32.88 5.61L34.59 5.55L35.03 5.22L35.14 4.84L34.80 2.87L34.49 2.42L34.06 2.31L31.10 2.28L30.70 2.14L30.37 1.83L30.14 1.34L30.17 0.68L30.60 0.11ZM10.19 7.07L9.95 7.19L9.94 7.47L10.30 7.84L10.60 7.99L14.02 8.14L16.84 8.44L19.28 8.85L21.93 9.55L24.17 10.75L24.51 10.63L24.77 10.21L25.33 8.55L25.40 7.34L25.13 7.07ZM46.79 7.44L47.97 7.48L48.50 7.90L48.83 8.61L49.39 10.63L49.25 11.12L48.89 11.26L47.68 11.21L47.32 10.98L47.11 10.69L46.31 8.06L46.38 7.66ZM3.90 9.26L4.49 9.30L4.69 9.55L4.75 10.90L4.67 11.27L4.34 11.44L2.89 11.44L2.36 11.39L2.08 11.04L1.99 10.63L2.22 9.86L2.51 9.52L2.90 9.32ZM1.69 12.01L16.06 11.99L17.06 12.16L17.90 12.81L18.35 13.63L22.19 22.41L22.86 23.14L23.84 23.52L31.25 23.52L31.75 23.42L32.36 23.09L32.86 22.50L33.28 21.66L37.12 13.19L37.60 12.54L38.26 12.12L39.23 12.01L49.86 12.02L50.19 12.14L50.51 12.45L50.70 12.94L50.54 13.49L50.07 13.85L49.66 13.93L39.98 13.93L39.15 14.23L38.47 14.90L38.09 15.61L34.31 24.13L33.64 24.91L33.02 25.33L32.57 25.42L29.08 25.46L22.52 25.42L22.07 25.33L21.60 25.03L21.13 24.60L20.79 24.08L17.01 15.29L16.50 14.57L16.08 14.22L15.20 13.93L1.65 13.91L1.33 13.78L1.07 13.50L0.90 12.89L1.14 12.36ZM8.66 14.63L9.95 14.61L12.02 14.99L13.77 15.68L14.41 16.03L15.46 16.84L16.95 18.42L17.69 19.58L18.36 21.17L18.77 23.20L18.82 24.38L18.48 26.48L17.78 28.36L16.91 29.75L15.25 31.45L13.81 32.40L12.62 32.93L11.51 33.26L10 33.47L9.18 33.52L7.27 33.30L6.17 32.96L4.42 32.17L2.93 31.03L1.88 29.92L0.86 28.27L0.07 26.08L-0.14 24.47L0.04 22.29L0.50 20.68L1.56 18.61L2.63 17.38L4.19 16.08L5.56 15.38L6.76 14.95ZM45.02 14.63L46.27 14.61L48.39 14.98L50.18 15.68L51.87 16.84L53.49 18.56L54.23 19.86L54.98 21.96L55.23 23.88L55.02 26.07L54.63 27.27L53.93 28.83L53.15 29.99L51.54 31.55L49.95 32.54L47.92 33.26L46.49 33.46L45.19 33.47L43.47 33.24L41.70 32.61L40.79 32.12L39.81 31.42L38.18 29.75L37.39 28.52L36.62 26.48L36.32 24.74L36.32 23.43L36.70 21.32L37.39 19.61L38.59 17.88L40.08 16.47L41.33 15.68L43.40 14.91ZM25.19 19.30L24.67 19.47L24.31 19.92L24.36 20.55L24.88 20.99L30.12 21.03L30.68 20.82L30.96 20.24L30.82 19.70L30.34 19.36ZM8.74 20.32L7.54 20.75L7.01 21.12L6.27 21.87L5.93 22.43L5.64 23.28L5.56 24.15L5.64 24.75L5.79 25.32L6.18 26.07L7.17 27.12L7.82 27.50L8.62 27.75L9.93 27.79L10.90 27.50L11.51 27.12L12.55 26.03L13.04 24.89L13.12 24.06L13.04 23.23L12.41 21.92L11.93 21.36L11.20 20.78L10.20 20.37ZM45.20 20.32L43.91 20.75L43.30 21.22L42.55 22.10L42.05 23.23L41.97 23.93L42.05 24.89L42.55 26.02L43.62 27.16L44.19 27.50L44.98 27.75L46.26 27.81L47.59 27.32L48.34 26.77L48.82 26.25L49.21 25.60L49.46 24.76L49.50 23.50L49.04 22.20L48.06 21.10L47.55 20.75L46.65 20.38ZM9.12 22.60L9.67 22.63L10.20 22.91L10.55 23.28L10.83 23.91L10.76 24.38L10.47 24.95L10.10 25.30L9.63 25.46L9.23 25.51L8.63 25.34L8.08 24.81L7.94 24.44L7.94 23.72L8.13 23.24L8.44 22.91ZM45.61 22.59L46.08 22.62L46.67 22.94L47.02 23.36L47.21 23.99L47.08 24.65L46.76 25.09L46.36 25.37L45.90 25.50L45.25 25.40L44.79 25.14L44.28 24.20L44.33 23.75L44.70 23.08L44.94 22.87Z',
    motocarro: 'M32.01 0.09L40.90 0.07L42.13 0.40L42.69 0.71L43 0.95L43.23 1.34L43.18 2.33L46.33 9.33L46.62 9.51L48.30 9.72L49.93 10.30L50.34 10.59L50.88 11.21L51.20 12.16L51.68 12.59L51.82 12.85L51.80 14.83L51.49 15.17L50.67 15.30L50.42 15.52L49.14 19.84L48.30 22.09L46.56 26.17L45.83 27.26L45.38 27.64L44.60 27.92L38.28 27.92L38.01 27.75L37.97 26.08L37.72 25.79L22.76 25.81L22.39 25.74L22.20 25.57L21.54 24.37L20.64 23.35L19.61 22.52L18.06 21.70L18.29 21.59L29.48 21.59L29.85 21.45L29.88 2.51L30.03 1.75L30.51 0.95L31.21 0.39ZM33.89 2.16L32.96 2.57L32.64 3.01L32.50 3.60L32.50 23.59L32.57 23.88L32.80 24.13L33.23 24.21L42.90 24.21L43.27 24.11L43.45 23.90L43.67 22.70L43.95 20.83L44.13 18.25L44.20 13.57L44.07 13.40L43.72 13.40L42.65 13.80L42.30 13.57L42.20 13.20L42.29 12.92L42.50 12.76L43.04 12.76L43.93 12.48L44.03 12.37L44.06 12.07L43.89 10.93L43.29 8.51L41.58 3.49L41.28 2.92L40.89 2.48L40.14 2.17ZM48.03 15.57L47.69 15.85L47.55 16.61L47.76 17.31L48.09 17.48L48.28 17.38L48.49 17.05L48.57 16.36L48.40 15.83ZM0.49 15.61L29.18 15.60L29.36 15.72L29.45 15.99L29.45 20.76L29.30 21.12L28.84 21.13L0.31 21.14L0.13 21.03L0.04 20.72L0.04 16.21L0.13 15.83ZM36.08 17.57L37.40 17.60L37.83 17.86L38.02 18.36L37.98 18.75L37.63 19.56L38 20.18L37.62 20.83L37.98 21.42L37.62 22.14L37.96 22.68L37.96 22.91L37.44 23.62L36.13 23.63L33.30 23.63L33.08 23.56L33.01 23.34L33.06 18.15L33.86 17.87ZM49.46 20.78L51.20 21.07L54.09 21.92L55.56 22.74L56.08 23.24L56.41 23.74L56.47 24.38L55.70 24.69L55.63 24.86L56.40 25.75L56.99 26.94L57.18 28.17L57.08 29.31L56.96 29.84L56.15 31.28L55.52 31.93L54.68 32.47L53.91 32.82L53.04 32.97L52.42 33.01L51.08 32.82L49.87 32.22L49.27 31.73L48.69 31.10L48.06 29.99L47.80 28.83L47.80 27.88L48.03 26.83L48.38 26.04L48.17 25.88L47.41 25.95L47.27 25.78L48.31 23.48L49.26 20.98ZM1.22 21.61L13.55 21.64L13.56 21.77L12.57 22.20L11.62 22.78L10.80 23.49L9.94 24.56L9.34 25.66L8.96 25.79L7.06 25.77L6.83 25.56L6.79 24.59L6.64 24.34L2.52 23.35L2.37 23.45L2.29 23.74L2.31 27.43L2.21 27.62L1.93 27.62L1.82 27.37L1.83 23.50L1.70 23.24L1.18 23.03L1.01 22.83L0.99 21.82ZM15.36 21.90L16.84 21.98L18.50 22.50L19.90 23.36L20.95 24.45L21.63 25.52L22.08 26.78L21.94 27.06L21.27 26.97L20.85 26.59L20.04 25.18L19.06 24.19L17.88 23.49L16.27 23.10L14.89 23.18L13.37 23.66L12.40 24.33L11.75 24.98L10.68 26.71L10.04 27.05L9.56 26.93L9.71 26.10L10.02 25.43L10.64 24.45L11.39 23.64L12.31 22.92L12.94 22.57L14.05 22.16ZM15.50 23.68L16.48 23.73L17.30 23.92L18.41 24.45L18.89 24.84L19.76 25.79L20.07 26.36L20.37 27.25L20.50 28.17L20.28 29.77L19.78 30.87L19.37 31.40L18.74 32.01L17.84 32.56L17.03 32.88L16.11 32.98L15.60 33.01L14.40 32.82L12.77 31.91L11.67 30.57L11.40 29.93L11.12 28.46L11.18 27.65L11.42 26.65L12.30 25.27L13.11 24.53L13.64 24.21L14.44 23.89ZM15.53 25.39L14.49 25.72L13.45 26.57L13.16 27.01L12.95 27.64L12.87 28.61L13.15 29.67L13.79 30.49L14.73 31.11L15.67 31.30L16.08 31.28L16.98 31.08L17.99 30.35L18.58 29.37L18.75 28.33L18.58 27.33L17.97 26.31L17.05 25.67L16.18 25.40ZM52.21 25.39L51.26 25.66L50.39 26.29L49.77 27.16L49.51 28.50L49.76 29.52L50.46 30.49L51.49 31.14L52.77 31.28L53.58 31.12L54.63 30.38L55.26 29.45L55.47 28.32L55.26 27.23L54.61 26.27L53.64 25.64L52.86 25.40ZM30.09 25.98L30.29 26.02L30.52 26.52L30.69 26.63L31.44 26.25L37.06 26.27L37.37 26.36L37.44 26.57L37.24 27.39L36.76 27.86L36.06 28.06L34.13 28.10L33.92 28.25L33.84 28.67L33.61 28.81L32.39 28.83L32.08 28.74L31.12 27.45L30.88 27.32L30.59 27.43L30.41 27.94L30.06 27.89L29.93 27.50L29.76 27.39L21.48 28.03L21.19 27.96L21.05 27.63L21.12 27.45L21.45 27.37L29.57 26.77L29.80 26.64ZM15.72 26.81L16.32 26.87L16.83 27.15L17.19 27.59L17.38 28.28L17.26 28.93L17.04 29.33L16.66 29.64L15.91 29.90L15.34 29.80L14.73 29.47L14.35 28.95L14.25 28.54L14.32 27.81L14.69 27.27L15.23 26.90ZM52.36 26.81L53 26.87L53.54 27.16L53.84 27.55L54.06 28.28L54.01 28.71L53.72 29.33L53.42 29.61L52.65 29.89L52.33 29.89L51.64 29.65L51.24 29.28L50.97 28.57L50.99 27.97L51.27 27.39L51.60 27.06Z',
    gokart: 'M16.60 -0.35L18.60 -0.32L19.49 0.06L20.47 1L20.89 1.92L24.48 11.89L24.71 12.15L31.08 12.18L31.97 12.39L32.93 12.97L33.50 13.54L33.92 14.34L34.09 15.23L34.24 15.33L35.47 11.52L36.20 10.41L36.77 9.80L36.76 9.63L32.98 6.41L32.84 6.44L31.52 7.81L31.08 7.98L30.24 7.96L29.73 7.78L29.57 7.17L29.57 6.44L29.74 6L34.14 1.35L34.44 1.21L35.23 1.18L35.68 1.27L35.94 1.45L36.09 1.91L36.07 2.84L35.91 3.20L34.75 4.52L38.62 7.88L38.93 7.69L40.45 6.11L37.98 4.13L37.80 3.71L37.82 2.71L37.93 2.49L38.36 2.19L39.47 2.19L41.28 3.48L55.76 14.91L56.69 15.69L57.34 16.42L57.97 17.54L58.43 18.92L58.57 20.24L58.50 21.56L58.26 22.42L57.33 23.48L56.43 23.84L48.59 23.87L48.13 23.98L46.75 24.80L45.59 25.14L44.64 25.21L42.30 25.11L41.13 24.77L39.85 23.97L39.43 23.87L10.79 23.87L8.97 24.81L7.92 25.11L5.50 25.21L4.50 25.11L3.50 24.80L2.26 24.13L1.34 23.35L0.72 22.66L-0.04 21.30L-0.30 20.51L-0.45 19.47L-0.45 17.60L-0.30 16.44L0.07 15.42L1.03 13.94L1.92 13.12L2.96 12.45L4.11 11.93L4.28 10.19L4.65 9.45L5.46 8.84L6.56 8.63L15.42 8.64L14.07 3.64L14.08 2.43L14.50 1.10L15.04 0.42L15.72 -0.04Z',
    motoBase: 'M32.01 0.09L40.90 0.07L42.13 0.40L42.69 0.71L43 0.95L43.23 1.34L43.18 2.33L46.33 9.33L46.62 9.51L48.30 9.72L49.93 10.30L50.34 10.59L50.88 11.21L51.20 12.16L51.68 12.59L51.82 12.85L51.80 14.83L51.49 15.17L50.67 15.30L50.42 15.52L49.14 19.84L48.30 22.09L46.56 26.17L45.83 27.26L45.38 27.64L44.60 27.92L38.28 27.92L38.01 27.75L37.97 26.08L37.72 25.79L22.76 25.81L22.39 25.74L22.20 25.57L21.54 24.37L20.64 23.35L19.57 22.49L18.08 21.75L31.13 21.64L31.15 0.55L31.24 0.38ZM33.89 2.16L32.96 2.57L32.64 3.01L32.50 3.60L32.50 23.59L32.57 23.88L32.80 24.13L33.23 24.21L42.90 24.21L43.27 24.11L43.45 23.90L43.67 22.70L43.95 20.83L44.13 18.25L44.20 13.57L44.07 13.40L43.72 13.40L42.65 13.80L42.30 13.57L42.20 13.20L42.29 12.92L42.50 12.76L43.04 12.76L43.93 12.48L44.03 12.37L44.06 12.07L43.89 10.93L43.29 8.51L41.58 3.49L41.28 2.92L40.89 2.48L40.14 2.17ZM48.03 15.57L47.69 15.85L47.55 16.61L47.76 17.31L48.09 17.48L48.28 17.38L48.49 17.05L48.57 16.36L48.40 15.83ZM36.08 17.57L37.40 17.60L37.83 17.86L38.02 18.36L37.98 18.75L37.63 19.56L38 20.18L37.62 20.83L37.98 21.42L37.62 22.14L37.96 22.68L37.96 22.91L37.44 23.62L36.13 23.63L33.30 23.63L33.08 23.56L33.01 23.34L33.06 18.15L33.86 17.87ZM49.46 20.78L51.20 21.07L54.09 21.92L55.56 22.74L56.08 23.24L56.41 23.74L56.47 24.38L55.70 24.69L55.63 24.86L56.40 25.75L56.99 26.94L57.18 28.17L57.08 29.31L56.96 29.84L56.15 31.28L55.52 31.93L54.68 32.47L53.91 32.82L53.04 32.97L52.42 33.01L51.08 32.82L49.87 32.22L49.27 31.73L48.69 31.10L48.06 29.99L47.80 28.83L47.80 27.88L48.03 26.83L48.38 26.04L48.17 25.88L47.41 25.95L47.27 25.78L48.31 23.48L49.26 20.98ZM1.05 21.73L13.56 21.72L11.62 22.78L10.80 23.49L9.94 24.56L9.39 25.60L9.12 25.80L7.06 25.77L6.83 25.56L6.79 24.59L6.64 24.34L2.52 23.35L2.37 23.45L2.29 23.74L2.31 27.43L2.21 27.62L1.93 27.62L1.82 27.37L1.83 23.50L1.70 23.24L1.18 23.03L1.01 22.83ZM15.36 21.90L16.84 21.98L18.50 22.50L19.90 23.36L20.95 24.45L21.63 25.52L22.08 26.78L21.94 27.06L21.27 26.97L20.85 26.59L20.04 25.18L19.06 24.19L17.88 23.49L16.27 23.10L14.89 23.18L13.37 23.66L12.40 24.33L11.75 24.98L10.68 26.71L10.04 27.05L9.56 26.93L9.71 26.10L10.02 25.43L10.64 24.45L11.39 23.64L12.31 22.92L12.94 22.57L14.05 22.16ZM15.50 23.68L16.48 23.73L17.30 23.92L18.41 24.45L18.89 24.84L19.76 25.79L20.07 26.36L20.37 27.25L20.50 28.17L20.28 29.77L19.78 30.87L19.37 31.40L18.74 32.01L17.84 32.56L17.03 32.88L16.11 32.98L15.60 33.01L14.40 32.82L12.77 31.91L11.67 30.57L11.40 29.93L11.12 28.46L11.18 27.65L11.42 26.65L12.30 25.27L13.11 24.53L13.64 24.21L14.44 23.89ZM15.53 25.39L14.49 25.72L13.45 26.57L13.16 27.01L12.95 27.64L12.87 28.61L13.15 29.67L13.79 30.49L14.73 31.11L15.67 31.30L16.08 31.28L16.98 31.08L17.99 30.35L18.58 29.37L18.75 28.33L18.58 27.33L17.97 26.31L17.05 25.67L16.18 25.40ZM52.21 25.39L51.26 25.66L50.39 26.29L49.77 27.16L49.51 28.50L49.76 29.52L50.46 30.49L51.49 31.14L52.77 31.28L53.58 31.12L54.63 30.38L55.26 29.45L55.47 28.32L55.26 27.23L54.61 26.27L53.64 25.64L52.86 25.40ZM30.09 25.98L30.29 26.02L30.52 26.52L30.69 26.63L31.44 26.25L37.06 26.27L37.37 26.36L37.44 26.57L37.24 27.39L36.76 27.86L36.06 28.06L34.13 28.10L33.92 28.25L33.84 28.67L33.61 28.81L32.39 28.83L32.08 28.74L31.12 27.45L30.88 27.32L30.59 27.43L30.41 27.94L30.06 27.89L29.93 27.50L29.76 27.39L21.48 28.03L21.19 27.96L21.05 27.63L21.12 27.45L21.45 27.37L29.57 26.77L29.80 26.64ZM15.72 26.81L16.32 26.87L16.83 27.15L17.19 27.59L17.38 28.28L17.26 28.93L17.04 29.33L16.66 29.64L15.91 29.90L15.34 29.80L14.73 29.47L14.35 28.95L14.25 28.54L14.32 27.81L14.69 27.27L15.23 26.90ZM52.36 26.81L53 26.87L53.54 27.16L53.84 27.55L54.06 28.28L54.01 28.71L53.72 29.33L53.42 29.61L52.65 29.89L52.33 29.89L51.64 29.65L51.24 29.28L50.97 28.57L50.99 27.97L51.27 27.39L51.60 27.06Z'
  };
  var CALCO = function (k, x, y) {
    return '<path fill-rule="evenodd" transform="translate(' + x + ' ' + y + ')" d="' + CALCOS[k] + '"/>';
  };
  var SIL = {
    utv: CALCO('utv', 6, 4.05) + RUEDA(13.1, 7) + RUEDA(50.97, 7),
    atv: CALCO('atv', 4.5, 3.63) + RUEDA(13.64, 8.85) + RUEDA(50.44, 8.85),
    // Sin cabina (pedido del usuario, 28-nov-2026: "literalmente solo quitarle la parte de la cabina"): el mismo calco,
    // tapando con el color del fondo el techo y el poste de atrás. Al frente, un carenado deportivo con el faro (todo relleno)
    // y el manubrio detrás con el puño hacia atrás, de una foto de referencia del usuario; sin espejo.
    motocarro: CALCO('motocarro', 3.5, 4.2) +
      '<path class="h" d="M32.6 3.6H50.4V12.4H46.9L47.6 16.3 47.7 21.4H36.2V25.6H32.6Z"/>' +
      '<path d="M48.4 17.4L50.2 11.2C50.4 10.6 51 10.4 51.6 10.7L54 12.2C55.2 13 56 14.4 56.2 15.8L56.4 17.6Z"/>' +
      TRAZO('M50.2 12.6L45.8 12', 1.5) +
      '<rect x="42.8" y="11" width="3.8" height="2" rx="1" transform="rotate(8 44.7 12)"/>' +
      RUEDA(19.84, 4.6) + RUEDA(55.93, 4.6),
    // el ejemplo era de líneas: se calcó relleno; la línea blanca separa el asiento del chasis
    gokart: CALCO('gokart', 3, 11.9) + LINEA('M13 27.3H44', 1) + RUEDA(8.52, 5.2) + RUEDA(48.22, 5.2),
    mototaxi:
      // la moto del motocarro con la cabina de pasajeros completa: techo, poste al centro y asiento
      CALCO('motoBase', 3.5, 4.2) +
      '<path d="M36.2 4.2v1.9H10.4C9.3 6.1 8.6 6.8 8.6 7.9V20H4.6V9.2a5 5 0 0 1 5-5z"/>' +
      '<path d="M4.6 19.2h31.8v6.4H7.6a3 3 0 0 1-3-3z"/>' +
      '<rect x="20.4" y="5" width="2.2" height="15"/><rect x="25" y="15" width="9" height="2.6" rx="1.3"/><rect x="27" y="16.6" width="5" height="3"/>' +
      RUEDA(19.84, 4.6) + RUEDA(55.93, 4.6),
    cross:
      // asiento que sigue en la salpicadera, tanque con línea blanca, motor con aletas, amortiguador, escape,
      // placa del número, salpicadera delantera alta y horquilla hasta la llanta
      '<path d="M3.4 15.4c0-.6.5-1 1.1-1L30 14l7.6-3.4c1-.4 2-.3 2.9.2l4.4 2.6-1.8 4.8-9.4 2.4H19.6l-3-3H4.6c-.7 0-1.2-.5-1.2-1.2z"/>' +
      LINEA('M30.4 14.4l1.6 5', 1.1) +
      '<path d="M18.4 19.6h16.4l3 3.4-1.6 5.6H27.6z"/>' + LINEA('M27.4 23.4h8.4M28.6 26h6.6', 1) +
      TRAZO('M20.2 19.6l3.4 7', 1.6) + TRAZO('M12 29.6l16-3.6', 2.6) +
      TRAZO('M36 23.6c-6 0-12.6-2.6-17.8-2.8', 1.8) +
      TRAZO('M41.8 7.6l5.6-1.2', 2.2) + TRAZO('M44.6 7l.8 3.4', 2) +
      '<path d="M43.6 11l5.8-2 1.8 6.2-5.4 1.8z"/>' +
      '<path d="M47.6 18.4l11.2-2.4c.9-.2 1.4.8.8 1.4l-3 3.2-8.2.6z"/>' +
      RUEDA(12, 7.4) + RUEDA(52, 7.4) + TRAZO('M45.6 11.6l6.4 18', 2.4),
    patin:
      // patín de pie: plataforma baja y delgada, poste con faro, manubrio, salpicadera atrás
      '<path d="M8 31.2v-2c0-.9.7-1.6 1.6-1.6h30.6l5.4-6 2.4 1.8-6 7c-.6.6-1.4 1-2.2 1z"/>' +
      TRAZO('M52 31L46.6 7.4', 2.6) + TRAZO('M42.6 6.8h7.6', 2.6) +
      '<rect x="46.6" y="11.6" width="3.4" height="2.6" rx="1.2"/>' +
      TRAZO('M3.5 27.9A9 9 0 0 1 17.8 24.1', 2) +
      RUEDA(12, 6) + RUEDA(52, 6),
    bici:
      ARO(13, 28.6, 8.4) + ARO(51, 28.6, 8.4) +
      TRAZO('M13 28.6h17L42 15H24.5zM24.5 15L30 28.6M42 15l9 13.6M42 15l-2-6h5', 3) +
      TRAZO('M21 11.4h7', 3.6) + TRAZO('M24.5 15l-1.6-3.6', 3) + '<circle cx="30" cy="28.6" r="3"/>',
    silla:
      // respaldo con manija, asiento, descansabrazos, rueda grande y rueda chica al frente
      TRAZO('M15.8 18L14 5H9.6', 2.6) + TRAZO('M18.6 11.6h13l1.6 4.6', 2.2) +
      '<rect x="14" y="16.4" width="22" height="3.4" rx="1.7"/>' + TRAZO('M34 18.6l6 11.4h6', 2.6) +
      '<circle class="h" cx="24" cy="27" r="11.4"/>' + ARO(24, 27, 10, 2.2) +
      '<circle class="h" cx="44.6" cy="34" r="4.4"/><circle cx="44.6" cy="34" r="3"/>',
    montacargas:
      // contrapeso redondo, jaula delgada con asiento y volante, mástil de dos rieles y uñas al piso
      '<path d="M3 31v-8.4c0-3.4 2.4-5.6 5.8-5.6h4.6v-1.4c0-.9.7-1.6 1.6-1.6h18.4V31z"/>' +
      '<rect x="13.4" y="3.6" width="2" height="12"/><path d="M30.8 3.6h2l-.6 11.4h-2.4z"/><rect x="12.6" y="3" width="21" height="2.2" rx="1.1"/>' +
      '<path d="M16.6 14.2V9.4c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v3.2h3.6c.9 0 1.6.7 1.6 1.6z"/>' +
      TRAZO('M27.4 14.4l2-4.6', 1.6) + TRAZO('M27.6 9.6l3.4 1.2', 2) +
      '<rect x="34.6" y="2" width="4.4" height="31" rx="1.2"/>' + LINEA('M36.8 3.6v27.8', 1) +
      '<rect x="39" y="17" width="2.6" height="16" rx="1"/><rect x="39" y="31.8" width="22" height="2.2" rx="1.1"/>' +
      RUEDA(10, 5.2) + RUEDA(27, 6.2),
    chasis:
      // solo la base, vista desde arriba y mirando a la derecha: dos ejes con su llanta en cada punta,
      // larguero al centro y la caja de cada eje
      '<rect x="12" y="6" width="3" height="28" rx="1.5"/><rect x="49" y="6" width="3" height="28" rx="1.5"/>' +
      '<rect x="13" y="18.5" width="38" height="3" rx="1.5"/>' +
      LLANTA_ARRIBA(5.5, 1.5, 16, 8) + LLANTA_ARRIBA(5.5, 30.5, 16, 8) +
      LLANTA_ARRIBA(42.5, 1.5, 16, 8) + LLANTA_ARRIBA(42.5, 30.5, 16, 8) +
      '<circle cx="13.5" cy="20" r="4.4"/><circle class="h" cx="13.5" cy="20" r="1.7"/>' +
      '<circle cx="50.5" cy="20" r="4.4"/><circle class="h" cx="50.5" cy="20" r="1.7"/>',
    padel:
      // raqueta con perforaciones y pelota con su costura
      '<g transform="rotate(-38 26 21)"><ellipse cx="26" cy="14" rx="11" ry="12.4"/>' +
      '<circle class="h" cx="21.6" cy="10" r="1.5"/><circle class="h" cx="26" cy="10" r="1.5"/><circle class="h" cx="30.4" cy="10" r="1.5"/>' +
      '<circle class="h" cx="21.6" cy="15" r="1.5"/><circle class="h" cx="26" cy="15" r="1.5"/><circle class="h" cx="30.4" cy="15" r="1.5"/>' +
      '<path d="M22 24.6h8l-1.2 5H23.2z"/><rect x="23.4" y="28.6" width="5.2" height="10" rx="2.2"/></g>' +
      '<circle cx="52" cy="31" r="5.6"/>' + LINEA('M47.6 28.2c2.6 1 4.4 3.2 4.8 7.6', 1.2),
    caja:
      // caja cerrada con su cinta
      '<path d="M12 12.4l20-7.4 20 7.4v18.4L32 38 12 30.8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M12 12.4l20 7.4 20-7.4M32 19.8V38M21.6 8.6l20 7.4" fill="none" stroke="var(--hueco)" stroke-width="1.6" stroke-linejoin="round"/>'
  };
  // Silueta en su casilla de color (clase: od-sil-tile, od-sil-cab, od-sil-ficha, od-sil-fila)
  function imagen(fig, clase) {
    return '<span class="od-sil-c ' + clase + '"><svg class="od-sil" viewBox="0 0 64 40" aria-hidden="true">' + (SIL[fig] || SIL.caja) + '</svg></span>';
  }
  // Ícono en su casilla de color (tono: entra, venta, neutro o alerta)
  function icoC(k, tono, extra) { return '<span class="od-icc tono-' + (tono || 'neutro') + (extra ? ' ' + extra : '') + '">' + ico(k) + '</span>'; }
  var ICO_CLASE = {vehiculos: 'moto', pasto: 'pasto', otros: 'caja'};
  var ICO_ALERTA = {negativo: 'negativo', serie: 'copia', otra_persona: 'persona', devolucion: 'regreso', ajuste: 'ajuste',
                    sin_venta: 'venta', cambio: 'editar', serie_mal: 'editar', sin_movimientos: 'reloj'};

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
        return '<button type="button" class="renglon od-fila" data-i="' + i + '">' + imagen(L.figura('', r.producto || ''), 'od-sil-fila') +
          '<span class="od-fila-txt"><b class="num">' + resaltar(r.folio || L.serieCorta(s.serie), st.q) + '</b><small>' + esc(nombreProducto(r)) + '</small></span>' +
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
    return '<div class="od-s-cab">' + imagen(L.figura(panelProd ? panelProd.familia : '', crudo || nombre), 'od-sil-ficha') +
      '<h2 id="od-p-tit" class="num">' + esc((r && r.folio) || L.serieCorta(s.serie)) + '</h2>' +
      (nombre ? '<p class="od-s-prod">' + esc(nombre) + '</p>' : '') + '</div>' + (r ? info(lote, r) : '');
  }
  // Información (como "Obtener información" de un archivo): serie completa, pedimento, modelo, nombre en Odoo y llegada.
  // Está escondida; la abre el botón (i) de arriba a la derecha.
  function info(lote, r) {
    var s = L.serie(lote), n = r.producto || (r.movimientos && r.movimientos.length ? r.movimientos[0].producto : '') || '';
    var codigo = (n.match(/^\[([^\]]+)\]/) || [])[1] || (panelProd && panelProd.codigo) || '';
    var llego = (r.movimientos || []).filter(function (m) { return m.de_uso === 'supplier'; })[0];
    var filas = [['Folio', r.folio, true], ['Número de serie', s.serie, true], ['Pedimento', s.pedimento, true], ['Modelo', codigo, true],
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
      return '<button type="button" class="od-ftile" data-fam="' + esc(f) + '"><span class="od-ftile-img">' + imagen(F.fig, 'od-sil-tile') + '</span>' +
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
      '<div class="od-fcab">' + imagen(F.fig, 'od-sil-cab') + '<h2>' + esc(F.nombre) + '</h2><span class="num">' + num(F.n) + '</span></div>';
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
            (e.folio ? e.folio + ' · ' : '') + d + (d === 1 ? ' día' : ' días') + ' aquí' + (raro ? ' · cantidad ' + num(e.cantidad) : '') + '">' +
            esc(e.folio ? L.folioCorto(e.folio) : L.serieCorta(L.serie(e.lote).serie)) + '</button>';
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
    var sec = [m.lote ? m.folio || L.serieCorta(s.serie) : (m.unidad ? L.cantidad(m.cantidad, m.unidad) : ''), ruta].filter(Boolean).map(esc).join(' · ');
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
    var s = a.lote ? a.folio || L.serieCorta(L.serie(a.lote).serie) : '';
    var acciones = (s ? '<button type="button" class="btn-chico" data-accion="serie" data-i="' + i + '">' + ico('moto') + 'Ver su recorrido</button>' : '') +
      (st.vista === 'pendiente' ? '<button type="button" class="btn-chico" data-accion="revisado" data-i="' + i + '">' + ico('check') + 'Ya lo revisé</button>' : '');
    // Si el título repite el nombre del grupo, arriba va la sucursal (no se repite lo que ya dice el grupo)
    var repite = a.titulo === L.ALERTAS[a.tipo], alm = a.almacen ? nomAlm(a.almacen) : '';
    var resto = [repite ? '' : alm, a.detalle ? (a.tipo === 'serie_mal' ? conNombres(corto(a.detalle)) : corto(a.detalle)) : ''].filter(Boolean).map(esc);
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
