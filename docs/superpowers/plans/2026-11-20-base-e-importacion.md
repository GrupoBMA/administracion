# Base de datos, inicio de sesión e importación de 2026 — plan de trabajo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que exista la base de Grupo BMA en Supabase con usuarios, ventas, movimientos, personas y bitácora; que la app pida iniciar sesión; y que las ventas de 2026 de los 6 Excel de Silvia queden cargadas e hiladas, con su lista de dudas.

**Architecture:** Esquema `bma` en el proyecto de Supabase de GVF, **sin exponerlo en la API**: la app solo entra por funciones `public.bma_*` (`security definer`) que revisan la sesión en `bma.usuarios`, igual que Logística. La importación es un script de Python local (`importar/`) que lee los Excel de Silvia, hila las ventas y genera SQL por partes en `.local/importacion/`; ese SQL se carga con `execute_sql` de Supabase.

**Tech Stack:** Postgres (Supabase), Python 3 con `openpyxl` y `unittest` (biblioteca estándar), HTML/JS de la app con `@supabase/supabase-js@2.45.4` de jsdelivr.

**Spec:** `docs/superpowers/specs/2026-11-19-ventas-silvia-design.md` (etapas 1 y 2). Las pantallas de ventas y personas (etapas 3 y 4) van en el siguiente plan.

## Global Constraints

- Repo público: ningún dato real, clave secreta ni contraseña en el código. Los Excel y el SQL generado viven en `.local/` (ignorada por git).
- Proyecto Supabase `jlfendrdwptwmttrahre`; URL `https://jlfendrdwptwmttrahre.supabase.co`; llave pública `sb_publishable_RNnR7jV42dGEGLFWdRVfvQ_cP1xSwuO` (la misma que Logística, pública por diseño).
- **Ruling:** el diseño decía "esquema `bma` expuesto en la API con RLS". Se sigue el patrón de Logística: esquema **no** expuesto, `revoke all` a `anon` y `authenticated`, acceso solo por funciones `public.bma_*` con `set search_path to ''`. Es más estricto; si se equivoca, el costo es agregar funciones, no una fuga.
- Solo entran cuentas en `bma.usuarios`, con rol `admin` o `captura`.
- Nadie borra de verdad salvo el admin; todo alta, cambio o baja en `personas`, `ventas` y `movimientos` queda en `bma.bitacora` por trigger.
- El Drive nunca se modifica. Los Excel de Silvia se leen de una copia.
- Todo en español: tablas, columnas, funciones, mensajes.
- Sucursales que se importan: AGS, MAZ, MLM, PUE, QRO, TEP. GDL, ZAP, NAU, LPZ y TIJ existen en el catálogo pero empiezan vacías.
- La importación se puede repetir **solo** mientras no haya nada capturado a mano (`origen = 'capturada'`) ni cambios de usuarios en la bitácora.

## Review Focus

1. **La misma remisión en años o líneas distintas** (la 87 en un motocarro de 2025 y en pasto de 2026) no debe unir esas ventas. Prueba en Task 3: `test_remision_repetida_otro_anio_no_une` y `test_remision_repetida_otra_linea_no_une`.
2. **Fechas mal capturadas** ("2 oct" en la pestaña del 2 de noviembre) no deben desordenar el hilado: se ordena por el lunes de la pestaña y luego por fila. Prueba en Task 3: `test_orden_por_semana_no_por_fecha`.
3. **Métodos mal escritos** ("EFCTIVO", "TRANSFERENCOA", "EFECTIVO ") entran al método correcto. Prueba en Task 2: `test_metodo_mal_escrito`.
4. **Importar dos veces** no duplica: la carga empieza borrando lo importado y se niega si ya hay algo capturado. Prueba en Task 1 (SQL): caso "no deja borrar lo importado si ya hay captura".
5. **Montos con formato raro** ("$1,500", "1500.0", texto vacío) y renglones con monto 0 que sí importan (canceladas, solo entrega). Prueba en Task 2: `test_montos` y `test_cancelada_sin_monto_se_lee`.

---

### Task 1: Esquema `bma`, bitácora y sesión

**Files:**
- Create: `supabase/sql/2026-11-20-bma-base.sql` (copia exacta de la migración aplicada)
- Create: `tests/bma-base.sql`

**Interfaces:**
- Produces (tablas, todas con `id uuid primary key default gen_random_uuid()` salvo donde se dice):
  - `bma.usuarios(user_id uuid pk references auth.users, nombre text not null, rol text not null check (rol in ('admin','captura')))`
  - `bma.sucursales(clave text pk, nombre text not null, odoo_almacen text)` sembrada con AGS Aguascalientes S-AGS, GDL Guadalajara S-WAS, MAZ Mazatlán S-MAZ, MLM Morelia S-MOR, PUE Puebla S-PUE, QRO Querétaro S-QRO, TEP Tepic S-TEP, ZAP Zapopan S-ZAP, NAU Naucalpan S-NAU, LPZ La Paz S-LPZ, TIJ Tijuana S-TIJ.
  - `bma.personas(id, numero int not null unique default nextval('bma.personas_numero'), nombre text not null, tipos text[] not null check (tipos <@ array['cliente','empleado','vendedor'] and cardinality(tipos) > 0), telefono text, sucursal text references bma.sucursales, notas text, origen text not null default 'capturada' check (origen in ('importada','capturada')), creado_por uuid default auth.uid(), creado_en timestamptz not null default now())`
  - `bma.ventas(id, folio text not null unique, sucursal text not null references bma.sucursales, fecha date not null, cliente_id uuid references bma.personas, vendedor_id uuid references bma.personas, producto text not null, categoria text, linea text not null check (linea in ('motos','pasto','otro')), remision text, factura text, color text, precio_total numeric(12,2), estado text not null check (estado in ('abierta','cerrada','cancelada')), origen text not null default 'capturada' check (...), creado_por uuid default auth.uid(), creado_en timestamptz not null default now())`
  - `bma.movimientos(id, venta_id uuid not null references bma.ventas on delete restrict, fecha date not null, lunes date not null, tipo text not null check (tipo in ('contado','anticipo','abono','liquidacion','cancelacion','entrega')), monto numeric(12,2) not null default 0 check (monto >= 0), metodo text check (metodo in ('efectivo','transferencia','tarjeta','deposito','mercado_pago','cheque')), cuenta text, confirmado_banco boolean not null default false, nota text, origen text not null default 'capturada', origen_ref jsonb, creado_por uuid default auth.uid(), creado_en timestamptz not null default now())`
  - `bma.apartados(id, tipo text not null check (tipo in ('prestamo','inventario','otro')), sucursal text references bma.sucursales, fecha date, lunes date, monto numeric(12,2), datos jsonb not null, origen_ref jsonb)`
  - `bma.dudas_importacion(id, venta_id uuid references bma.ventas, movimiento_id uuid references bma.movimientos, motivo text not null check (motivo in ('sin_anticipo','varias_candidatas','sin_tipo_pago','entrega_sin_venta','cancelada_sin_venta','vendedor_parecido','sin_remision')), detalle text not null, estado text not null default 'pendiente' check (estado in ('pendiente','resuelta')), resuelta_por uuid, resuelta_en timestamptz)`
  - `bma.bitacora(id bigint generated always as identity primary key, tabla text not null, registro_id uuid not null, accion text not null check (accion in ('alta','cambio','baja')), antes jsonb, despues jsonb, usuario uuid default auth.uid(), fecha timestamptz not null default now())`
  - Trigger `bma.anotar()` after insert/update/delete en `personas`, `ventas`, `movimientos`; **no anota** cuando `current_setting('bma.importando', true) = 'si'`.
  - `public.bma_sesion() returns jsonb` → `{"nombre":…, "rol":…}`; si la cuenta no está en `bma.usuarios`, `raise exception using errcode = '42501'`.
  - `public.bma_borrar_importado() returns jsonb` (solo para correr como `postgres` desde la carga; `revoke execute` a `anon`/`authenticated`): si existe algún renglón con `origen = 'capturada'` en `ventas`, `movimientos` o `personas`, o alguna fila de `bitacora`, lanza excepción `'ya hay captura: la importación está cerrada'`; si no, borra `dudas_importacion`, `apartados`, `movimientos`, `ventas` y `personas` importadas y regresa los conteos borrados.
  - `revoke all on schema bma from anon, authenticated` y lo mismo en todas sus tablas y secuencias.

- [ ] **Step 1: Escribir `tests/bma-base.sql`** con el mismo armazón que `Logistica/tests/inventario.sql` (`begin`, tabla temporal `r`, `pg_temp.como(email)`, `pg_temp.anota`, `rollback`). Casos, cada uno una fila `ok`:
  - "anon no lee bma.ventas": como `anon`, `select` a `bma.ventas` lanza `insufficient_privilege`.
  - "cuenta sin alta no entra": crear con `insert into auth.users` una cuenta de prueba dentro de la transacción, `bma_sesion()` lanza `42501`.
  - "cuenta dada de alta entra con su rol": insertarla en `bma.usuarios` con rol `captura`, `bma_sesion()->>'rol' = 'captura'`.
  - "alta de venta queda en bitácora": insertar persona, venta y movimiento como `postgres` con `bma.importando` sin poner; hay 3 filas `alta` en `bitacora`.
  - "cambio guarda antes y después": `update` del cliente de la venta; la fila `cambio` tiene `antes->>'cliente_id'` nulo y `despues->>'cliente_id'` lleno.
  - "importando no anota": con `set_config('bma.importando','si',true)`, insertar otra venta; la bitácora no crece.
  - "no deja borrar lo importado si ya hay captura": con una venta `capturada`, `bma_borrar_importado()` lanza excepción.
  - "borra lo importado cuando no hay captura": en un escenario solo con importados (sin bitácora), regresa conteos > 0 y las tablas quedan vacías de importados.
  - "monto negativo se rechaza" y "tipo de movimiento inválido se rechaza".

- [ ] **Step 2: Correr las pruebas antes de crear nada**
  Run: `execute_sql` con el contenido de `tests/bma-base.sql`.
  Expected: error `schema "bma" does not exist`.

- [ ] **Step 3: Escribir `supabase/sql/2026-11-20-bma-base.sql`** con todo lo del bloque Interfaces y aplicarlo con `apply_migration` (nombre `bma_base`). Cabecera de comentarios como la de Logística: qué es, cuándo se aplicó, que nadie lee las tablas directo.

- [ ] **Step 4: Correr las pruebas**
  Run: `execute_sql` con `tests/bma-base.sql`.
  Expected: todas las filas `ok = true`; nada queda guardado (termina en `rollback`).

- [ ] **Step 5: Revisar avisos de seguridad**
  Run: `get_advisors` tipo `security`.
  Expected: ningún aviso nuevo sobre el esquema `bma` ni sobre las funciones `bma_*`.

- [ ] **Step 6: Commit**
  `git add supabase/sql/2026-11-20-bma-base.sql tests/bma-base.sql` · mensaje `Base de Grupo BMA en Supabase: ventas, movimientos, personas y bitácora`.

---

### Task 2: Lector de los Excel de Silvia

**Files:**
- Create: `importar/lector.py`
- Create: `importar/test_lector.py`

**Interfaces:**
- Produces:
  - `leer_libro(ruta: str, sucursal: str) -> list[dict]`: un dict por renglón de cobro, en orden de pestaña y fila, con llaves `sucursal, lunes (date), hoja (str), fila (int), fecha (date|None), categoria, producto, pago, metodo, ok (bool), cuenta, monto (float), remision, factura, color, gs, vendedor, descripcion` (textos ya normalizados: mayúsculas, sin acentos, sin espacios dobles; `remision`/`factura` sin `.0`).
  - `lunes_de_hoja(nombre: str) -> date|None`: "AGS 44  26-31oct26" → 2026-10-26; "AGS 52  22-27dic25" → 2025-12-22; "AGS 01  29-03ene26" → 2025-12-29. Regla: si el sufijo de año es 25 y la semana es 52 → 2025-12-22; si no, `2025-12-29 + 7*(semana-1)`. Pestañas sin número de semana (Hoja…, Copia…) se ignoran.
  - `metodo_catalogo(txt: str) -> str|None`: devuelve uno de `efectivo, transferencia, tarjeta, deposito, mercado_pago, cheque`, `prestamo` (marca de préstamo, no se guarda como método), o `None`; tolera espacios, acentos y una o dos letras mal (distancia de edición ≤ 2 contra el nombre).
  - `monto(v) -> float|None`: acepta número, "$1,500", "1500.0"; vacío → `None`.
- Reglas: las columnas se ubican por su título (fila que tiene CATEGORIA, PRODUCTO y METODO); la columna de "OK" es la que está justo a la derecha de METODO; el MONTO de cobros es el primero a la derecha de METODO; la lista termina donde aparece INVENTARIO o un título que empiece con EGRESOS. Un renglón entra si tiene producto o monto; los de monto vacío entran solo si su pago es cancelada/cancelado/solo entrega/solo factura.

- [ ] **Step 1: Escribir `importar/test_lector.py`** (`unittest`). Un helper arma con `openpyxl` un libro falso en un `TemporaryDirectory` con dos pestañas ("XXX 44  26-31oct26" y "XXX 52  22-27dic25") y el encabezado en otro orden de columnas en cada una. Datos inventados, nunca reales. Pruebas:
  - `test_lunes_de_hoja`: los tres ejemplos de arriba, y "Hoja 3" → `None`.
  - `test_columnas_por_titulo`: en las dos pestañas se lee el mismo renglón igual, aunque las columnas estén en distinto lugar.
  - `test_ok_y_cuenta`: un renglón con "OK" y "HSBC" da `ok=True, cuenta='HSBC'`.
  - `test_metodo_mal_escrito`: "EFCTIVO" → efectivo, "TRANSFERENCOA" → transferencia, "EFECTIVO " → efectivo, "Depósito" → deposito.
  - `test_montos`: "$1,500" → 1500.0, 1500.0 → 1500.0, "" → None.
  - `test_cancelada_sin_monto_se_lee`: un renglón CANCELADA sin monto aparece con `monto=None`.
  - `test_termina_en_inventario`: los renglones debajo de INVENTARIO no se leen.
  - `test_remision_sin_punto_cero`: 101.0 → "101".

- [ ] **Step 2: Correr y ver que fallan**
  Run: `python -m unittest discover -s importar -p "test_lector.py" -v`
  Expected: `ModuleNotFoundError: No module named 'lector'`.

- [ ] **Step 3: Implementar `importar/lector.py`** con las cuatro funciones; `openpyxl.load_workbook(ruta, read_only=True, data_only=True)`, máximo 400 filas por pestaña.

- [ ] **Step 4: Correr y ver que pasan**
  Run: `python -m unittest discover -s importar -p "test_lector.py" -v`
  Expected: todas OK.

- [ ] **Step 5: Probar contra una copia real sin imprimir datos**
  Copiar `FImpAGS-2026.xlsx` a `.local/silvia/` y correr `python -c` que imprima solo: número de renglones, número de pestañas leídas, conteo por `pago`, cuántos `metodo` quedaron en `None`.
  Expected: ~714 renglones y 45 pestañas para AGS; métodos en `None` solo en renglones sin dinero.

- [ ] **Step 6: Commit** `importar/lector.py importar/test_lector.py` · `Importación: lector de los Excel de Silvia`.

---

### Task 3: Hilar las ventas

**Files:**
- Create: `importar/hilar.py`
- Create: `importar/test_hilar.py`

**Interfaces:**
- Consumes: renglones de `leer_libro` (Task 2).
- Produces: `hilar(renglones: list[dict]) -> dict` con llaves:
  - `ventas`: lista de dicts `{id (uuid str), folio, sucursal, fecha, producto, categoria, linea, remision, factura, color, vendedor (texto), precio_total (float|None), estado}`
  - `movimientos`: `{id, venta_id, fecha, lunes, tipo, monto, metodo, cuenta, confirmado_banco, nota, origen_ref {archivo, hoja, fila}}`
  - `apartados`: `{id, tipo, sucursal, fecha, lunes, monto, datos, origen_ref}`
  - `dudas`: `{id, venta_id|None, movimiento_id|None, motivo, detalle}`
  - `vendedores`: `{nombre_normalizado: id}`
- Helpers públicos: `linea_de(categoria, producto) -> 'motos'|'pasto'|'otro'` (PASTO/MTS/M2 → pasto; ENVIO/FLETE → otro; lo demás motos), `nota_anticipo(descripcion) -> dict|None` (lee "ANT 18 DIC REM 03 $8,000" y "ANT 12 OCT NV 101" → `{dia, mes, remision, monto|None}`), `parecido(a, b) -> float` (0–1, `difflib.SequenceMatcher` sobre los textos normalizados).

**Reglas (en orden; se procesan los renglones ordenados por `lunes`, luego `fila`):**
1. Préstamo (`metodo_catalogo` = prestamo, o PRESTAMO en categoría/producto) → `apartados` tipo `prestamo`. Salida o entrada de mercancía sin dinero → `apartados` tipo `inventario`.
2. Llave de venta = `(sucursal, linea, remision)`; solo existe si hay remisión.
3. **Liquidación o abono:** candidatas = ventas abiertas con la misma llave, con fecha dentro de los 180 días anteriores. Si la descripción trae `nota_anticipo` y alguna candidata tiene un anticipo con ese día/mes (y monto, si viene), esa gana. Si no, gana la de mayor `parecido` de producto (≥ 0.5); si empatan, la más reciente y se anota duda `varias_candidatas`. Sin candidata → venta nueva y duda `sin_anticipo`. Liquidación cierra la venta; abono la deja abierta.
4. **Anticipo:** si hay venta abierta con la misma llave, producto parecido (≥ 0.5) y anticipo en los últimos 120 días, se agrega como otro anticipo; si no, venta nueva abierta.
5. **Contado:** venta nueva cerrada. Excepción: producto que empieza con COMPLEMENTO se agrega a la venta con la misma llave de esa semana o, si no tiene remisión, a la venta del renglón anterior de la misma pestaña.
6. **Cancelada/cancelado:** movimiento `cancelacion` en la venta abierta con la misma llave; si no hay, venta nueva cancelada y duda `cancelada_sin_venta`.
7. **Solo entrega / solo factura:** movimiento `entrega` (monto 0) en la venta con la misma llave; si no hay, duda `entrega_sin_venta` (sin venta).
8. Pago vacío: si el producto está vacío o empieza con COMPLEMENTO → regla 5; si no, contado con duda `sin_tipo_pago`.
9. Liquidación sin remisión y sin nota → venta nueva y duda `sin_remision`.
- Precio total: venta cerrada → suma de sus movimientos con dinero; abierta → `None`.
- Folio: `SUC-AAAA-NNNN`, consecutivo por sucursal y año de la fecha de la venta, en orden de fecha.
- `confirmado_banco` = `ok` del renglón.
- Vendedores: un id por nombre normalizado. Si un nombre es inicio de otro ("ANA" y "ANABEL RUIZ"), no se juntan y se anota duda `vendedor_parecido`.

- [ ] **Step 1: Escribir `importar/test_hilar.py`**, con renglones armados a mano (helper `r(**campos)` con valores por defecto). Pruebas:
  - `test_contado_es_venta_cerrada`: 1 venta, estado cerrada, precio = monto.
  - `test_anticipo_y_liquidacion_se_unen`: anticipo s40 rem 101 + liquidación s44 rem 101 → 1 venta cerrada con 2 movimientos y precio = suma.
  - `test_nota_de_silvia_elige_el_anticipo`: dos anticipos abiertos con rem 87 (productos distintos); la liquidación con "ANT 12 OCT REM 87 $8,000" se une al del 12 de octubre.
  - `test_remision_repetida_otro_anio_no_une`: anticipo de 2025 rem 87 y liquidación 200 días después → no se unen, duda `sin_anticipo`.
  - `test_remision_repetida_otra_linea_no_une`: anticipo de pasto rem 87 y liquidación de motocarro rem 87 → no se unen.
  - `test_orden_por_semana_no_por_fecha`: liquidación en la pestaña s45 con fecha "2 oct" (error de captura) se une al anticipo de s43.
  - `test_abono_deja_abierta`: anticipo + abono → abierta, precio `None`.
  - `test_complemento_se_suma`: contado rem 124 + "COMPLEMENTO CANCUN" sin remisión en el renglón siguiente → 1 venta con 2 movimientos.
  - `test_prestamo_va_a_apartados`: no crea venta.
  - `test_cancelada_sin_venta`: venta cancelada + duda.
  - `test_folios_consecutivos`: dos ventas de AGS en 2026 → AGS-2026-0001 y AGS-2026-0002 en orden de fecha.
  - `test_vendedor_parecido`: "ANA" y "ANABEL RUIZ" → 2 vendedores y 1 duda.

- [ ] **Step 2: Correr y ver que fallan**
  Run: `python -m unittest discover -s importar -p "test_hilar.py" -v`
  Expected: `ModuleNotFoundError: No module named 'hilar'`.

- [ ] **Step 3: Implementar `importar/hilar.py`** con `hilar` y sus tres helpers; ids con `uuid.uuid4()`.

- [ ] **Step 4: Correr y ver que pasan**
  Run: `python -m unittest discover -s importar -v`
  Expected: todas OK (lector e hilar).

- [ ] **Step 5: Medir contra la copia real sin imprimir datos**
  Correr sobre `.local/silvia/FImpAGS-2026.xlsx` y `FImpQRO-2026.xlsx`, imprimiendo solo conteos: ventas, cerradas, abiertas, canceladas, dudas por motivo, y cuántos anticipos quedaron unidos a una liquidación.
  Expected: AGS ≥ 52 de 82 anticipos unidos y QRO ≥ 36 de 38 (la línea base medida el 19-nov solo con la remisión). Si queda por debajo, revisar la regla con `systematic-debugging` antes de seguir.

- [ ] **Step 6: Commit** `importar/hilar.py importar/test_hilar.py` · `Importación: hilar anticipos, abonos y liquidaciones`.

---

### Task 4: Carga a Supabase y la importación real

**Files:**
- Create: `importar/cargar.py`
- Create: `importar/test_cargar.py`
- Modify: `CLAUDE.md` (sección nueva "Base de datos e importación")

**Interfaces:**
- Consumes: `leer_libro` (Task 2), `hilar` (Task 3), tablas y `public.bma_borrar_importado()` (Task 1).
- Produces:
  - `sql_por_partes(resultado: dict, max_bytes: int = 900_000) -> list[str]`: la primera parte empieza con `select public.bma_borrar_importado();` y `select set_config('bma.importando','si',false);`; luego `insert` en orden `personas` (vendedores, tipos `{vendedor}`, origen `importada`), `ventas`, `movimientos`, `apartados`, `dudas_importacion`; cada parte cabe en `max_bytes`; textos escapados con comillas dobladas; `origen = 'importada'` en todo.
  - `main()`: lee los 6 archivos de `.local/silvia/` (`FImp{SUC}-2026.xlsx`), hila todo junto, escribe `.local/importacion/parte-NN.sql` y `.local/importacion/resumen.txt` (conteos por sucursal: ventas, cerradas, abiertas, canceladas, movimientos, suma de montos, dudas por motivo).

- [ ] **Step 1: Escribir `importar/test_cargar.py`**:
  - `test_primera_parte_borra_e_importa`: la parte 1 empieza con las dos llamadas de arriba.
  - `test_escapa_comillas`: un producto `O'HARA` sale como `'O''HARA'`.
  - `test_partes_no_pasan_el_limite`: con `max_bytes=2000` y 50 ventas falsas, cada parte ≤ 2000 bytes y la suma de inserts = 50.
  - `test_origen_importada`: todo insert de ventas y movimientos lleva `'importada'`.

- [ ] **Step 2: Correr y ver que fallan**
  Run: `python -m unittest discover -s importar -p "test_cargar.py" -v`
  Expected: `ModuleNotFoundError: No module named 'cargar'`.

- [ ] **Step 3: Implementar `importar/cargar.py`.**

- [ ] **Step 4: Correr toda la suite**
  Run: `python -m unittest discover -s importar -v`
  Expected: todas OK.

- [ ] **Step 5: Generar la importación real**
  Copiar los 6 `FImp*-2026.xlsx` de `Downloads/Reportes Silvia` a `.local/silvia/` y correr `python -I importar/cargar.py`.
  Expected: archivos `parte-NN.sql` y `resumen.txt` en `.local/importacion/`; `git status` no muestra nada de `.local/`.

- [ ] **Step 6: Cargar parte por parte** con `execute_sql`, en orden.
  Expected: ninguna parte falla.

- [ ] **Step 7: Verificar que lo cargado cuadra con el Excel**
  Run: `execute_sql` con conteo de ventas y suma de `monto` de movimientos por sucursal, y conteo de dudas por motivo.
  Expected: igual a `resumen.txt`. La suma de montos por sucursal = suma de los cobros con dinero del Excel menos lo apartado (el script la imprime en el resumen).

- [ ] **Step 8: Documentar y commit**
  En `CLAUDE.md`: esquema `bma` y sus funciones, cómo se corre la importación, que se cierra en cuanto Silvia capture, y que los datos viven solo en Supabase y `.local/`. Commit `importar/cargar.py importar/test_cargar.py CLAUDE.md` · `Importación de 2026 a Supabase`.

---

### Task 5: Inicio de sesión en la app

**Files:**
- Modify: `index.html` (cabecera de scripts, pantalla de entrada, arranque `iniciar()`)
- Modify: `CLAUDE.md` (sección Interfaz)

**Interfaces:**
- Consumes: `public.bma_sesion()` (Task 1).
- Produces: `sb` (cliente de Supabase) y `SESION = {nombre, rol}` globales, que usará el siguiente plan.

- [ ] **Step 1: Agregar** `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js">` y crear `sb` con la URL y llave de Global Constraints y `{auth:{persistSession:true, autoRefreshToken:true}}`.

- [ ] **Step 2: Pantalla de entrada** antes de todo lo demás: campo "Correo" (si no lleva `@`, se completa con `@administracion.bma`, como Logística hace con su dominio), "Contraseña" y botón "Entrar". Error: "Correo o contraseña incorrectos." Botón "Salir" en el encabezado cuando hay sesión. Mismo estilo de la app (tokens actuales, modo oscuro).

- [ ] **Step 3: Arranque:** al cargar, si hay sesión → `sb.rpc('bma_sesion')`; con `42501` → `signOut` y el mensaje "Esta cuenta no tiene acceso a la administración."; con éxito → guardar `SESION` y seguir con el arranque actual (`iniciar()`). Sin sesión, las pestañas actuales no se muestran.

- [ ] **Step 4: Verificar en el navegador de la app** (`preview_start` con la configuración de `.claude/launch.json`, puerto 8765):
  - Sin sesión se ve solo la pantalla de entrada; `read_console_messages` sin errores.
  - Con un correo cualquiera y una contraseña falsa sale "Correo o contraseña incorrectos." (no se usan contraseñas reales).
  - El usuario entra con su cuenta, ya dada de alta en `bma.usuarios` como `admin`, y ve las pestañas de siempre. Yo no escribo contraseñas: le pido que entre él.
  - En celular (375 px) la pantalla de entrada no se sale del ancho.

- [ ] **Step 5: Dar de alta las cuentas** en `bma.usuarios` (con `execute_sql`, buscando por correo en `auth.users`): la del usuario como `admin` y la de Silvia como `captura`. El usuario dice los correos; nunca las contraseñas.

- [ ] **Step 6: Commit sin push** `index.html CLAUDE.md` · `Inicio de sesión: solo entran cuentas dadas de alta en Grupo BMA`. Push a `main` solo con el OK del usuario, porque sale en vivo.
