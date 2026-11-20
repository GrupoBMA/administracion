# Ventas con historial: la app hace lo que hoy hace Silvia

Fecha: 19-nov-2026. Estado: borrador para aprobación.

## Por qué

Las sucursales suben cada semana su reporte a Google Drive (ventas, gastos, inventario). Silvia los revisa en su computadora personal, en sus propios Excel (`FImpAGS/MAZ/MLM/PUE/QRO/TEP-2026.xlsx`): normaliza productos, liga cada anticipo con su liquidación, confirma cobros contra el banco y lleva préstamos a empleados. Ese trabajo vive en archivos que solo ella tiene, sin historial de quién cambió qué.

La misión es que lo de las sucursales y lo de Silvia cuadre, y que todo sea **trazable**: abrir cualquier venta, abierta o cerrada, y ver todos sus movimientos con fecha. Silvia es el puente entre lo que suben las sucursales y, más adelante, Odoo.

## Metas

- Silvia captura en la app lo que llega en los reportes de las sucursales (deja su Excel).
- Cada **venta** es una ficha con su historial de movimientos (anticipos, abonos, liquidación, cancelación, entrega), con quién lo registró y cuándo.
- Una venta se encuentra al instante por número de nota/remisión, factura, cliente, producto, sucursal o folio.
- Cada **persona** (cliente, empleado, vendedor) está registrada y tiene su historial.
- Arranca con **todo 2026** importado de los Excel de Silvia, hilado automáticamente; lo dudoso queda en una lista para revisar con Silvia.

## No metas (por ahora)

- La app deja de leer el Drive. El Drive sigue siendo de solo lectura y nadie le escribe.
- Odoo: se conecta después (comparar ventas e inventario).
- Inventario.
- Que las sucursales usen la app.

## Anti-metas (sería un fracaso aunque funcione)

- Que un cambio borre lo que había: cada corrección se guarda encima, nunca reemplaza sin dejar rastro.
- Que un abono se pueda registrar sin saber a qué venta va.
- Que la app se sienta como GVF copiada: se toma solo lo que sirva (clientes con número, cuentas con abonos, estado de cuenta) y se adapta.
- Datos reales en el repositorio (es público).

## Restricciones

- Repo público `GrupoBMA/administracion`, publicado por GitHub Pages: ningún dato real ni clave en el código.
- Supabase: mismo proyecto que GVF (`jlfendrdwptwmttrahre`), esquema propio **`bma`** expuesto en la API, RLS en todo, acceso solo para usuarios de la lista `bma.usuarios` (mismo patrón que `acceso.es_gvf()`, que ya protege a GVF de cuentas ajenas). Inicio de sesión propio, no el de GVF. Candado de escrituras en `localhost`, como GVF.
- Supabase es la fuente de verdad: nada vive solo en `localStorage`.
- Estilo actual de la app (DM Sans / DM Mono, tonos cálidos, modo oscuro). Minimalista, sin leyendas de ayuda. Sin desplegables nativos en la captura (usar la lista para escoger, como en Logística y Catálogo).
- El Drive nunca se modifica.

## Enfoques considerados

1. **Importación con un script local + app para capturar y consultar (elegido).** Un script de Python en la computadora del usuario lee los 6 Excel de Silvia, hila las ventas y las carga a Supabase. Se puede borrar y volver a correr sin tocar la app. La app se queda limpia.
2. Importación dentro de la app (Silvia sube sus Excel). Útil si se repitiera, pero es una sola vez y haría la app mucho más pesada.
3. Una app aparte para Silvia. Descartado: dos lugares para ver lo mismo.

## Usuarios

- **admin** (el usuario): ve todo, puede todo.
- **captura** (Silvia): captura y corrige ventas, movimientos y personas.
- Las cuentas se crean en Supabase Auth; la app solo deja entrar a quien está en `bma.usuarios` con su rol.

## Modelo de datos (esquema `bma`)

- `usuarios` — `user_id`, nombre, rol.
- `sucursales` — clave (AGS, GDL, MAZ, MLM, PUE, QRO, TEP, ZAP, NAU, LPZ, TIJ), nombre, código de almacén en Odoo (S-AGS…; GDL = S-WAS).
- `personas` — número corto único (lo asigna la app, editable), nombre, tipos (cliente, empleado, vendedor; puede ser varios), teléfono, sucursal, notas.
- `ventas` — folio interno (`AGS-2026-0001`), sucursal, fecha, cliente (puede quedar *por asignar* en lo importado), vendedor, producto, categoría, línea (motos / pasto / otro), remisión, factura, color, precio total (puede quedar *por confirmar* en lo importado), estado (abierta / cerrada / cancelada), origen (importada / capturada).
- `movimientos` — venta, fecha, semana del reporte, tipo (contado, anticipo, abono, liquidación, cancelación, entrega sin dinero), monto, método (efectivo, transferencia, tarjeta, depósito, Mercado Pago, cheque), cuenta bancaria, confirmado en banco (sí/no), nota, quién y cuándo, y **origen** (archivo, pestaña y fila del Excel cuando es importado).
- `bitacora` — cada alta, cambio o baja en ventas, movimientos y personas: tabla, registro, antes, después, usuario y fecha. La escribe un trigger de la base, no la pantalla, para que no se pueda saltar.
- `dudas_importacion` — lo que el script no pudo hilar con seguridad, con su motivo y su estado (pendiente / resuelta).

- `apartados` — renglones importados que no son ventas (abonos de préstamo a empleados, movimientos de inventario), con su origen, para usarlos en la etapa 6.

Saldo de una venta = precio total − suma de movimientos con dinero. Si el precio está *por confirmar*, la venta muestra lo pagado y no el saldo.

**Cerrada** = tiene un movimiento de contado o de liquidación. **Cancelada** = tiene cancelación. Lo demás, abierta.

**Permisos:** nadie borra de verdad desde la app. Silvia corrige (queda en la bitácora) o cancela con un movimiento de cancelación. El admin puede eliminar un movimiento capturado por error; también queda en la bitácora con el registro completo de antes.

## Importación de 2026

Fuente: los 6 Excel de Silvia (no los del Drive), con la semana 52 de 2025 incluida porque ahí están anticipos que se liquidan en 2026.

Cómo son: una pestaña por semana ("AGS 44  26-31oct26"), con el mismo esqueleto que el reporte de la sucursal. Resumen en A–B; cobros con FECHA, CATEGORÍA, PRODUCTO, PAGO (contado / anticipo / liquidación / cancelada / solo entrega…), MÉTODO, una columna sin título donde Silvia pone "OK" cuando lo confirmó en el banco, CUENTA, MONTO, REMISIÓN, FACTURA, COLOR, G/S, VENDEDOR y DESCRIPCIÓN (sus notas); luego egresos e inventario. Las columnas se ubican por su título, nunca por letra. **No hay columna de cliente ni de precio total.**

- Precio: si la venta quedó cerrada, el precio total = suma de sus pagos. Si sigue abierta, *por confirmar*.
- Personas: no se crean clientes (no hay nombres). Sí se crean **vendedores** a partir de la columna VENDEDOR, juntando variantes obvias (mayúsculas, espacios, acentos); las variantes dudosas van a dudas.
- Confirmado en banco: sí cuando la columna de Silvia dice "OK".
- **Se puede volver a correr solo antes de que Silvia empiece a capturar.** Después de eso, la importación queda cerrada y lo que falte se corrige en la app.

Reglas para hilar, en este orden:
1. **Nota de Silvia**: textos como "ANT 18 DIC REM 03 $8,000" o "ANT 12 OCT NV 101" dicen explícitamente a qué anticipo corresponde una liquidación.
2. **Misma sucursal + misma remisión + misma línea** (motos y pasto tienen series de remisión distintas; los números también se repiten entre años) **+ producto parecido + fechas cercanas** (el anticipo antes que la liquidación).
3. Contado: venta de un solo movimiento, cerrada.
4. Liquidación o abono sin anticipo encontrado: venta propia, marcada en dudas.
5. Cancelada: venta cancelada. "Solo entrega" / "solo factura": movimiento sin dinero en la venta que corresponda.
6. Abonos de préstamo a empleados y movimientos de inventario no son ventas: se apartan para la etapa de préstamos.

Medido el 19-nov con solo la regla 2: en AGS, 52 de 82 anticipos encuentran su liquidación; en QRO, 36 de 38. Las reglas 1 y 2 completas deberían subirlo.

El script corre local, guarda su resultado en un archivo fuera del repo y lo carga a Supabase por partes. Se puede borrar lo importado (origen = importada) y volver a correr. Al final entrega un resumen: ventas creadas, cerradas, abiertas y dudas por sucursal.

## Pantallas

- **Entrar**: correo y contraseña.
- **Ventas** (pantalla principal): un buscador que encuentra por folio, remisión, factura, cliente, producto o sucursal, y debajo la lista (más reciente arriba) con estado. Filtros rápidos: sucursal y abiertas / cerradas / todas.
- **Ficha de venta**: arriba producto, cliente, sucursal, remisión, factura, estado, total, pagado y saldo; abajo el historial de movimientos en orden de fecha, cada uno con quién lo registró; al final los cambios de la bitácora ("cliente: por asignar → Juan Pérez, Silvia, 20 nov"). Botones: agregar movimiento, editar.
- **Registrar**: venta nueva (contado o anticipo) o movimiento a una venta existente (se busca con el mismo buscador). Captura paso a paso.
- **Personas**: lista con buscador; ficha con su historial (compras y abonos si es cliente, lo vendido si es vendedor).
- **Dudas**: lo que la importación no hiló, para resolver con Silvia (unir con una venta, o dejar sola).
- Las pestañas actuales (Caja, Cobros, Gastos, Revisar) y la conexión al Drive **siguen hasta que la etapa 5 las reemplace**, para no quedarse sin vista de caja; después se retiran.

## Etapas

1. Usuarios y base de datos (esquema, RLS, bitácora, inicio de sesión).
2. Importación de 2026.
3. Ventas: buscador, ficha con historial, registrar.
4. Personas.
5. Caja, gastos y nómina (con nombre de la persona).
6. Préstamos a empleados como cuenta con abonos.
7. Confirmación contra el banco.

Este diseño detalla las etapas 1 a 4. Las 5 a 7 tendrán su propio diseño corto.

## Decisiones del usuario

- La app deja de leer el Drive; Silvia captura (19-nov).
- Se trae todo 2026 y la app hila sola; después se revisa con Silvia (19-nov).
- Cada venta lleva cliente; se busca por nota, cliente, producto y los demás campos (19-nov).
- Las personas se registran y cada una tiene historial (19-nov).
- Enfoque 1: script local + app (19-nov).
- De GVF solo se adapta lo útil, no se copia (19-nov).
- GDL, ZAP, NAU, LPZ y TIJ no tienen archivo de Silvia: **empiezan vacías** y Silvia las captura desde que arranque (19-nov). La importación solo trae AGS, MAZ, MLM, PUE, QRO y TEP.

## Decisiones mías (revisables)

- El folio interno `SUC-AÑO-consecutivo` existe además de remisión y factura, porque la remisión se repite.
- Lo importado sin cliente queda *por asignar* y sin precio queda *por confirmar*.
- La bitácora la escribe la base con triggers.
- El número de persona lo propone la app.
- Importación re-ejecutable solo antes de que Silvia empiece a capturar.
- Precio de una venta importada cerrada = suma de sus pagos; cerrada = tiene contado o liquidación.
- La importación crea vendedores, no clientes.
- Préstamos e inventario importados van a una tabla `apartados`.
- Nadie borra de verdad salvo el admin, y todo queda en la bitácora.
- Las pestañas actuales siguen hasta la etapa 5.

## Queda al constructor

Nombres de columnas y funciones, cómo se pinta cada pantalla dentro del estilo actual, la similitud de productos para hilar, el formato del resumen de importación.
