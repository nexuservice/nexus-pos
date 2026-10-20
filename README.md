# Nexus · tu tienda online y punto de venta

Una sola plataforma para vender en el local (**Caja**) y por internet (**Tienda online**) con **el mismo inventario**, boleta electrónica estructurada para Chile, jornadas de caja y reportes.

Hecho con **Claude Code + [REA](https://github.com/morluto/rea)**: REA se usó para analizar el comportamiento observable de un POS web público (código del cliente, endpoints, flujos de carrito, pago, jornada y panel) y Claude Code reconstruyó una versión **original** a partir de esa evidencia. Qué se vio, qué se infirió y qué sigue desconocido está en [`docs/EVIDENCIA.md`](docs/EVIDENCIA.md).

## Qué incluye

| Módulo | Detalle |
|---|---|
| **Caja** | Interfaz táctil, búsqueda y código de barras, carrito con ✕ por línea, **cliente con autocompletado** (nombre o RUT, insignia VIP), 6 medios de pago (efectivo con vuelto, débito y crédito por terminal simulado, cheque, transferencia, convenio), progreso del cobro en vivo y boleta |
| **Jornada** | Abrir turno (cajero + PIN + fondo), info de jornada, **cierre con arqueo por forma de pago** (esperado vs. contado, faltantes y sobrantes). Sin jornada abierta no se cobra |
| **Pedidos abiertos** | «Dejar pedido abierto» (pendiente de pago o ya pagó), canal, observación, comanda imprimible, vista tarjetas/tabla con buscador y **mensajes por WhatsApp** (plantillas, +56 automático) |
| **Promociones** | Descuento por porcentaje o monto fijo, con código y vencimiento; ver activas, aplicar por botón o código y **crear/editar** desde la caja o la administración |
| **Tienda online** | Catálogo con el mismo stock, carrito, código de descuento, datos del cliente (RUT validado) y pago con Mercado Pago o Webpay (simulados) |
| **Inventario por canal** | Stock físico y online separados, reservas al agregar al carrito, movimiento entre canales y ajustes |
| **Boleta electrónica** | DTE tipo 39 con neto/IVA 19 %, descuento global, folios consecutivos y XML con la estructura del SII (sin firma ni timbre) |
| **Panel de ventas** | 8 KPI con variación frente al período anterior, tendencia diaria, medios de pago, categorías, día de la semana, hora, top productos, utilidad y margen, promociones usadas; filtros Hoy/Semana/Mes/Año; exportación CSV y JSON |
| **Historial** | Últimas 100 ventas, filtros, ver boleta y su XML, imprimir, **anular** (devuelve el stock) y exportar |
| **Administración** | Productos (con costo), clientes, cajeros, promociones, inventario y jornadas |
| **Ajustes ⚙️** | Tema claro/oscuro, pantalla completa, info superior, formas de pago visibles, detalle compacto, tamaño de botones y fuente, buscador/código de barras/«Todos», respaldo de la base de datos |
| **Ayuda** | Guía de uso dentro de la app |

## Estructura

```
core/       motor de ventas en TypeScript puro (inventario, pagos, jornada, promos, pedidos, reportes, boleta, RUT) + 38 pruebas
backend/    API Express (un endpoint RPC + SSE de pagos); guarda el estado en un archivo JSON local
frontend/   React + Vite; corre con el backend o en "modo demo" sin servidor
docs/       evidencia REA (VISTO / INFERIDO / DESCONOCIDO)
```

## Probar en local

Requiere Node 22 o superior.

```bash
npm install
npm test            # pruebas del motor (concurrencia, pagos, jornada, promos, pedidos, reportes, boleta)
npm run dev:web     # http://localhost:5173  (modo demo, sin servidor)
```

**Demo:** al abrir la Caja, abre la jornada con el cajero «Cajero 1», PIN `1234`. Códigos de promoción: `NEXUS5`, `VIP10`, `MENOS500`. Clientes de ejemplo: María Pérez (VIP), Juan Soto y Comercial Los Andes SpA.

Con servidor propio (los datos quedan en `backend/data/`):

```bash
npm run dev:api     # http://localhost:3001
# en otra terminal, apuntando el frontend a la API:
# PowerShell:  $env:VITE_API_URL="http://localhost:3001"; npm run dev:web
```

## Publicar en Netlify

El repositorio ya trae `netlify.toml`. En Netlify: *Add new site → Import from Git*, elige el repo y despliega. Sin `VITE_API_URL` la app funciona en **modo demo**: el mismo motor corre en el navegador y guarda los datos en `localStorage` (menú ⚙️ → *Reiniciar demo* para restaurar).

## Cómo se evita vender de más

El motor es síncrono: reservar stock, cobrar y descontar son operaciones atómicas. Las pruebas lanzan 50 carritos contra 5 unidades y verifican que exactamente 5 ganan, que el stock nunca queda negativo y que los folios y números de venta no se repiten. Un cobro con la misma clave de idempotencia nunca genera dos ventas, y un cobro rechazado se puede reintentar con el mismo medio.

## Alcance y límites

- **Pagos simulados.** `SimulatedGateway` reemplaza a los terminales reales. Para producción hay que implementar `TerminalGateway` con el SDK de Transbank, Getnet o Mercado Pago.
- **Boleta sin timbre.** El XML sigue la estructura de datos del SII, pero no lleva CAF, timbre (TED) ni firma digital, y no se envía al SII. Anular una venta devuelve el stock, pero una boleta real se anula con una **nota de crédito electrónica** (DTE 61), que no está implementada.
- **Persistencia simple.** JSON local en el backend y `localStorage` en el modo demo. El esquema relacional objetivo está en `backend/db/schema.sql` (PostgreSQL) para una migración posterior; el diseño de ese esquema todavía no incluye jornadas, promociones ni pedidos.
- **No incluido:** pago mixto (varios medios en una venta), sincronización con la nube, autenticación por rol más allá del PIN de jornada, y el licenciamiento por hardware que usa el producto analizado.
- **Carritos abandonados:** el stock reservado en un carrito sin cobrar queda retenido hasta limpiar o cancelar ese carrito (al recargar la página se retoma el mismo carrito).
- Proyecto original e independiente: no usa código, marca ni recursos de ningún producto existente.
