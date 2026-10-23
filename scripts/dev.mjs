// Arranca el servidor (API) y la app web juntos, en local. Uso: npm run dev:local
// Invoca node directamente (sin pasar por npm.ps1), así funciona aunque PowerShell bloquee scripts.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const PORT = process.env.PORT ?? '3001';

const tsx = require.resolve('tsx/cli');
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
if (!existsSync(vite)) throw new Error('No encuentro vite: ejecuta "npm install" primero.');

const procs = [
  spawn(process.execPath, [tsx, 'watch', 'src/server.ts'], { cwd: path.join(root, 'backend'), stdio: 'inherit', env: { ...process.env, PORT } }),
  spawn(process.execPath, [vite], { cwd: path.join(root, 'frontend'), stdio: 'inherit', env: { ...process.env, VITE_API_URL: `http://localhost:${PORT}` } }),
];

const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exit(code ?? 0); }));

console.log(`\nNexus en local:\n  App web:  http://localhost:5173\n  API:      http://localhost:${PORT}\n  Crear un cliente:  npm run cliente -- crear 76123456-0 "Mi Negocio" clave-segura\n`);
