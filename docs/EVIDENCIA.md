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

## Hallazgos: panel de ventas y menú de la tuerca (2026-10-19)
Método: navegador integrado en solo lectura (texto de página y DOM). No se usó REA en esta pasada. `/admin` exige login y **no se accedió**.

| Componente | Estado | Evidencia |
|---|---|---|
| `/panel`: filtros Desde/Hasta y atajos Hoy/Semana/Mes/Año; exportar Excel y JSON; enlaces a POS y Admin; tema claro/oscuro | [VISTO] | Texto de la página |
| 8 KPI: ventas/boletas (con rango de folios), ingresos, ticket promedio, utilidad bruta (con margen), ítems vendidos, descuentos, anuladas, costo estimado; cada uno con variación % frente al período anterior | [VISTO] | Texto de la página |
| Gráficos: tendencia diaria (ventas e ingresos), medios de pago, ingresos por categoría, ventas por día de la semana y por hora | [VISTO] | Títulos de sección |
| Rankings: top productos (unidades, ingresos, utilidad, margen), rendimiento por categoría, promociones aplicadas | [VISTO] | Tablas |
| Menú ⚙️ del POS: Pantalla (claro/oscuro, completa, info superior, formas de pago visibles, detalle compacto, tamaño de botones y fuente, resolución); Catálogo (buscar productos, código de barras, ver todos); Sistema (respaldar base de datos, recargar POS); Gestión (Administración, Panel de Ventas, Ayuda, Guard) | [VISTO] | DOM |
| Menú "Folios": muestra folios restantes | [VISTO] | DOM (en la demo, 999.976) |
| Menú "Jornada" (apertura/cierre de turno) | [VISTO] el nombre · [DESCONOCIDO] el contenido | DOM |
| Menú "Sincronizar": sincronización rápida, descarga completa de productos, sincronizar ventas | [VISTO] | DOM |
| Botón "Promociones" y botón "Pedidos" (pedidos abiertos) | [VISTO] | DOM |
| Contenido de Administración y de "Guard" | [DESCONOCIDO] | Requiere login |

## Análisis profundo del código del POS y del panel (2026-10-19)
Método: REA (`inspect_web_page` con fuentes + `export_web_scripts`) sobre `/pos` y `/panel`, y lectura del script de 45 KB. REA no ejecuta el JS: lo siguiente es lo que el código **hace**, no lo que el servidor responde.

**Cliente en la venta (campo "Nombre o RUT del cliente")**

| Hallazgo | Estado |
|---|---|
| Autocompletado: a partir de 2 caracteres, espera 250 ms y llama `GET /pos/customers/search?q=…`; devuelve una lista JSON con `id`, `name`, `tax_id` (RUT) e `is_vip` | [VISTO] en el código |
| Se navega con flechas, Enter selecciona o guarda el texto, Esc cierra | [VISTO] |
| Al elegir: muestra botón de limpiar e insignia **VIP** y guarda en el carrito con `POST /pos/cart/customer` (`customer_id`, `customer_name`, form-urlencoded) | [VISTO] |
| Se puede dejar un nombre libre sin cliente registrado (`customer_id` vacío) | [INFERIDO] |
| Qué hace VIP (descuentos, etc.) y campos de cliente: dirección, giro, correo | [DESCONOCIDO] |

**Menú ⚙️ (todo es preferencia local en `localStorage`, salvo lo marcado)**

| Opción | Claves/acción | Estado |
|---|---|---|
| Claro/Oscuro | `pos-theme` | [VISTO] |
| Pantalla completa | API del navegador | [VISTO] |
| Ver info superior | `pos-header-hidden` | [VISTO] |
| Formas de pago siempre visibles | `pos-pay-collapsed` | [VISTO] |
| Detalle de venta compacto | `pos-compact-cart` | [VISTO] |
| Tamaño de botones y de fuente (− / +, % ) | `pos-product-size-scale`, `pos-product-font-scale` | [VISTO] |
| Resolución de pantalla | diálogo con tarjetas (tamaño, orientación) | [VISTO] |
| Buscar productos / Código de barras / Ver todos los productos | `pos-show-product-search`, `pos-show-barcode-input`, `pos-show-all-category-button` | [VISTO] |
| Respaldar base de datos | `POST /pos/database/backup`, responde "Respaldo OK" | [VISTO] |
| Modo offline | `POST /pos/system/offline` (`offline=on/off`), responde `{ok, message}` | [VISTO] |
| Recargar POS | `location.reload()` | [VISTO] |
| Gestión: Administración `/admin`, Panel `/panel`, Ayuda `/ayuda`, Guard `/guard` | enlaces | [VISTO] los destinos · [DESCONOCIDO] su contenido |
| Atajo: al teclear un dígito, el foco va al campo de código de barras | | [VISTO] |

**Jornada y Folios:** menú Jornada con `/pos/history` (Historial), `/pos/sales/boletas` (JSON de boletas), `/shift/info` (Info Jornada) y `/shift/close` (Cerrar Jornada), estos dos abren un modal [VISTO]; su contenido [DESCONOCIDO]. Folios muestra "Folio actual" y "Folios restantes" [VISTO].

**Pedidos abiertos:** `GET /pos/tickets` abre un modal con vista de tarjetas o tabla (se recuerda en `pos.tickets.view`) y filtro de texto; insignia con el conteo; al reanudar un pedido el modal se cierra [VISTO]. **Comanda:** `GET /pos/tickets/:id/comanda` (JSON) y reimpresión `POST /pos/tickets/:id/comanda/print`; también se puede enviar a un **agente de impresión local** por HTTP (`POST` JSON a una URL base) [VISTO]. Esto sugiere uso en restaurantes/cocina [INFERIDO].

**Cobro:** efectivo abre un modal (`/pos/quickpay?method=cash`); métodos sin terminal confirman directo; métodos con terminal primero hacen `GET /pos/payment/health?method=…` (¿terminal disponible?), luego escuchan eventos `intermediate` por SSE (`response_message`, `response_code`, `time`) mientras `GET /pos/quickpay?method=…` espera el resultado, y se puede abortar con `POST /pos/payment/cancel`. Éxito o error se deducen por las clases `alert-success`/`alert-error` del HTML [VISTO]. Los códigos de respuesta del terminal y el formato de sus mensajes [DESCONOCIDO].

**Panel (`/panel`):** el servidor inyecta los datos en el JS (arreglos de etiquetas y valores); gráficos con **Chart.js**: tendencia (línea, doble eje), medios de pago (dona; "Otro" y **"convenio"** existen como método), categorías (barras horizontales), día de la semana y hora (barras). Atajos Hoy/Semana/Mes/Año envían el formulario con `from`/`to`. Exportación: `GET /panel/export?format=csv|json&from=…&to=…` (el botón dice "Excel" pero exporta CSV) [VISTO]. Paleta de 10 colores y tema claro/oscuro compartido con el POS (`pos-theme`) [VISTO].

**No analizado (el clasificador bloqueó consultas directas a datos de la demo y `/admin` pide login):** contenido de Info Jornada, Cerrar Jornada, Historial, Pedidos, Promociones, menú Sincronizar, Guard, Ayuda y Administración [DESCONOCIDO].

## Secciones confirmadas con capturas y lectura de páginas (2026-10-19)
Fuente: capturas que envió el usuario + lectura en solo lectura de `/pos/history`, `/ayuda` y `/guard` (navegador integrado).

| Sección | Hallazgo | Estado |
|---|---|---|
| **Info Jornada** | Estado (abierta), cajero, terminal (CAJA1), fecha y hora de apertura, tiempo transcurrido, efectivo inicial, ventas (n y $) | [VISTO] |
| **Abrir jornada** | Botón central "Abrir Jornada": elegir cajero e ingresar fondo inicial; sin jornada abierta no se puede cobrar | [VISTO] (Ayuda) |
| **Cerrar jornada** | Efectivo en caja, notas y **monto contado por forma de pago** (cada una con la venta esperada); el sistema calcula total, transacciones, efectivo esperado (= fondo + efectivo recibido − vueltos) y diferencia | [VISTO] |
| **Pedidos abiertos** | Modal con contador y vacío "Arma una venta y usa «Dejar pedido abierto»"; vistas tarjetas/tabla y buscador | [VISTO] |
| **Dejar pedido abierto** | Nombre del cliente (obligatorio), teléfono/WhatsApp, correo, **canal** (Teléfono…), observación, **Pendiente de pago / Ya pagó** (emite la boleta al instante), guardar imprime la comanda | [VISTO] |
| **WhatsApp desde un pedido** | Plantillas Pedido listo, En preparación, Detalle, Aviso; enlace `wa.me`, +56 automático a números de 9 dígitos, mensaje editable; no hay API ni confirmación de envío | [VISTO] (Ayuda) |
| **Carrito** | Número de pedido, campo de cliente, ✕ para quitar, duplicar ítem, "Dejar pedido abierto", métodos de pago configurables: Efectivo, Débito, Crédito, cheque, transferencia, convenio | [VISTO] |
| **Efectivo** | Diálogo con monto recibido y cálculo de vuelto; débito/crédito cobran el monto exacto; **pago mixto** con botón Checkout | [VISTO] (Ayuda) |
| **Promociones** | Menú: "Ver promociones activas" y "Aplicar código promo"; la lista muestra nombre, tipo (% porcentaje), valor, código, válida hasta y "Aplicar". Se administran desde Administración → Descuentos y promociones (porcentaje, monto fijo y condiciones) | [VISTO] |
| **Sincronizar** | Sincronización rápida, descargar productos (completo), sincronizar ventas: sincroniza con una nube; Nexus no lo necesita | [VISTO] |
| **Historial** (`/pos/history`) | Últimas 100 ventas, filtros Todas/Jornada actual y rango de fechas, KPI (ventas, total, alcance), tabla fecha/hora/folio/terminal/total/estado/sync, "Ver boleta", exportar Excel y JSON | [VISTO] |
| **Administración** | Productos (nombre, SKU, código, precio, **costo**, categoría, impuesto, color, activo), Categorías, Cajeros (nombre, PIN, activo), Descuentos y promociones, Inventario (ajustes e historial), Clientes (nombre, RUT, correo, teléfono, VIP), Jornadas (estado, cajero, fechas, fondo, ventas, esperado, cierre, diferencia) | [VISTO] (Ayuda) |
| **Guard** | Protección de instalación: huella del equipo, vincular al hardware, modo desarrollo/desplegado. Es licenciamiento de su software | [VISTO] · fuera de alcance para Nexus |
| Tecnología observada | App local con base **SQLite** que funciona sin internet y se respalda automáticamente | [VISTO] (Ayuda) |

## Qué falta para pasar de DESCONOCIDO a VISTO
Una de estas entradas, con autorización sobre la app:
1. URL pública de la tienda/POS → `capture-browser-scenario`, `analyze-web-bundle`, `inspect-web-network-capture` (HAR).
2. Carpeta o `.asar` de la app Electron → `analyze-javascript-application`, `inspect-electron-fuses`.
3. Un HAR exportado desde las DevTools.

Hasta entonces, este proyecto es un diseño original, no una réplica verificada.
