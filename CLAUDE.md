# CLAUDE.md

Guía para Claude Code en la app de **Grupo BMA**. Todo en español (UI, datos, comentarios y nombres de funciones), igual que la app de GVF.

**Regla de mantenimiento:** cada cambio significativo al código de la app se documenta aquí en el mismo commit. El proyecto se está definiendo poco a poco; lo que todavía no se sabe se marca como *pendiente* en vez de suponerlo.

## Qué es

App web en HTML, parecida a la de GVF (`../../Aplicación GVF`), para administrar las cinco empresas del grupo:

| Empresa | Clave | Giro | Notas |
|---|---|---|---|
| SUNL | `sunl` | Importación y venta de motos | También se le dice "Motos con Fuerza" (así aparece en su constancia fiscal) |
| Alzator | `alzator` | Importación y venta de maquinaria pesada | Razón social Alzator SA de CV |
| Pastito | `pastito` | Importación y venta de follaje artificial | |
| Rocket | `rocket` | Venta de canchas de pádel | Modelo de negocio por confirmar |
| Melamina | `melamina` | Importación y venta de melamina en paquetes grandes | No es empresa formal; presentación (rollos o tablas) por confirmar |

La clave es la que se guardará en los registros. El catálogo vive en el arreglo `EMPRESAS` de `index.html`. **Por ahora todo se maneja como un solo negocio** (decisión del 3-nov-2026): no hay selector de empresa.

Producto, usuario y principios: ver `PRODUCT.md`. Diseño: muy minimalista, amable e intuitivo; sin leyendas salvo que de verdad hagan falta. En cambios visuales usar el skill Impeccable (modo Operate) y correr su detector.

## Regla estricta: el Drive es de solo lectura

**Prohibido modificar, mover o borrar cualquier archivo del Drive** (ni los Excel de las sucursales ni nada más), tanto desde la app como al trabajar con Claude. Solo se extrae. La app lee el Drive con permiso `drive.readonly` (Google bloquea cualquier escritura) o abre archivos locales con un `<input type=file>`; no sube ni escribe nada. Al probar, trabajar sobre copias en `.local/` (ignorada por git) y borrarlas al terminar.

## Estado actual (3-nov-2026; ver "Base de datos e inicio de sesión" para lo del 20-nov)

`index.html` lee los reportes semanales de las sucursales y muestra cuatro pestañas con **vista general, sin semanas** (decisión del 3-nov-2026): **Caja**, **Cobros**, **Gastos** y **Revisar**. Sin Supabase ni inicio de sesión todavía.

### Cómo son los reportes
Un Excel por sucursal (`Reporte2026-<SUC> ….xlsx`, la sucursal sale del nombre del archivo), una pestaña por semana. Cada pestaña tiene: resumen en columnas A–C ("Reporte Anterior", métodos, egresos, "Total Reporte"), lista de cobros (encabezado con CATEGORIA y PRODUCTO) y egresos (encabezado "EGRESOS / DEPOSITOS"), además de inventario, que se ignora. **Las columnas cambian de lugar entre sucursales y semanas**: el lector ubica cada sección por su título, nunca por letra.

- "Total Reporte" = efectivo físico en caja = Reporte Anterior + efectivo (+ abonos de préstamo) − todos los egresos.
- El depósito como egreso es efectivo que la sucursal lleva a la cuenta principal (HSBC); no es gasto. Transferencias, tarjeta y depósitos de clientes caen en la subcuenta de la sucursal.
- El SUMIF del Excel ignora mayúsculas pero **no espacios ni acentos** ni faltas de ortografía: "EFECTIVO ", "EFCTIVO" o "TRANSFERENCOA" quedan fuera de sus totales. La app sí los cuenta y los marca en Revisar.

### Lector (`<script id="lector">`, sin DOM para poder probarlo en Node)
- `leerLibro(nombre, bytes)`: con SheetJS (`xlsx@0.18.5` de cdnjs) lee solo las últimas 12 pestañas (sin "Hoja…" ni "Copia…") y hasta 400 filas. `leerHoja` saca resumen, cobros y egresos. La semana de cada pestaña es el lunes más repetido en sus fechas; si no tiene fechas o repite una anterior, es la anterior + 7 días. Solo se toman semanas desde `INICIO` (`2026-10-05`).
- `clasificarCobro`: contado, anticipo, liquidación, abono, flete, abono de préstamo, movimiento de inventario (p. ej. "SALIDA DE MERCANCIA", sin dinero) o cancelada. Inventario y canceladas se apartan ("movimientos sin dinero" en Cobros).
- `aCatalogo`: lleva métodos y tipos de egreso a la lista válida (`METODOS`, `TIPOS_EGRESO`) y marca si estaban mal escritos, con espacios o con acento.
- `calcular(datos)`: recalcula la caja de cada sucursal encadenando semanas (la primera arranca en el "Reporte Anterior" de su pestaña), separa cobros y egresos y arma los problemas (cada uno con una `clave` estable: sucursal, semana, tipo y datos del renglón, sin la fila, para reconocerlo aunque metan renglones): método mal escrito o sin método, egreso sin tipo, saldo anterior que no encadena, fecha fuera de la semana de su pestaña (son errores al escribir, confirmado el 3-nov-2026; p. ej. "2 oct" en la pestaña del 2 de noviembre) y diferencia contra el "Total Reporte" (solo cuando la diferencia cambia, para no repetir la misma cada semana). **Lo que calcula la app manda**; lo que dice la sucursal se muestra como diferencia.
- Límites: `LIMITE_CAJA` = $10,000 (fila en rojo y excedente), `LIMITE_GRAVE` = $30,000 (rojo más fuerte).

### Conexión con Google Drive
Los reportes son **Google Sheets** en una carpeta compartida con una cuenta de Google distinta de gvf.operativo.
- Proyecto de Google Cloud **Grupo BMA** (creado por el usuario con esa cuenta), con Google Drive API habilitada, pantalla de consentimiento en modo **prueba** (solo las cuentas agregadas como usuarios de prueba pueden conectarse) y un cliente OAuth web cuyo ID está en `GOOGLE_CLIENT_ID`. Orígenes autorizados: `https://grupobma.github.io` y `http://localhost:8765`. El ID de cliente es público por diseño; el secreto no se usa ni se guarda.
- Alcance `drive.readonly`: Google mismo impide escribir. La app solo hace GET: lista la carpeta (`listarCarpeta` entra a subcarpetas hasta 3 niveles y sigue accesos directos; `archivosDeCarpeta` se queda con los que dicen "REPORTE" o una sucursal en el nombre, y si ninguno, con todos), exporta cada Google Sheet como .xlsx (o baja el .xlsx tal cual) y lo pasa a `leerLibro`.
- El token se pide con Google Identity Services (`pedirToken`, ventana de Google al dar clic) y vive solo en memoria (1 hora).
- El enlace de la carpeta **no va en el código** (repo público): se pide en la pantalla de inicio y se guarda en `localStorage` (`bma.carpeta.v1`).
- La sucursal sale del nombre del archivo; si no la trae (Morelia se llama "reporte 2026"), de la clave de las pestañas (`CLAVES_HOJA`, p. ej. "MLM" = Morelia) o de la ciudad escrita en las primeras filas (`CIUDADES`).

### Interfaz
- Sin datos: pantalla para pegar el enlace de la carpeta y "Conectar con Google"; como respaldo, escoger los Excel de la computadora. "Actualizar" vuelve a leer la carpeta guardada (o abre el selector de archivos si no hay carpeta) y reemplaza solo las sucursales que encontró. Errores y archivos sin sucursal reconocida salen en un aviso arriba.
- Lo leído se guarda en `localStorage` (`bma.reportes.v1`) solo como copia de lo que está en el Drive, que es la fuente; se puede borrar sin perder nada. El encabezado dice cuándo se actualizó.
- Caja: efectivo de hoy (última pestaña) de cada sucursal, ordenado de mayor a menor; avisa si la sucursal reporta otra cifra o si su último reporte es de una semana anterior. Al abrir una fila: con cuánto arrancó al 5 de octubre, lo que entró en efectivo, las salidas por tipo y cómo fue cambiando por semana.
- Cobros y Gastos: todo desde el 5 de octubre, filtro por sucursal, totales arriba y tabla con lo más reciente primero. El orden lo manda la semana de la pestaña y luego la fecha, porque hay fechas mal capturadas (p. ej. "2 oct" en la pestaña del 2 de noviembre).
- Revisar: subpestañas **Por corregir** y **Corregidos**. Al leer de nuevo (`procesar` → `conciliar`), lo que estaba por corregir y ya no aparece pasa a Corregidos con fecha y hora; si reaparece, vuelve a Por corregir. Se guarda en `localStorage` (`bma.revisar.v1`), solo en esta computadora. El número en la pestaña es lo que falta por corregir.
- MOR y ZAP quedan fuera por ahora (sus archivos no tienen semanas desde el 5 de octubre).
- Estilo (desde el 20-nov-2026, ver "Menú por módulos y estilo"): letra Geist, fondo gris claro, tarjetas blancas sin borde, acento azul marino `--acento` para lo elegido; modo oscuro por `prefers-color-scheme`; tokens `--alerta*` para cajas arriba del límite.

### Probar
`.claude/launch.json` levanta `python -m http.server 8765 --bind 127.0.0.1` (solo esta computadora: el servidor también sirve `.local/` con datos reales). Para datos reales, copiar los Excel a `.local/` y crear `File` con `fetch` desde la consola, o correr el lector en Node con la misma copia de SheetJS. Nunca subir datos reales: el repo es público.

### Pendiente
Cuentas por cobrar por cliente (cada cliente con número), préstamos a empleados por separado, subcuentas, semanas anteriores al 5 de octubre, inventario, Supabase e inicio de sesión.

## Repositorio y despliegue

- Repo propio **`GrupoBMA/administracion`** dentro de la organización de GitHub `GrupoBMA` (3-nov-2026), separado de GVF. Se publica por GitHub Pages desde `main` en <https://grupobma.github.io/administracion/>. **Cada push a `main` sale en vivo** y el repo es **público** (requisito de Pages en el plan gratis).
- Otras apps del grupo irían en repos hermanos de la misma organización (p. ej. `logistica` → `grupobma.github.io/logistica/`). El nombre especial `grupobma.github.io` queda libre para una posible página de inicio.
- Clon local: `OneDrive\Claude Code\Grupo BMA\grupo-bma`. Abrir las sesiones de Claude ahí.
- Antes vivía en la carpeta `grupo-bma/` del repo `Golden-Valley-Farms/Finanzas` (GVF); el historial se trajo con `git subtree split`.
- Flujo igual que GVF: editar, commit descriptivo, `git push origin main`, y decirle al usuario dónde mirar en la página en vivo.

## Base de datos e inicio de sesión (20-nov-2026)

Rumbo decidido el 19-nov-2026 (diseño en `docs/superpowers/specs/2026-11-19-ventas-silvia-design.md`): la app hace lo que hoy hace Silvia en sus Excel (`FImp<SUC>-2026.xlsx`, en su computadora personal): ventas con su historial de movimientos, personas, y después caja, gastos, préstamos y banco. **La app dejará de leer el Drive**; Silvia captura. Plan de esta etapa: `docs/superpowers/plans/2026-11-20-base-e-importacion.md`.

- **Supabase**, mismo proyecto que GVF (`jlfendrdwptwmttrahre`), esquema **`bma` sin exponer en la API**: nadie lee las tablas directo (revoke a `anon`/`authenticated` y RLS encendido sin políticas). Se entra solo por funciones `public.bma_*` (`security definer`), igual que Logística. SQL en `supabase/sql/2026-11-20-bma-*.sql`; pruebas en `tests/bma-base.sql` y `tests/bma-importar.sql` (se corren completas con `execute_sql` y terminan en `rollback`).
- Tablas: `usuarios` (rol `admin` o `captura`), `sucursales` (11; GDL = almacén `S-WAS` en Odoo), `personas` (número propio, tipos cliente/empleado/vendedor), `ventas` (folio `SUC-AÑO-NNNN`, estado abierta/cerrada/cancelada), `movimientos` (contado, anticipo, abono, liquidación, cancelación, entrega, devolución; monto siempre ≥ 0, la devolución resta), `apartados` (préstamos e inventario que venían en el Excel), `dudas_importacion` y `bitacora` (alta/cambio/baja con antes y después; la escribe un trigger, no la pantalla; no anota mientras `bma.importando = 'si'`).
- Funciones: `bma_sesion()` (nombre y rol; `42501` si la cuenta no está dada de alta), `bma_importar_empezar()` y `bma_importar_lote(tabla, filas)` (solo admin y solo mientras la importación esté abierta), `bma_borrar_importado()` (solo `postgres`). **La importación se cierra sola** en cuanto haya algo con `origen = 'capturada'` o cualquier fila en la bitácora. Supabase rechaza `DELETE` sin `WHERE` en peticiones de la API: usar `where true`.
- Cuentas: una admin (el usuario) y una captura (Silvia), creadas en Supabase Auth por el usuario con el dominio `@administracion.bma`; en Entrar basta con escribir el usuario sin dominio. Los correos exactos no van en este repo público. Nunca guardar contraseñas.
- La app pide iniciar sesión antes de todo (`body.sin-sesion`); las pestañas de siempre (Caja, Cobros, Gastos, Revisar, que aún leen el Drive) siguen detrás del inicio de sesión hasta que la etapa 5 las reemplace.

### Importación de 2026 (`importar/`)
- `lector.py` lee los Excel de Silvia (columnas por título; la columna sin título a la derecha de MÉTODO es su "OK" del banco). `hilar.py` arma ventas y movimientos: une anticipo → abonos → liquidación por sucursal + línea (motos/pasto/otro) + número de remisión (solo dígitos: "NV 21" = "21") + 180 días, y primero por la nota de Silvia ("ANT 24 SEP NV 133 $30,000"), que en Morelia trae la remisión del anticipo distinta a la de la liquidación. **Silvia escribe notas en la columna VENDEDOR**: el vendedor es la primera palabra si aparece en ≥ 5 renglones; lo demás es nota. "Solo entrega/factura/envío" traen el valor de la mercancía, no un cobro: entran como entrega con monto 0 y el valor en la nota. Solo un monto negativo es devolución. `cargar.py` genera `.local/importacion/lotes.json` y `resumen.txt`; `importar/subir.html` (local, con la sesión del admin) lo sube. Pruebas: `python -m unittest discover -s importar`.
- Cargada el 19-nov-2026: 3,107 ventas, 3,618 movimientos, 13 vendedores, 90 apartados y 307 dudas. Entregas y devoluciones solo se ligan a una venta de los últimos 180 días; un cobro sin producto es venta propia con duda `sin_producto`; un monto que no se puede leer no se inventa: duda `monto_ilegible`. Si una subida se detiene a la mitad, volver a darle Subir antes de capturar nada (la importación no es atómica). Cuadra al centavo por sucursal con el dinero de los Excel menos lo apartado. Solo AGS, MAZ, MLM, PUE, QRO y TEP; GDL, ZAP, NAU, LPZ y TIJ empiezan vacías (decisión del usuario).
- Los Excel y lo generado viven solo en `.local/` (ignorada); nunca en el repo, que es público.

### Ventas, Personas y Dudas (20-nov-2026)
Plan: `docs/superpowers/plans/2026-11-20-ventas-personas-dudas.md`.
- **Menú por módulos y estilo (20-nov-2026, segunda vuelta, a pedido: "no me agrada cómo se ve; mucho uso de menús y módulos", apoyándose en la estructura de logística, finanzas y catálogo sin copiarlas).** Reemplaza las secciones con pestañas de la primera vuelta. Menú fijo a la izquierda desde 1024 px (`.menu`, 248 px, con la marca arriba y quién entró + Salir abajo); en celular y tablet, fila arriba que se desliza (sin títulos de grupo ni íconos) y se recorre sola hasta la opción elegida. Lo arma `MENU` en `index.html`: **Ventas** (Nueva venta · Registrar pago · Lista de ventas), **Personas** (Clientes · Vendedores · Empleados), **Revisar** (Dudas, con su número) y, **solo admin**, **Reportes del Drive** (Caja · Cobros · Gastos · Errores; Silvia no tiene acceso al Drive). `ir(id)` abre una opción: sin `seguir` empieza desde el principio (la lista, sin ficha); `selModulo(mod)` queda para los módulos que piden "llévame a…" y conserva lo abierto. Cada cambio deja una entrada en el historial: el "atrás" del navegador regresa a la opción anterior. Al entrar abre **Lista de ventas** (información primero). Sin títulos de pantalla. Dentro de una pantalla, las vistas van en pestañas tipo iPhone (`UI.seg`: Abiertas/Cerradas/Canceladas/Todas, En las listas/Quitadas, Pendientes/Resueltas) y los filtros como `UI.filtro` ("Sucursal · Todas"). Letra **Geist** (la de logística, para que las apps del grupo se vean parejas; el detector de Impeccable la marca como "muy usada" y se dejó a propósito), fondo `#F2F2EF`, tarjetas blancas sin borde (radio 16-18), campos rellenos de gris, lo elegido en azul suave con contorno (`--acento-bg`/`--acento`), nunca relleno negro. En Lista de ventas la remisión va en una etiqueta a la izquierda del modelo y una venta abierta dice solo "Abierta" (sin "precio por confirmar", a pedido; el precio por confirmar se sigue viendo en la ficha).
- **Registrar** (`registrar.js`) es una sola pantalla con pasos numerados y botones para escoger (como el registro de GVF): se entra desde el menú por "Nueva venta" o "Registrar pago" (`Registrar.abrir(que)`; ya no existe el paso "¿Qué vas a registrar?") y aparecen solo los pasos que tocan; "Más datos" despliega vendedor, remisión, factura, precio y nota; abajo, fijo, el resumen en palabras y Guardar. "Registrar pago" de la ficha abre Registrar con la venta ya escogida (`Registrar.pagoDe`).
- **Lista desplegable de personas** (`UI.combo`): busca al escribir, cada renglón tiene × para quitarlo de la lista y al final "+ Agregar …" lo da de alta ahí mismo. **Silvia y el admin pueden agregar y quitar** (decisión del usuario). Quitar no borra: `personas.activa = false` (`bma_persona_quitar`), su historial sigue y en Catálogos → Personas → "Ver: Quitadas" se puede volver a poner.
- Archivos: `bma-logica.js` (sin DOM: `esc`, `dinero`, `saldo`, `etiquetaEstado`, `TIPOS`, `METODOS`, `SUCURSALES`, `validarMovimiento`, `textoCambio`, `MOTIVOS`; pruebas `node --test tests/*.test.js`), `bma-ui.js` (hoja con lista para escoger, `pedirTexto`, `pedirMonto`, `escogerVarios`, `confirmar`, `aviso`, `llamar`, `guardar`), `personas.js` (incluye `Personas.escoger`, que usan Ventas y Registrar), `ventas.js` (lista, ficha, editar, corregir/eliminar, Registrar, `Ventas.buscarVenta`), `dudas.js`, `ventas.css`. **Cambiar el `?v=` de los seis en `index.html` cuando cambien** (el navegador guarda la versión vieja).
- Funciones (`supabase/sql/2026-11-20-bma-ventas.sql`, pruebas `tests/bma-ventas.sql`): `bma_ventas_buscar` (texto sin acentos en folio/producto/factura/cliente/vendedor; si trae dígitos, remisión por número y número de cliente; ordena por la **semana del reporte**, no por la fecha, porque hay fechas mal capturadas), `bma_venta` (venta, movimientos con quién, cambios de la bitácora, dudas y nombres), `bma_venta_nueva` (folio siguiente con candado), `bma_movimiento_nuevo`, `bma_venta_editar`, `bma_movimiento_corregir`, `bma_movimiento_eliminar` (**solo admin**), `bma_personas_buscar`, `bma_persona`, `bma_persona_guardar`, `bma_dudas`, `bma_duda_resolver` (unir mueve el movimiento y borra la venta que queda vacía). Estado y precio los decide `bma.recalcular`: cancelada si hay cancelación, cerrada si hay contado o liquidación, si no abierta. `ventas.precio_auto`: el precio que se puso solo (lo pagado al cerrarse) se recalcula con cada corrección; el que se escribe a mano se respeta, y borrarlo vuelve al automático. Una devolución sí se acepta en una venta cancelada, pero nunca mayor que lo pagado. Unir una duda solo arrastra las demás dudas si la venta de origen queda vacía y se borra (`supabase/sql/2026-11-20-bma-revision.sql`).
- **Capturar algo o resolver una duda cierra la importación** para siempre; Dudas avisa antes de la primera.
- **Candado de localhost:** en `localhost`/`127.0.0.1` cada guardar pide confirmar "Esto guarda en la base real" (no hay base de pruebas). Probar escrituras en SQL con `rollback`.

## Reglas de negocio

### Gastos: dos tipos de registro, sin duplicar

Hay dos clases de salida de dinero:

- **Gasto normal:** dinero que sale y es gasto (compra, servicio, etc.).
- **Pago a deuda:** dinero que sale para abonar a algo que se debe.

Ejemplo: se compra algo a crédito por $10,000 y después se abonan $5,000. La compra de $10,000 ya es el gasto. Los $5,000 **sí** deben verse como dinero que salió, pero marcados como pago a la deuda; **no** se suman otra vez como gasto. Si se sumaran, el gasto quedaría duplicado ($15,000 en vez de $10,000).

Consecuencia para los reportes: "gasto" y "salida de efectivo" son totales distintos y no se mezclan.

GVF tiene una regla parecida: el préstamo no genera gasto automático y los abonos van por el módulo de Deudas.

## Fuentes de datos

La información llega en Excels que el equipo deja en Google Drive. Google Drive para escritorio está instalado en la computadora secundaria como unidad `G:`:

- `G:\Mi unidad\ADMINISTRACION GRUPO BMA\` — carpetas `Alzator`, `SUNL`, `Pastito` (al 24-oct-2026 solo documentos fiscales en PDF).
- `G:\Mi unidad\SUNL\` — `Gastos_Fijos.xlsx`, `Organigrama.xlsx`.

La letra de unidad puede cambiar en la computadora principal.
