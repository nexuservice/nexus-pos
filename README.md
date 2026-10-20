# Nexus · tu tienda online y punto de venta

Una sola plataforma para vender en el local (**Caja**) y por internet (**Tienda online**) con **el mismo inventario**, boleta electrónica estructurada para Chile y reportes diarios.

Hecho con **Claude Code + [REA](https://github.com/morluto/rea)**: REA se usó para analizar el comportamiento observable de un POS web público (endpoints, flujo de carrito, métodos de pago) y Claude Code reconstruyó una versión **original** a partir de esa evidencia. Ver [`docs/EVIDENCIA.md`](docs/EVIDENCIA.md).

## Qué incluye

| Módulo | Detalle |
|---|---|
| **Caja** | Interfaz táctil, búsqueda y código de barras, carrito, cobro en efectivo/débito/crédito con terminal simulado (Transbank por defecto), progreso del cobro en vivo y boleta |
| **Tienda online** | Catálogo sincronizado con el mismo stock, carrito, datos del cliente (RUT validado) y pago con Mercado Pago o Webpay (simulados) |
| **Inventario por canal** | Stock físico y online separados, reservas al agregar al carrito, y movimiento entre canales |
| **Boleta electrónica** | DTE tipo 39 con neto/IVA 19 %, folios consecutivos y XML con la estructura del SII (sin firma ni timbre) |
| **Reportes** | Ventas del día por canal y medio de pago, ticket promedio y más vendidos |

## Estructura

```
core/       motor de ventas en TypeScript puro (inventario, pagos, boleta, RUT) + 20 pruebas
backend/    API Express; guarda el estado en un archivo JSON local
frontend/   React + Vite; corre con el backend o en "modo demo" sin servidor
docs/       evidencia REA (VISTO / INFERIDO / DESCONOCIDO)
```

## Probar en local

Requiere Node 22 o superior.

```bash
npm install
npm test            # pruebas del motor (concurrencia, pagos, boleta)
npm run dev:web     # http://localhost:5173  (modo demo, sin servidor)
```

Con servidor propio (los datos quedan en `backend/data/`):

```bash
npm run dev:api     # http://localhost:3001
# en otra terminal, apuntando el frontend a la API:
# PowerShell:  $env:VITE_API_URL="http://localhost:3001"; npm run dev:web
```

## Publicar en Netlify

El repositorio ya trae `netlify.toml`. En Netlify: *Add new site → Import from Git*, elige el repo y despliega. Sin `VITE_API_URL` la app funciona en **modo demo**: el mismo motor corre en el navegador y guarda los datos en `localStorage` (botón *Reiniciar demo* para restaurar).

## Cómo se evita vender de más

El motor es síncrono: reservar stock, cobrar y descontar son operaciones atómicas. Las pruebas lanzan 50 carritos contra 5 unidades y verifican que exactamente 5 ganan, que el stock nunca queda negativo y que los folios no se repiten. Un cobro con la misma clave de idempotencia nunca genera dos ventas.

## Alcance y límites

- **Pagos simulados.** `SimulatedGateway` reemplaza a los terminales reales. Para producción hay que implementar `TerminalGateway` con el SDK de Transbank, Getnet o Mercado Pago.
- **Boleta sin timbre.** El XML sigue la estructura de datos del SII, pero no lleva CAF, timbre (TED) ni firma digital, y no se envía al SII. Para operar de verdad se necesita un certificador autorizado.
- **Persistencia simple.** JSON local en el backend y `localStorage` en el modo demo. El esquema relacional objetivo está en `backend/db/schema.sql` (PostgreSQL) para una migración posterior.
- **Sin autenticación** de usuarios todavía (cajeros, roles).
- Proyecto original e independiente: no usa código, marca ni recursos de ningún producto existente.
