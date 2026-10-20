# Registro de evidencia (estándar REA)

Etiquetas: **[VISTO]** observado con una herramienta REA · **[INFERIDO]** deducido, sin prueba directa · **[DESCONOCIDO]** sin información.

## Objetivo declarado: "Clico Chile"

| Componente | Estado | Nota |
|---|---|---|
| Existencia de una plataforma POS + tienda "Clico Chile" | [DESCONOCIDO] | Búsqueda web estándar (2026-10-19): sin resultados con ese nombre. Solo apareció *clicOH* (logística e-commerce), que es otro producto. |
| Stack, APIs, endpoints, modelo de datos | [DESCONOCIDO] | No se ha analizado ningún binario, ASAR, bundle web ni HAR del objetivo. |
| Integración Transbank / Mercado Pago / Getnet | [DESCONOCIDO] | Nada observado. El diseño del puente es **propio**, basado en documentación pública de cada proveedor. |
| Emisión de boletas SII | [DESCONOCIDO] | Ídem. Se diseña según el esquema DTE público del SII. |
| Un POS unificado necesita inventario compartido entre caja y tienda online | [INFERIDO] | Del requisito del usuario, no de evidencia técnica. |

## Hallazgos sobre https://clico.cl/ (2026-10-19)
Método: lectura de texto de páginas públicas (`/`, `/llms.txt`, `/tienda.html`) con WebFetch. **No** se usó REA todavía: sus herramientas web piden un navegador con endpoint CDP.

| Componente | Estado | Evidencia |
|---|---|---|
| Clico = POS web + tienda online (Clico Tienda) para pymes chilenas | [VISTO] | Texto de `/` y `/llms.txt` |
| Inventario sincronizado entre canales, descuento de stock por venta, historial, alertas de stock bajo | [VISTO] | Texto declarado en el sitio (no verificado en el producto) |
| Reportes: ventas, ticket promedio, formas de pago, tendencias por día/hora | [VISTO] | Idem |
| Boleta/factura electrónica SII como módulo opcional (Plan Avanzado) | [VISTO] | Idem |
| Terminales: Transbank, Mercado Pago, Getnet; Bci en proceso | [VISTO] | Idem. Cómo se integran: [DESCONOCIDO] |
| Hospedaje en SGO Cloud sobre Azure Chile | [VISTO] | Texto del sitio |
| Tiendas en `*.clico.tienda` / `*.clico.store` o dominio propio | [VISTO] | `/tienda.html` |
| Planes: Inicial $19.990 (1 sucursal, 1 POS, sin boleta), Avanzado desde $24.990 por módulos | [VISTO] | `/llms.txt`; configuración en `/plan-avanzado-config.json` (sin leer aún) |
| Módulos extra: tótem consultor de precios, autoservicio, catálogo "agéntico" para agentes de IA | [VISTO] | Texto del sitio |
| Sitio de marketing estático (rutas `.html`) | [INFERIDO] | Por las URLs; no verificado |
| Dónde vive la app POS (dominio, login) | [DESCONOCIDO] | Solo se accede pidiendo demo |
| Framework front/back, base de datos, endpoints de API | [DESCONOCIDO] | `/llms.txt` indica que no hay API pública |
| Flujo de carrito, checkout y medios de pago online | [DESCONOCIDO] | La página no lo describe |
| Mecanismo de sincronización de stock | [DESCONOCIDO] | No detallado |

## Hallazgos sobre la demo POS (demo.clico.cl/pos, 2026-10-19)
Método: navegador integrado, solo lectura (texto de página, red, 2 GET de lectura). Sin ventas ni cambios. El token de acceso **no** se guarda en este repo.

| Componente | Estado | Evidencia |
|---|---|---|
| App llamada "EVOLPOS" (marca Evol), versión `202609v1.2`, título "DEMO SPA" | [VISTO] | Título y pie de la página |
| UI: barra superior (sucursal, CAJA1, Folios, Jornada, ajustes), categorías de color, grilla táctil de productos con precio en CLP, buscador y código de barras, panel de pedido a la derecha (n.º de pedido, cliente nombre/RUT opcional, subtotal, total), Pedidos, Promociones, Sincronizar | [VISTO] | Captura y texto |
| Categorías "Promociones y frecuentes" y productos tipo minimarket con precios y promos | [VISTO] | Datos de demo |
| Sitio de servidor con HTML renderizado + htmx 1.9.12 (unpkg) y ~45 KB de JS inline | [VISTO] | Lista de scripts |
| `GET /pos/tickets/count` → `{"open":0}` (pedidos abiertos) | [VISTO] | Respuesta JSON |
| `GET /pos/catalog/status` → `pending, configured, signature, remote_version, synced_version, auto_sync_enabled, auto_sync_interval_minutes, offline_mode` | [VISTO] | Respuesta JSON |
| Catálogo sincronizado por versión remota vs local, con delta (`syncCatalogDeltaPOS`) y descarga completa (`downloadCatalogPOS`), y auto-sync cada N minutos | [VISTO] | Funciones globales + status. Detalle del delta: [DESCONOCIDO] |
| Modo offline (`offline_mode`), sin service worker ni IndexedDB visibles | [VISTO] | Campo + comprobación; cómo persiste los datos offline: [DESCONOCIDO] |
| Folios (boleta electrónica) como menú de caja | [INFERIDO] | Solo el nombre del menú |
| Backend en Python/PHP/Go/otro, base de datos | [DESCONOCIDO] | No observable desde el cliente |
| Flujo de cobro con terminales, emisión DTE, endpoints de venta | [DESCONOCIDO] | No se ejecutó ninguna venta |

## Hallazgos con REA sobre la demo POS (2026-10-19)
Herramientas: `list-browser-targets`, `analyze-web-bundle` (4 s de observación) e `inspect-web-page`, vía Chrome headless con CDP en loopback. Evidencia cruda, con el token redactado, en `docs/evidencia-rea/`. REA no ejecuta el JS capturado: son endpoints estáticos hallados en el código (confianza "observed", no prueban que se llamen).

| Componente | Estado | Evidencia REA |
|---|---|---|
| 5 scripts (45 KB el principal), sin source maps, 0 fallos de parseo | [VISTO] | `completeness: complete` |
| `POST/GET /pos/checkout` | [VISTO] | `fetch` en script 3, línea 3 |
| `/pos/quickpay?method=cash` (cobro rápido en efectivo) | [VISTO] | `fetch`, línea 787 |
| `/pos/payment/progress`, `/pos/payment/cancel` | [VISTO] | `fetch`, líneas 756 y 748 |
| `/pos/payment/events` por **EventSource (SSE)**: el estado del pago en el terminal llega por eventos del servidor | [VISTO] | línea 831 |
| `/pos/cart/customer` (asociar cliente al pedido) | [VISTO] | línea 988 |
| `/pos/tickets/count`, `/pos/catalog/status`, `/pos/catalog/autosync` | [VISTO] | líneas 538, 35 y 117 |
| `/admin/catalog/sync/delta` y `/admin/catalog/sync/products` (sincronización del catálogo) | [VISTO] | script 5, líneas 14 y 23 |
| `/pos/system/offline` y `/pos/database/backup` | [VISTO] | líneas 212 y 180 |
| Método HTTP, cuerpos y respuestas de cada endpoint | [DESCONOCIDO] | `include_json_body_shapes` estaba desactivado |
| Cómo se hace el cobro con Transbank/Getnet/MP (el POS llama al servidor; el servidor habla con el terminal) | [INFERIDO] | Por el patrón progress + SSE; sin ver el servidor |
| Emisión DTE y folios | [DESCONOCIDO] | Sin endpoint de DTE en el bundle del POS |
| `inspect-web-page` | [DESCONOCIDO] | Salió `policy_filtered`: la política de REA ocultó recursos, scripts y storage |

## Hallazgos con el MCP de REA: escenario de carrito (2026-10-19)
Herramientas: `mcp__rea__list_browser_targets`, `analyze_web_bundle` (con body shapes) y `capture_browser_scenario` (conectado por CDP; red con cuerpos). Escenario: agregar 1 producto al carrito y pulsar "Limpiar". **No se cobró nada.**

| Componente | Estado | Evidencia REA |
|---|---|---|
| Arquitectura **htmx**: el servidor devuelve fragmentos HTML y el cliente los inyecta en `#cart-container` (no es una SPA con API JSON) | [VISTO] | Respuesta `text/html`, cabeceras `HX-Request` / `HX-Target` |
| `POST /pos/cart/add` con cuerpo `application/x-www-form-urlencoded`: `product_id=<código de barras 13 dígitos>&quantity=1` → 200 con HTML del carrito | [VISTO] | Transacción request-8, cuerpo de 35 bytes |
| `POST /pos/cart/clear` (sin cuerpo) → 200 con HTML de carrito vacío | [VISTO] | request-9 |
| `POST /pos/cart/update` con `{index, quantity}` (quantity 0 = quitar una unidad) y `POST /pos/cart/remove` con `{index}` | [VISTO] | `hx-post` / `hx-vals` en el HTML devuelto |
| `GET /pos/tickets/form` (modal "Dejar pedido abierto") | [VISTO] | `hx-get` en el HTML |
| El carrito vive **en el servidor** y se identifica por posición (`index`), no por id de línea | [INFERIDO] | `index` en update/remove; sin ver la sesión |
| Métodos de pago como botones configurables por comercio: `cash` (sin terminal), `debit` y `credit` con `data-terminal="transbank"`, `cheque`, etc. | [VISTO] | `data-method` / `data-terminal` en el HTML. Cada método tiene color y etiqueta propios |
| `startPayment(this)` dispara el cobro; el progreso llega por `/pos/payment/events` (SSE) | [VISTO] + [INFERIDO] | Función `onclick` vista; la secuencia completa no se ejecutó |
| Cuerpos de `/pos/payment/*`, `/pos/checkout` y emisión de boleta | [DESCONOCIDO] | No se pagó |
| Persistencia del carrito entre recargas, sesión/cookie | [DESCONOCIDO] | Cabeceras no solicitadas |

> Nota: el token de la demo sigue siendo una credencial. No se guardó en este repo.

## Qué falta para pasar de DESCONOCIDO a VISTO
Una de estas entradas, con autorización sobre la app:
1. URL pública de la tienda/POS → `capture-browser-scenario`, `analyze-web-bundle`, `inspect-web-network-capture` (HAR).
2. Carpeta o `.asar` de la app Electron → `analyze-javascript-application`, `inspect-electron-fuses`.
3. Un HAR exportado desde las DevTools.

Hasta entonces, este proyecto es un diseño original, no una réplica verificada.
