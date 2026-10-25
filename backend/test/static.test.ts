import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FileTenantStorage, TenantManager } from '../src/tenants';

let dir: string;
let web: string;
let server: http.Server;
let base: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-static-'));
  web = path.join(dir, 'web');
  fs.mkdirSync(path.join(web, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Nexus</title><div id="root"></div>');
  fs.writeFileSync(path.join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
  const app = createApp({ manager: new TenantManager(new FileTenantStorage(path.join(dir, 'data'))), secret: 's', adminKey: 'a', staticDir: web });
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('el servidor entrega la app web', () => {
  it('sirve la página en la raíz y en rutas de la app (para recargar sin error)', async () => {
    for (const p of ['/', '/panel', '/cualquier/ruta']) {
      const r = await fetch(base + p);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('<div id="root">');
      expect(r.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('los archivos con nombre único se guardan por mucho tiempo', async () => {
    const r = await fetch(`${base}/assets/app-abc123.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('immutable');
  });

  it('una ruta /api que no existe responde JSON, no la página', async () => {
    const r = await fetch(`${base}/api/no-existe`);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect((await r.json()).code).toBe('NOT_FOUND');
    expect((await (await fetch(`${base}/api/health`)).json()).ok).toBe(true);
  });
});

describe('sin app compilada', () => {
  it('responde solo la API', async () => {
    const app = createApp({ manager: new TenantManager(new FileTenantStorage(path.join(dir, 'data2'))), secret: 's', adminKey: 'a', staticDir: path.join(dir, 'no-existe') });
    const s = http.createServer(app).listen(0);
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    expect((await fetch(`${url}/`)).status).toBe(404);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    s.closeAllConnections();
    s.close();
  });
});
