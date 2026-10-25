# Nexus — guía para trabajar en este proyecto

Control de inventario, ventas y caja para negocios chilenos, **multicliente** (cada negocio entra con su RUT y clave). Sistema de **control interno**: sus comprobantes NO son documentos tributarios (sin boletas, folios, XML ni SII). Todo el texto visible está en español de Chile.

## Estructura
- `core/` — motor de ventas en TypeScript puro (`PosEngine`): inventario por canal con reservas, jornadas, pagos, promos, pedidos abiertos, convenio, compras, kardex, reportes. Es síncrono y atómico. **La lógica del negocio vive aquí.**
- `backend/` — Express: login (scrypt + sesiones firmadas), un negocio aislado por cliente (`TenantManager`), un endpoint RPC (`/api/rpc/:método`, lista en `core/src/rpc.ts`), administración de clientes, respaldos automáticos. Guarda en archivos JSON detrás de `TenantStorage`.
- `frontend/` — React + Vite. Habla con el servidor solo por `api.rpc.*` (tipado desde el motor). Panel del proveedor en `/#superadmin`.
- `docs/EVIDENCIA.md` — qué se vio/infirió/desconoce del producto analizado con REA.

## Comandos (en PowerShell usar `npm.cmd` si `npm` falla por la política de scripts)
```
npm run dev:local        # API (3001) + web (5173) juntos
npm test                 # pruebas del motor y del servidor
npm run typecheck        # core, backend y frontend
npm run build            # compila la app web
npm run cliente -- crear <rut> "<nombre>" <clave>   # también: listar, clave, activar, desactivar, respaldar, respaldos
```
Las terminales nuevas parten en la carpeta de arriba: hacer `cd` a `pos-chile` primero.

## Reglas de trabajo (decisiones del dueño)
- **Se trabaja y se prueba en local.** No desplegar a ningún hosting (Netlify, Railway, Fly…) ni subir a `main` sin que el dueño lo pida. Cada deploy gasta créditos del plan gratis.
- Trabajar en la rama **`dev`**. `main` es de Eduardo y del sitio publicado: antes de empezar hacer `git fetch` y, si hay cambios nuevos en `main`, unirlos a `dev` y correr todo.
- No hacer `git push` sin permiso explícito. Mensajes de commit en español, con la línea `Co-Authored-By` que indique el entorno.
- Destino de publicación: Railway (un solo servicio con la API y la app web). Mientras tenga cerrados los registros, no hay despliegue. Hay `Dockerfile` y `fly.toml` listos como plan B.
- Nunca guardar ni repetir claves, tokens ni la URL con token de la demo analizada. No abrir `.mcp.json` ni archivos `*token*`.

## Convenciones
- Montos en CLP **enteros**; los precios publicados llevan IVA 19 % (`splitIva`/`addIva` en `core/src/money.ts`). Los precios de entrada de compras/ingreso se digitan **netos**.
- Todo cambio de lógica lleva prueba en `core/test` o `backend/test`; cerrar con `typecheck`, `test` y `build` en verde.
- Los tipos del servidor y del frontend salen del motor: al agregar un método público, añadirlo a `core/src/rpc.ts` (lectura o escritura) o no existirá en la API.
- La UI no debe decir «boleta», «folio» ni «SII». «Boleta» solo existe como tipo de documento de **compra a proveedores**.
- El cobro con tarjeta es simulado (`SimulatedGateway`). El progreso del pago usa SSE y, si falla, consulta el estado cada 1,5 s.

## Cómo probar de punta a punta
Arrancar con datos temporales (no ensuciar `backend/data`): `NEXUS_DATA=<carpeta temporal> npm run dev:local`, crear un cliente con el comando `cliente`, entrar por el navegador y recorrer el flujo. Borrar la carpeta temporal al terminar.

## Pendiente conocido
Editar PIN de cajero y cambio rápido de turno · importar productos por CSV · pago mixto · guardado asíncrono / Postgres · términos de servicio y política de privacidad · elegir hosting definitivo.

## Delegar a subagentes (para no llenar el contexto del agente principal)
Conviene delegar lo que **lee mucho y devuelve poco**: investigar documentación o precios (pedir ≤ 15 líneas con fuentes), correr typecheck/pruebas/build y reportar solo fallos, recorrer un flujo en el navegador, revisar un diff. El agente principal conserva las decisiones y las ediciones acopladas entre sí. Cada subagente empieza sin contexto: el encargo debe nombrar archivos, el resultado esperado y qué NO tocar. Dos agentes que editan nunca deben tocar los mismos archivos.
