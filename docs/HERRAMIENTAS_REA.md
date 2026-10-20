# Herramientas REA que se activarán

Todas existen en el catálogo de `rea` 6.7.0 (`rea --help`). Requieren una entrada concreta (URL, carpeta, ASAR o HAR).

## Flujo web / tienda online
| Herramienta | Uso |
|---|---|
| `inspect-web-page` | Inspección pasiva de una página vía CDP |
| `analyze-web-bundle` | Captura y análisis estático del bundle JS |
| `capture-browser-scenario` | Escenario Playwright acotado → evidencia |
| `capture-web-screenshot` | Capturas de la UI para replicar el diseño |
| `inspect-web-network-capture` | Leer HAR / mitmproxy / SAZ: endpoints y forma de las peticiones |
| `compare-web-captures` | Comparar dos capturas (p. ej. antes/después de agregar al carrito) |
| `discover-webmcp-tools` | Herramientas WebMCP declaradas por la página |

## Escritorio Electron (POS de caja)
| Herramienta | Uso |
|---|---|
| `analyze-javascript-application` | Reconstrucción estática de una app Electron/JS |
| `inspect-electron-fuses` | Fuses del empaquetado, sin ejecutar |
| `inspect-electron-page` | Inspección pasiva de una página de la app |
| `capture-electron-scenario` | Escenario de ejecución con acciones cancelables |
| `extract-artifact` | Extraer el contenido de un instalador/archivo |
| `inspect-sqlite-database` | Esquema de una BD SQLite local (si la app tiene una) |

## Cierre de la reconstrucción
| Herramienta | Uso |
|---|---|
| `build-reconstruction-obligation-ledger` | Lista de obligaciones respaldadas por evidencia |
| `evaluate-reconstruction-coverage` | Cobertura de la reconstrucción frente a la evidencia |
| `compare-source-to-bundle` | Comparar código propio contra el bundle analizado |

## Estado
El servidor MCP **no está registrado** en Claude Code (`rea setup` pendiente de autorización). Las herramientas se pueden usar igualmente desde la CLI `rea <comando>`.
