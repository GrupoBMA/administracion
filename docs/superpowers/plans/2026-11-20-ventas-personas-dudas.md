# Ventas, personas y dudas — plan de trabajo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Silvia trabaje en la app: encontrar cualquier venta al instante, abrir su ficha con todo su historial, registrar ventas nuevas y movimientos (anticipos, abonos, liquidaciones…), dar de alta personas con su historial, y resolver las dudas de la importación.

**Architecture:** Toda lectura y escritura pasa por funciones nuevas `public.bma_*` (`security definer`) que revisan el rol en `bma.usuarios`, igual que las de la etapa anterior; la bitácora la sigue escribiendo el trigger. La pantalla vive en archivos nuevos junto a `index.html` (como Logística): lógica pura probada con Node, utilidades de pantalla (lista para escoger, pedir texto/monto, confirmar) y un archivo por pantalla. Las pestañas viejas (Caja, Cobros, Gastos, Revisar) se quedan detrás de las nuevas hasta la etapa 5.

**Tech Stack:** Postgres/Supabase (plpgsql), JavaScript sin dependencias nuevas (supabase-js 2.45.4 ya cargado), `node --test` para la lógica, CSS con los tokens actuales.

**Spec:** `docs/superpowers/specs/2026-11-19-ventas-silvia-design.md` (etapas 3 y 4: Pantallas → Ventas, Ficha de venta, Registrar, Personas, Dudas). Base: plan `docs/superpowers/plans/2026-11-20-base-e-importacion.md` (ya en vivo).

## Global Constraints

- Repo público: ningún dato real, nombre de persona real ni correo en código, pruebas o docs. Datos de prueba inventados.
- Toda escritura es por función `public.bma_*` con `set search_path to ''`; las tablas siguen sin acceso directo. Roles: `captura` y `admin` capturan y corrigen; **solo `admin` elimina** un movimiento.
- **Cualquier captura cierra la importación** (ya lo hace el trigger de bitácora). Resolver una duda también la cierra (Task 1 lo agrega a `bma.exigir_importacion`).
- La pantalla nunca calcula estado ni saldo para guardar: eso lo decide la base (`bma.recalcular`). La pantalla solo muestra.
- Todo texto que venga de la base se pinta con `esc()` (productos, notas y nombres vienen de Excel y de captura libre).
- Sin `<select>` nativos: toda elección abre la lista para escoger (copiada de `Logistica/inventario.js`, `abrirLista`). Sin leyendas de ayuda salvo que hagan falta. Estilo actual (DM Sans/DM Mono, tokens de `index.html`, modo oscuro). En cambios visuales usar el skill Impeccable (modo Operate) y correr su detector.
- **Candado en localhost:** en `localhost`/`127.0.0.1` cada "Guardar" pide confirmar "Esto guarda en la base real", porque no hay base de pruebas. Las pruebas de escritura se hacen en SQL con `rollback`; en el navegador solo se prueba lectura y el recorrido hasta el resumen, salvo que el usuario autorice guardar.
- Montos con 2 decimales y `$` (formato de la app, `dinero()`); fechas con `fechaCorta()`.
- Folio de venta nueva: `SUC-AÑO-NNNN`, siguiente número de esa sucursal y año, calculado en la base con candado (`pg_advisory_xact_lock`).
- `lunes` de un movimiento capturado = lunes de la semana de su fecha.
- Cada push a `main` sale en vivo: commits locales; push solo con OK del usuario.

## Review Focus

1. **Dos personas guardan una venta de la misma sucursal al mismo tiempo**: no se repite el folio. Prueba en Task 1: "folio siguiente con candado" (y `unique` como respaldo).
2. **Liquidar una venta cuyo precio no está completo pagado**: se cierra igual (la liquidación manda) pero la ficha muestra el saldo distinto de cero. Prueba en Task 1 ("liquidación cierra aunque falte saldo") y Task 2 (`saldo`).
3. **Buscar "NV 21" encuentra la remisión "21"** y al revés; buscar por número de cliente encuentra sus ventas. Prueba en Task 1: casos de búsqueda.
4. **Silvia intenta eliminar un movimiento**: se rechaza. Prueba en Task 1.
5. **Un producto o nota con `<script>` o comillas** se ve como texto, no se ejecuta. Prueba en Task 2 (`esc`) y verificación en Task 4.

---

### Task 1: Funciones de Supabase para consultar y capturar

**Files:**
- Create: `supabase/sql/2026-11-20-bma-ventas.sql`
- Create: `tests/bma-ventas.sql`

**Interfaces:**
- Consumes: tablas y trigger de `2026-11-20-bma-base.sql`; `bma.exigir_importacion()`.
- Produces (todas `security definer`, `set search_path to ''`, `grant execute … to authenticated`, `revoke … from public, anon`):
  - `bma.rol_actual() returns text` (interna, sin grant): rol de la sesión o `raise … errcode '42501'`.
  - `bma.recalcular(p_venta uuid) returns void` (interna): estado = `cancelada` si tiene cancelación; si no, `cerrada` si tiene contado o liquidación; si no, `abierta`. Si queda cerrada y `precio_total` es nulo → precio = pagado neto (devoluciones restan).
  - `public.bma_ventas_buscar(p_q text, p_sucursal text default null, p_estado text default null, p_limite int default 100) returns jsonb` — arreglo de `{id, folio, sucursal, fecha, producto, cliente:{id,numero,nombre}|null, vendedor, remision, factura, estado, precio_total, pagado, ultimo (fecha del último movimiento), dudas (pendientes)}`. `p_q` busca (sin mayúsculas/acentos) en folio, producto, factura, nombre del cliente y vendedor; si trae dígitos, también remisión por número ("NV 21" = "21") y número de cliente exacto. Orden: último movimiento, más reciente primero.
  - `public.bma_venta(p_id uuid) returns jsonb` — `{venta (con cliente y vendedor), movimientos:[… con quien = nombre de bma.usuarios o "Importado"], cambios:[bitácora de la venta y sus movimientos, con quien], dudas:[…]}`.
  - `public.bma_venta_nueva(p jsonb) returns jsonb` — campos `sucursal, fecha, producto, categoria, linea, cliente_id, vendedor_id, remision, factura, color, precio_total` y `movimiento:{tipo contado|anticipo, monto>0, metodo, cuenta, fecha, nota}`. Asigna folio, inserta venta (`origen` capturada) y movimiento, recalcula. Regresa `{id, folio}`.
  - `public.bma_movimiento_nuevo(p_venta uuid, p jsonb) returns uuid` — `tipo` en anticipo, abono, liquidacion, cancelacion, entrega, devolucion; monto > 0 salvo cancelación y entrega (0); no se aceptan movimientos con dinero en una venta cancelada. Recalcula.
  - `public.bma_venta_editar(p_id uuid, p jsonb) returns void` — solo `cliente_id, vendedor_id, producto, categoria, linea, remision, factura, color, precio_total` (lo que no venga en `p` no cambia).
  - `public.bma_movimiento_corregir(p_id uuid, p jsonb) returns void` — `fecha, monto, metodo, cuenta, nota, confirmado_banco`; recalcula.
  - `public.bma_movimiento_eliminar(p_id uuid) returns void` — **solo admin**; recalcula la venta.
  - `public.bma_personas_buscar(p_q text, p_tipo text default null) returns jsonb` — `{id, numero, nombre, tipos, telefono, sucursal, ventas (como cliente), vendidas (como vendedor)}`.
  - `public.bma_persona(p_id uuid) returns jsonb` — persona + `compras` (ventas como cliente con pagado/saldo) + `vendidas` + `cambios`.
  - `public.bma_persona_guardar(p jsonb) returns uuid` — alta (sin `id`) o cambio; `nombre` obligatorio, `tipos` no vacío.
  - `public.bma_dudas(p_estado text default 'pendiente') returns jsonb` — `{id, motivo, detalle, estado, venta:{id,folio,sucursal,producto}|null, resuelta_en, quien}`.
  - `public.bma_duda_resolver(p_id uuid, p_unir_a uuid default null, p_nota text default null) returns void` — con `p_unir_a`, el movimiento de la duda pasa a esa venta (y la venta de la duda se queda vacía → se borra si no le queda ningún movimiento) y se recalculan las dos; siempre marca `resuelta` con quién y cuándo, y deja la nota en `detalle`.
  - `bma.exigir_importacion()` (reemplazo): también cerrada si existe alguna duda `resuelta`.

- [ ] **Step 1: Escribir `tests/bma-ventas.sql`** con el armazón de `tests/bma-base.sql` (cuentas de prueba inventadas dentro de la transacción, una `captura` y una `admin`; `rollback`). Casos:
  - "sin alta no busca": cuenta sin alta → `bma_ventas_buscar` lanza 42501.
  - "venta nueva de contado queda cerrada con folio siguiente": con una venta `AGS-2026-0007` existente, `bma_venta_nueva` de AGS en 2026 regresa `AGS-2026-0008`, estado cerrada, precio = monto.
  - "folio siguiente con candado": dos llamadas seguidas regresan 0008 y 0009.
  - "anticipo deja abierta y abono también"; "liquidación cierra aunque falte saldo": precio 30000, anticipo 10000, liquidación 15000 → cerrada, precio 30000, pagado 25000.
  - "cancelación cancela" y "no acepta dinero en venta cancelada".
  - "devolución resta": contado 1000 + devolución 300 → pagado 700.
  - "buscar NV 21 encuentra remisión 21", "buscar por número de cliente", "buscar sin acento encuentra con acento".
  - "editar cliente queda en bitácora con antes y después".
  - "captura no puede eliminar movimiento" (42501) y "admin sí, y recalcula".
  - "resolver duda uniendo mueve el movimiento y recalcula ambas"; "la venta que queda vacía se borra".
  - "resolver una duda cierra la importación": después, `bma_importar_lote` lanza "importación está cerrada".
  - "persona nueva toma número siguiente y su ficha lista sus compras".
  - "venta_nueva rechaza monto 0 en contado".

- [ ] **Step 2: Correr y ver que falla** — `execute_sql` con el archivo. Expected: `function public.bma_ventas_buscar(...) does not exist`.
- [ ] **Step 3: Escribir `supabase/sql/2026-11-20-bma-ventas.sql`** y aplicarla con `apply_migration` (`bma_ventas`).
- [ ] **Step 4: Correr las pruebas** — Expected: todas `ok = true`; además volver a correr `tests/bma-base.sql` y `tests/bma-importar.sql` (todo verde).
- [ ] **Step 5:** `get_advisors security` — Expected: solo los avisos del patrón (funciones para `authenticated`, RLS sin políticas).
- [ ] **Step 6: Commit** `Funciones para consultar y capturar ventas, personas y dudas`.

---

### Task 2: Lógica de pantalla sin DOM

**Files:**
- Create: `bma-logica.js` (UMD: `window.BMA` en el navegador, `module.exports` en Node)
- Create: `tests/bma-logica.test.js`

**Interfaces:**
- Produces: `BMA.esc(s)`, `BMA.dinero(n)` ("$12,500.00"; nulo → "—"), `BMA.lunesDe(isoFecha) -> iso`, `BMA.saldo(venta) -> number|null` (precio − pagado; null si no hay precio), `BMA.etiquetaEstado(venta) -> {texto, clase}` (Abierta / Cerrada / Cancelada; "Por confirmar precio" si abierta sin precio), `BMA.TIPOS` (`[{valor, nombre, conDinero}]` en el orden: anticipo, abono, liquidación, contado, devolución, entrega, cancelación), `BMA.METODOS` (efectivo, transferencia, tarjeta, depósito, Mercado Pago, cheque), `BMA.validarMovimiento({tipo, monto, metodo, fecha}) -> string|null` (mensaje en español o null), `BMA.textoCambio(c) -> string[]` (renglones "cliente: por asignar → Ana López"; ignora `creado_en`, `id`, campos iguales), `BMA.MOTIVOS` (texto amable de cada motivo de duda).

- [ ] **Step 1: Escribir `tests/bma-logica.test.js`** (`node:test`): `esc` escapa `<script>"'&`; `dinero(12500)` = "$12,500.00"; `lunesDe('2026-11-19')` = '2026-11-16' y de un lunes es el mismo día; `saldo` (30000 precio, 25000 pagado → 5000; sin precio → null); `etiquetaEstado` de los cuatro casos; `validarMovimiento` (abono sin monto → "Falta el monto"; entrega con monto 0 → null; anticipo sin método → "Falta el método"; fecha futura → "La fecha no puede ser futura"); `textoCambio` con antes/después de `cliente_nombre` y `precio_total` da dos renglones y omite los iguales.
- [ ] **Step 2:** `node --test tests/` — Expected: falla con `Cannot find module '../bma-logica.js'`.
- [ ] **Step 3: Implementar `bma-logica.js`.**
- [ ] **Step 4:** `node --test tests/` — Expected: todas pasan.
- [ ] **Step 5: Commit** `Lógica de las pantallas de ventas, probada sin navegador`.

---

### Task 3: Armazón: pestañas nuevas, utilidades de pantalla y estilos

**Files:**
- Create: `bma-ui.js` (`window.UI`: `abrirLista({titulo, grupos:[{titulo, opciones:[{valor,nombre,detalle,n}]}], elegido}) -> Promise`, `pedirTexto({titulo, valor, placeholder}) -> Promise`, `pedirMonto({titulo, valor}) -> Promise<number|null>`, `confirmar({titulo, texto, boton}) -> Promise<bool>`, `llamar(nombre, args) -> Promise<data>` (rpc con manejo de error: 42501 → sale de la sesión; otro → aviso con el mensaje de la base), `guardar(nombre, args)` (= `llamar` con el candado de localhost))
- Create: `ventas.css`
- Modify: `index.html` (cargar `bma-logica.js`, `bma-ui.js`, `ventas.js`, `personas.js`, `dudas.js`, `ventas.css` con `?v=1`; pestañas **Ventas · Personas · Dudas (n)** antes de las viejas; al entrar abre Ventas; contenedores `#mod-ventas`, `#mod-personas`, `#mod-dudas`)

- [ ] **Step 1:** Copiar y adaptar de `Logistica/inventario.js` la hoja (abrir/cerrar, Escape, clic fuera) y `abrirLista`, `pedirTexto`, `pedirCantidad`→`pedirMonto`, `confirmar`, con sus estilos de `Logistica/inventario.css` pasados a los tokens de esta app.
- [ ] **Step 2:** Pestañas nuevas y arranque: después de `abrirSesion()`, `selModulo('ventas')`; el número de Dudas sale de `bma_dudas('pendiente').length`.
- [ ] **Step 3: Verificar en el navegador** (`preview_start grupo-bma`, ya con sesión de admin): las tres pestañas aparecen, la lista para escoger abre y cierra con Escape, consola sin errores, 375 px sin desbordar.
- [ ] **Step 4: Commit** `Pestañas de Ventas, Personas y Dudas, y utilidades de pantalla`.

---

### Task 4: Personas

**Files:**
- Create: `personas.js` (`window.Personas = {pintar(), abrir(id), escoger({tipo}) -> Promise<persona|null>}`; `escoger` es el buscador con "Nueva persona" que usan Ventas y Registrar)

- [ ] **Step 1: Lista** con buscador (nombre o número) y filtro de tipo (Todos · Clientes · Empleados · Vendedores); renglón: número, nombre, tipos, sucursal, cuántas compras/ventas.
- [ ] **Step 2: Ficha**: datos (número, nombre, tipos, teléfono, sucursal, notas) con Editar; si es cliente, sus compras con pagado/saldo (clic abre la venta); si es vendedor, lo que vendió; cambios de la bitácora.
- [ ] **Step 3: Nueva persona**: nombre, tipos (escoger varios), teléfono, sucursal, notas → Guardar; el número lo da la base.
- [ ] **Step 4: Verificar en el navegador** (lectura): abrir un vendedor importado (sus ventas se ven como lista; abrir la ficha llega en Task 5); recorrer "Nueva persona" hasta el candado y cancelar. Consola limpia; 375 px.
- [ ] **Step 5: Commit** `Personas: cada una con su ficha e historial`.

---

### Task 5: Ventas: buscador, lista y ficha con historial

**Files:**
- Create: `ventas.js` (`window.Ventas = {pintar(), abrir(id)}`)
- Modify: `ventas.css`

**Interfaces:**
- Consumes: `bma_ventas_buscar`, `bma_venta`, `bma_venta_editar`, `bma_movimiento_corregir`, `bma_movimiento_eliminar` (Task 1); `BMA.*` (Task 2); `UI.*` (Task 3); `Personas.escoger` (Task 4).

- [ ] **Step 1: Lista.** Arriba un solo buscador (busca al escribir, 300 ms) y dos filtros rápidos con la lista para escoger: Sucursal (Todas + 11) y Estado (Abiertas por defecto · Cerradas · Canceladas · Todas). Renglones: folio y sucursal, producto, cliente (o "Sin cliente"), último movimiento, pagado y estado; marca de duda si tiene. En celular, tarjeta por renglón.
- [ ] **Step 2: Ficha** (pantalla completa, botón Volver): encabezado con producto, folio, sucursal, remisión, factura, cliente, vendedor y estado; tres cifras: Precio (o "Por confirmar") · Pagado · Saldo. Historial de movimientos en orden de fecha: fecha, tipo, monto, método y cuenta, "✓ banco" si está confirmado, nota, y quién lo registró. Debajo, "Cambios" de la bitácora con `BMA.textoCambio` y quién/cuándo. Si hay dudas, un aviso arriba con su texto.
- [ ] **Step 3: Editar** desde la ficha: cliente (buscador de personas + "Nueva persona"), vendedor, precio, producto, remisión, factura, color — cada uno abre su hoja; guarda con `UI.guardar('bma_venta_editar', …)` y repinta. En cada movimiento: Corregir (fecha, monto, método, cuenta, nota, banco) y, solo admin, Eliminar con `confirmar`.
- [ ] **Step 4: Verificar en el navegador** (solo lectura sobre datos reales): buscar un folio, una remisión con prefijo ("NV …") y un producto; abrir una venta con anticipo y liquidación y ver su historial completo; con una venta cuyo producto tenga comillas o `<`, se ve como texto (o se comprueba con `BMA.esc` en consola). Consola sin errores; 375 px sin desbordar. Correr el detector de Impeccable sobre `ventas.css`/`ventas.js`.
- [ ] **Step 5: Commit** `Ventas: buscador y ficha con el historial de cada venta`.

---

### Task 6: Registrar venta nueva y movimiento

**Files:**
- Modify: `ventas.js` (botón **Registrar** arriba de la lista y **Agregar movimiento** en la ficha)

**Interfaces:**
- Consumes: `bma_venta_nueva`, `bma_movimiento_nuevo`, `bma_personas_buscar`, `bma_persona_guardar` (Task 1); `BMA.validarMovimiento`, `BMA.TIPOS`, `BMA.METODOS` (Task 2); `Personas.escoger` (Task 4).

- [ ] **Step 1: Registrar** pregunta primero "¿Venta nueva o movimiento de una venta?". Movimiento → buscador de ventas (el mismo de la lista) → abre "Agregar movimiento" de esa venta.
- [ ] **Step 2: Venta nueva**, paso a paso con barra de pasos ("1 Venta · 2 Pago · 3 Guardar"): sucursal → fecha (hoy por defecto) → producto (texto) y línea (Motos/Pasto/Otro) → cliente (obligatorio: buscar o "Nueva persona") → vendedor (opcional) → remisión y factura → precio total (opcional para anticipo) → Pago: tipo Contado o Anticipo, monto, método, cuenta, nota → resumen en palabras ("Contado de $41,000.00 en transferencia a Santander por MC 200 PICK UP para Ana López, AGS") → Guardar. Al guardar abre la ficha nueva.
- [ ] **Step 3: Agregar movimiento** en la ficha: tipo (lista con los de `BMA.TIPOS`; sin dinero en entrega y cancelación), monto, método, cuenta, fecha, nota → resumen → Guardar → repinta la ficha.
- [ ] **Step 4: Verificar en el navegador** sin guardar: recorrer ambos flujos hasta el resumen y comprobar que el candado de localhost pide confirmación; cancelar ahí. Validaciones: sin monto o sin método no deja avanzar. (El guardado ya está probado en SQL; guardar de verdad solo si el usuario lo autoriza.)
- [ ] **Step 5: Commit** `Registrar ventas nuevas y movimientos paso a paso`.

---

### Task 7: Dudas

**Files:**
- Create: `dudas.js` (`window.Dudas = {pintar(), contar()}`)

- [ ] **Step 1: Lista** agrupada por motivo (texto de `BMA.MOTIVOS`, con cuántas hay), subpestañas Pendientes · Resueltas; cada duda muestra su detalle y su venta (clic abre la ficha).
- [ ] **Step 2: Resolver**: "Unir a otra venta" (buscador de ventas → confirmar → `bma_duda_resolver(id, venta)`) o "Está bien así" (nota opcional → `bma_duda_resolver(id, null, nota)`). Antes de resolver la **primera** duda, avisar: "Al resolver dudas ya no se puede repetir la importación." El número de la pestaña baja.
- [ ] **Step 3: Verificar en el navegador** (lectura): la lista cuadra con `bma_dudas` (307 al empezar), agrupada; recorrer "Unir a otra venta" hasta el confirmar y cancelar.
- [ ] **Step 4: Documentar y commit**: `CLAUDE.md` (sección Interfaz y Base de datos: pestañas nuevas, archivos, funciones nuevas, candado de localhost, que resolver dudas cierra la importación). Commit `Dudas de la importación para revisar con Silvia`.

---

### Task 8: Revisión y salida

- [ ] **Step 1:** Suite completa: `node --test tests/`, `python -m unittest discover -s importar`, y las tres pruebas SQL con `execute_sql`. Expected: todo verde.
- [ ] **Step 2:** Revisión independiente de la rama (superpowers:requesting-code-review), con la Review Focus de arriba.
- [ ] **Step 3:** Revisar que no haya nombres reales ni correos en lo que se va a subir (`git grep` sobre el rango de la rama).
- [ ] **Step 4:** Push a `main` solo con el OK del usuario; comprobar que la página en vivo carga los archivos nuevos (`?v=`).
