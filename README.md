# Nexus · control de inventario, ventas y caja para negocios en Chile

Sistema para que cada negocio lleve el control de su inventario, sus ventas y su caja: **Caja** (punto de venta), **Tienda online**, **inventario por canal**, **jornadas con arqueo**, **clientes con convenio**, **compras a proveedores**, **panel de ventas** e **historial**.

> **Nexus es un sistema de control interno.** Sus comprobantes de venta **no son documentos tributarios** (no son boletas ni facturas del SII) y los pagos con tarjeta no se cobran desde el sistema: se registra la venta con el medio de pago usado en el terminal del negocio.

Construido con **Claude Code + [REA](https://github.com/morluto/rea)**: el comportamiento de un POS web público se analizó con REA y se reconstruyó con código propio. Lo visto, lo inferido y lo desconocido está en [`docs/EVIDENCIA.md`](docs/EVIDENCIA.md).

## Cómo funciona (multicliente)

- Cada cliente entra con el **RUT de su negocio y una clave**. Su negocio parte **vacío**: sin productos, stock, clientes ni cajeros.
- Los datos de cada negocio viven en el **servidor** y están **aislados**: nadie ve los de otro. El historial (ventas del primer día, del segundo…) queda guardado y se ve al volver a entrar, desde cualquier equipo.
- Las claves se guardan **cifradas** (scrypt); las sesiones son firmadas y vencen a las 12 horas; el inicio de sesión se bloquea tras 5 intentos fallidos.
- El primer ingreso pide los datos del negocio y crea el primer cajero. Después, el cliente carga su inventario **escaneando** los códigos de barras (Administración → Ingreso por escaneo): si el producto no existe se crea con su costo y precio neto; si existe, suma stock.

## Estructura

```
core/       motor de ventas en TypeScript puro (inventario, pagos, jornada, promos, pedidos, convenio, reportes) + 83 pruebas
backend/    API Express: login, sesiones, un negocio aislado por cliente, administración de clientes + 21 pruebas
frontend/   React + Vite
docs/       evidencia REA (VISTO / INFERIDO / DESCONOCIDO)
scripts/    arranque local (dev.mjs)
```

## Probar en local

Requiere Node 22 o superior.

```bash
npm install
npm test               # pruebas del motor y del servidor
npm run dev:local      # servidor (http://localhost:3001) y app (http://localhost:5173) juntos
```

> En PowerShell, si `npm` falla por la política de scripts, usa `npm.cmd` en su lugar (por ejemplo `npm.cmd run dev:local`).

**Crear un cliente** (el servidor puede estar corriendo; lo reconoce al instante):

```bash
npm run cliente -- crear 76123456-0 "Almacén Don Pepe" clave-segura-123
npm run cliente -- listar
npm run cliente -- clave 76123456-0 nueva-clave-456
npm run cliente -- desactivar 76123456-0
```

También hay un panel web para ti en **`http://localhost:5173/#superadmin`**: pide la clave de administrador (se genera la primera vez que arranca el servidor, se imprime en la consola y queda en `backend/data/admin.key`) y permite crear clientes, generar claves, cambiarlas y desactivar accesos.

Los datos se guardan en `backend/data/` (no se sube a Git). Para usar otra carpeta: variable `NEXUS_DATA`.

## Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `VITE_API_URL` | al compilar la app web | Dirección del servidor. En desarrollo apunta sola a `http://localhost:3001` |
| `PORT` | servidor | Puerto (por defecto 3001) |
| `NEXUS_DATA` | servidor | Carpeta de datos |
| `NEXUS_SECRET` | servidor | Secreto para firmar las sesiones (si falta, se genera un archivo) |
| `NEXUS_ADMIN_KEY` | servidor | Clave de administrador (si falta, se genera un archivo) |
| `ALLOWED_ORIGIN` | servidor | Orígenes permitidos (CORS), separados por coma. Vacío = todos (solo desarrollo) |

## Alcance y límites

- **Sin documentos tributarios.** No emite boletas ni facturas ni se conecta al SII. El comprobante de venta interno lo dice en pantalla y en lo impreso.
- **Pagos con tarjeta simulados** dentro del sistema: sirven para registrar la venta, no cobran dinero.
- **Persistencia simple.** Hoy son archivos JSON en el servidor (uno por negocio), detrás de una interfaz (`TenantStorage`) pensada para pasar a Postgres. El servidor debe quedar siempre encendido y con su carpeta de datos en un disco persistente, con respaldos.
- **Pendiente:** términos de servicio y política de privacidad, respaldos automáticos en el servidor, pago mixto, nota de crédito al anular, edición del PIN de un cajero.
- Proyecto original e independiente: no usa código, marca ni recursos de ningún producto existente.
