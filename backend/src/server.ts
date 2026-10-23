import { SimulatedGateway } from '@nexus/core';
import { createApp } from './app';
import { DATA_DIR, loadSecret } from './config';
import { FileTenantStorage, TenantManager } from './tenants';

const PORT = Number(process.env.PORT ?? 3001);
const secret = loadSecret('NEXUS_SECRET', 'secret.key');
const admin = loadSecret('NEXUS_ADMIN_KEY', 'admin.key');

const app = createApp({
  manager: new TenantManager(new FileTenantStorage(DATA_DIR)),
  secret: secret.value,
  adminKey: admin.value,
  gateway: new SimulatedGateway({ delayMs: Number(process.env.TERMINAL_DELAY_MS ?? 1500) }),
  allowedOrigins: process.env.ALLOWED_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean),
});

app.listen(PORT, () => {
  console.log(`Nexus API en http://localhost:${PORT}  (datos: ${DATA_DIR})`);
  if (admin.created) console.log(`\nClave de administrador generada (guárdala): ${admin.value}\nTambién está en ${DATA_DIR}\\admin.key\n`);
  else console.log('Clave de administrador: la de la variable NEXUS_ADMIN_KEY o el archivo admin.key');
});
