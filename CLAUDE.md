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

## Estado actual (3-nov-2026)

`index.html` lee los reportes semanales de las sucursales y muestra cuatro pestañas para la semana elegida (flechas en el encabezado): **Caja**, **Cobros**, **Gastos** y **Revisar**. Sin Supabase ni inicio de sesión todavía.

### Cómo son los reportes
Un Excel por sucursal (`Reporte2026-<SUC> ….xlsx`, la sucursal sale del nombre del archivo), una pestaña por semana. Cada pestaña tiene: resumen en columnas A–C ("Reporte Anterior", métodos, egresos, "Total Reporte"), lista de cobros (encabezado con CATEGORIA y PRODUCTO) y egresos (encabezado "EGRESOS / DEPOSITOS"), además de inventario, que se ignora. **Las columnas cambian de lugar entre sucursales y semanas**: el lector ubica cada sección por su título, nunca por letra.

- "Total Reporte" = efectivo físico en caja = Reporte Anterior + efectivo (+ abonos de préstamo) − todos los egresos.
- El depósito como egreso es efectivo que la sucursal lleva a la cuenta principal (HSBC); no es gasto. Transferencias, tarjeta y depósitos de clientes caen en la subcuenta de la sucursal.
- El SUMIF del Excel ignora mayúsculas pero **no espacios ni acentos** ni faltas de ortografía: "EFECTIVO ", "EFCTIVO" o "TRANSFERENCOA" quedan fuera de sus totales. La app sí los cuenta y los marca en Revisar.

### Lector (`<script id="lector">`, sin DOM para poder probarlo en Node)
- `leerLibro(nombre, bytes)`: con SheetJS (`xlsx@0.18.5` de cdnjs) lee solo las últimas 12 pestañas (sin "Hoja…" ni "Copia…") y hasta 400 filas. `leerHoja` saca resumen, cobros y egresos. La semana de cada pestaña es el lunes más repetido en sus fechas; si no tiene fechas o repite una anterior, es la anterior + 7 días. Solo se toman semanas desde `INICIO` (`2026-10-05`).
- `clasificarCobro`: contado, anticipo, liquidación, abono, flete, abono de préstamo, movimiento de inventario (p. ej. "SALIDA DE MERCANCIA", sin dinero) o cancelada. Inventario y canceladas se apartan ("movimientos sin dinero" en Cobros).
- `aCatalogo`: lleva métodos y tipos de egreso a la lista válida (`METODOS`, `TIPOS_EGRESO`) y marca si estaban mal escritos, con espacios o con acento.
- `calcular(datos)`: recalcula la caja de cada sucursal encadenando semanas (la primera arranca en el "Reporte Anterior" de su pestaña), separa cobros y egresos y arma los problemas: método mal escrito o sin método, egreso sin tipo, saldo anterior que no encadena y diferencia contra el "Total Reporte" (solo cuando la diferencia cambia, para no repetir la misma cada semana). **Lo que calcula la app manda**; lo que dice la sucursal se muestra como diferencia.
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
- Lo leído se guarda en `localStorage` (`bma.reportes.v1`) solo como copia de lo que está en el Drive, que es la fuente; se puede borrar sin perder nada. Abre en la semana más reciente en la que alguna sucursal ya capturó algo; una sucursal sin pestaña esa semana arrastra su última caja ("Sin reporte esta semana").
- Caja: sucursales ordenadas por efectivo; cada fila se abre con el cálculo y el historial por semana. Cobros y Gastos: filtro por sucursal, totales arriba y tabla. Revisar: problemas de la semana con pestaña y fila para llamarle a la sucursal.
- MOR y ZAP quedan fuera por ahora (sus archivos no tienen semanas desde el 5 de octubre).
- Estilo de GVF: DM Sans / DM Mono, tonos cálidos, modo oscuro por `prefers-color-scheme`; tokens `--alerta*` para cajas arriba del límite.

### Probar
`.claude/launch.json` levanta `python -m http.server 8765`. Para datos reales, copiar los Excel a `.local/` y crear `File` con `fetch` desde la consola, o correr el lector en Node con la misma copia de SheetJS. Nunca subir datos reales: el repo es público.

### Pendiente
Cuentas por cobrar por cliente (cada cliente con número), préstamos a empleados por separado, subcuentas, semanas anteriores al 5 de octubre, inventario, Supabase e inicio de sesión.

## Repositorio y despliegue

- Repo propio **`GrupoBMA/administracion`** dentro de la organización de GitHub `GrupoBMA` (3-nov-2026), separado de GVF. Se publica por GitHub Pages desde `main` en <https://grupobma.github.io/administracion/>. **Cada push a `main` sale en vivo** y el repo es **público** (requisito de Pages en el plan gratis).
- Otras apps del grupo irían en repos hermanos de la misma organización (p. ej. `logistica` → `grupobma.github.io/logistica/`). El nombre especial `grupobma.github.io` queda libre para una posible página de inicio.
- Clon local: `OneDrive\Claude Code\Grupo BMA\grupo-bma`. Abrir las sesiones de Claude ahí.
- Antes vivía en la carpeta `grupo-bma/` del repo `Golden-Valley-Farms/Finanzas` (GVF); el historial se trajo con `git subtree split`.
- Flujo igual que GVF: editar, commit descriptivo, `git push origin main`, y decirle al usuario dónde mirar en la página en vivo.

## Datos y seguridad (pendiente)

Decisión del usuario (24-oct-2026): **por ahora no hay inicio de sesión ni Supabase**; se arma la estructura primero. Antes de capturar el primer dato real:

1. Mismo proyecto de Supabase que GVF (`jlfendrdwptwmttrahre`), pero con las tablas **separadas** de GVF (esquema propio, nombre tentativo `bma`; hay que exponerlo en la API de Supabase).
2. **Inicio de sesión propio**: no usar el correo ni la contraseña de GVF.
3. RLS en todas las tablas, compuerta de sesión al arrancar y candado de escrituras en `localhost`, como en GVF.
4. Supabase es la fuente de verdad: nada vive solo en `localStorage`.

Como el repo es público, **no capturar datos reales** mientras no exista ese inicio de sesión.

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
