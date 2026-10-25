import fs from 'node:fs';
import path from 'node:path';
import { SimulatedGateway } from '@nexus/core';
import { createApp } from './app';
import { DATA_DIR, loadSecret } from './config';
import { FileTenantStorage, TenantManager } from './tenants';

const PORT = Number(process.env.PORT ?? 3001);
const secret = loadSecret('NEXUS_SECRET', 'secret.key');
const admin = loadSecret('NEXUS_ADMIN_KEY', 'admin.key');

// La app web compilada (npm run build) la entrega este mismo servidor, si existe.
const staticDir = process.env.NEXUS_STATIC ?? path.join(import.meta.dirname, '..', '..', 'frontend', 'dist');
const serveWeb = fs.existsSync(path.join(staticDir, 'index.html'));

// Detrás de Railway, Render, Fly… hay un proxy: sin esto todos los usuarios compartirían IP.
const behindProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME ? 1 : 0;

const app = createApp({
  manager: new TenantManager(new FileTenantStorage(DATA_DIR)),
  secret: secret.value,
  adminKey: admin.value,
  gateway: new SimulatedGateway({ delayMs: Number(process.env.TERMINAL_DELAY_MS ?? 1500) }),
  allowedOrigins: process.env.ALLOWED_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean),
  staticDir: serveWeb ? staticDir : undefined,
  trustProxy: behindProxy,
});

app.listen(PORT, () => {
  console.log(`Nexus en http://localhost:${PORT}  (datos: ${DATA_DIR})`);
  console.log(serveWeb ? `Entrega también la app web desde ${staticDir}` : 'Solo API (la app web se sirve aparte, por ejemplo con npm run dev:local)');
  if (admin.created) console.log(`\nClave de administrador generada (guárdala): ${admin.value}\nTambién está en ${path.join(DATA_DIR, 'admin.key')}\n`);
  else console.log('Clave de administrador: la de la variable NEXUS_ADMIN_KEY o el archivo admin.key');
});
