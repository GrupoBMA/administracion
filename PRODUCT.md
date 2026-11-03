# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Una sola persona de administración de Grupo BMA, en computadora. Revisa cada semana los cortes de caja de las sucursales para saber a cuál llamar y qué tiene que corregir. El jefe no abre la app: recibe lo que esta persona le pasa.

## Product Purpose
Dar un seguimiento estricto a las ventas y gastos de las sucursales y que todo cuadre. Lee los reportes semanales que las sucursales llenan en Excel (Google Drive), recalcula el efectivo en caja de cada una y marca lo que no cuadra o se sale de las reglas. Éxito: abrir la app y saber en segundos qué sucursal tiene más de $10,000 en caja y qué renglones están mal capturados, sin esperar a que la sucursal corrija su Excel.

## Positioning
Es un control aparte, de solo lectura, sobre los mismos Excel que ya usan las sucursales: no les cambia la forma de trabajar ni toca sus archivos.

## Operating Context
- Cada sucursal (AGS, GDL, MAZ, PUE, QRO, TEP; MOR y ZAP fuera por ahora) llena un Excel con una pestaña por semana: lista de cobros, egresos y un resumen con "Total Reporte" (efectivo físico en caja).
- El efectivo se deposita a la cuenta principal (HSBC). Transferencias, tarjeta y depósitos de clientes caen en la subcuenta de la sucursal; una encargada en GDL los pasa a la principal.
- GDL incluye las oficinas y paga gastos y nómina de otras áreas.
- Si una caja pasa de $10,000 la persona les llama para preguntar por qué.

## Capabilities and Constraints
- **Prohibido modificar o borrar nada del Drive.** La app solo extrae: lee los archivos en el navegador, no los sube ni los cambia.
- Lo leído se recuerda solo en esa computadora hasta que se actualice con Excel nuevos.
- Por ahora todas las empresas (SUNL, Alzator, Pastito, Rocket, Melamina) se manejan como un solo negocio.
- Arranca en la semana del 5 de octubre de 2026; después se irán metiendo semanas anteriores.
- Inventario queda fuera por ahora; los movimientos de inventario que aparecen en la lista de cobros se apartan, no se borran.
- Pendiente: cuentas por cobrar por cliente (cada cliente con número), préstamos a empleados por separado, subcuentas, inicio de sesión y Supabase antes de capturar datos a mano.

## Brand Commitments
Interfaz en español. Muy minimalista, amable e intuitiva; sin leyendas o textos de ayuda salvo que de verdad hagan falta. Misma base visual que la app de GVF (DM Sans / DM Mono, tonos cálidos, modo oscuro).

## Evidence on Hand
Reportes reales en Descargas (`Reporte2026-<SUC> 09-11-26.xlsx`). No hay datos reales en el repositorio, que es público.

## Product Principles
1. Lo urgente primero: cajas con más de $10,000 y lo que no cuadra.
2. Nunca escribir en el Drive.
3. Mostrar el dato, no explicarlo: si algo necesita leyenda, primero intentar que se entienda solo.
4. Lo que la app calcula manda; si la sucursal dice otra cosa, se muestra la diferencia.
