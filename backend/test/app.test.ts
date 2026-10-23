import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedGateway } from '@nexus/core';
import { createApp } from '../src/app';
import { LoginLimiter } from '../src/auth';
import { FileTenantStorage, TenantManager } from '../src/tenants';

const ADMIN = 'clave-admin-de-prueba';
const SECRET = 'secreto-de-prueba';
const PEPE = { rut: '12.345.678-5', name: 'Almacén Don Pepe', password: 'clave-pepe-123' };
const LUCIA = { rut: '11.111.111-1', name: 'Minimarket Lucía', password: 'clave-lucia-456' };

let dir: string;
let server: http.Server;
let base: string;
let manager: TenantManager;

function start(limiter?: LoginLimiter) {
  manager = new TenantManager(new FileTenantStorage(dir));
  const app = createApp({ manager, secret: SECRET, adminKey: ADMIN, gateway: new SimulatedGateway({ delayMs: 0 }), limiter });
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const stop = () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });

async function call(method: string, url: string, opts: { body?: unknown; token?: string; admin?: string } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.admin ? { 'x-admin-key': opts.admin } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const rpc = (token: string, name: string, ...args: unknown[]) => call('POST', `/api/rpc/${name}`, { token, body: { args } });
async function createTenant(t: typeof PEPE) {
  return call('POST', '/api/admin/tenants', { admin: ADMIN, body: t });
}
async function login(t: typeof PEPE) {
  const r = await call('POST', '/api/auth/login', { body: { rut: t.rut, password: t.password } });
  return r.body.token as string;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
  start();
});
afterEach(async () => {
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('administración de clientes', () => {
  it('solo el administrador puede crear y listar clientes', async () => {
    expect((await call('POST', '/api/admin/tenants', { body: PEPE })).status).toBe(401);
    expect((await call('POST', '/api/admin/tenants', { admin: 'incorrecta', body: PEPE })).status).toBe(401);
    expect((await call('GET', '/api/admin/tenants')).status).toBe(401);
    const created = await createTenant(PEPE);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ rut: '12345678-5', name: 'Almacén Don Pepe', active: true });
    expect(created.body.passwordHash).toBeUndefined();
    const list = await call('GET', '/api/admin/tenants', { admin: ADMIN });
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('scrypt');
  });

  it('valida RUT, clave y duplicados', async () => {
    expect((await createTenant({ ...PEPE, rut: '12.345.678-9' })).status).toBe(400);
    expect((await createTenant({ ...PEPE, password: 'corta' })).status).toBe(400);
    expect((await createTenant({ ...PEPE, name: '  ' })).status).toBe(400);
    expect((await createTenant(PEPE)).status).toBe(201);
    expect((await createTenant({ ...PEPE, rut: '12345678-5' })).status).toBe(409);
  });

  it('se puede desactivar un cliente y cambiarle la clave', async () => {
    await createTenant(PEPE);
    const token = await login(PEPE);
    expect((await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { active: false } })).body.active).toBe(false);
    expect((await rpc(token, 'getBusiness')).status).toBe(401); // la sesión abierta deja de servir
    expect((await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: PEPE.password } })).status).toBe(401);
    await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { active: true, password: 'otra-clave-999' } });
    expect((await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: PEPE.password } })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: 'otra-clave-999' } })).status).toBe(200);
    expect((await call('PATCH', '/api/admin/tenants/11111111-1', { admin: ADMIN, body: { active: false } })).status).toBe(404);
  });
});

describe('cambios hechos por otro proceso (el comando cliente)', () => {
  it('un cliente creado o desactivado desde fuera se nota sin reiniciar el servidor', async () => {
    const cli = new TenantManager(new FileTenantStorage(dir)); // otro proceso, mismos archivos
    cli.create(PEPE);
    expect((await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: PEPE.password } })).status).toBe(200);
    const token = await login(PEPE);
    cli.setActive(PEPE.rut, false);
    expect((await rpc(token, 'getBusiness')).status).toBe(401);
    cli.setActive(PEPE.rut, true);
    cli.setPassword(PEPE.rut, 'clave-nueva-777');
    expect((await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: PEPE.password } })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: 'clave-nueva-777' } })).status).toBe(200);
  });
});

describe('inicio de sesión', () => {
  beforeEach(async () => { await createTenant(PEPE); });

  it('entra con RUT (con o sin puntos) y clave correcta', async () => {
    const a = await call('POST', '/api/auth/login', { body: { rut: '12.345.678-5', password: PEPE.password } });
    expect(a.status).toBe(200);
    expect(a.body.business).toEqual({ name: 'Almacén Don Pepe', rut: '12345678-5' });
    expect((await call('POST', '/api/auth/login', { body: { rut: '123456785', password: PEPE.password } })).status).toBe(200);
    const me = await call('GET', '/api/auth/me', { token: a.body.token });
    expect(me.body).toEqual({ name: 'Almacén Don Pepe', rut: '12345678-5' });
  });

  it('da el mismo error si el RUT no existe o la clave es mala (no delata cuentas)', async () => {
    const mala = await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: 'incorrecta-123' } });
    const noExiste = await call('POST', '/api/auth/login', { body: { rut: LUCIA.rut, password: 'incorrecta-123' } });
    expect(mala.status).toBe(401);
    expect(noExiste.status).toBe(401);
    expect(mala.body).toEqual(noExiste.body);
    expect((await call('POST', '/api/auth/login', { body: {} })).status).toBe(401);
  });

  it('bloquea tras 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: 'mala-clave-1' } });
    const bloqueado = await call('POST', '/api/auth/login', { body: { rut: PEPE.rut, password: PEPE.password } });
    expect(bloqueado.status).toBe(429);
  });

  it('sin sesión no se accede a los datos', async () => {
    expect((await call('POST', '/api/rpc/listProducts', { body: { args: [] } })).status).toBe(401);
    expect((await rpc('token-falso', 'listProducts')).status).toBe(401);
    expect((await call('POST', '/api/carts/x/pay', { body: { method: 'cash' } })).status).toBe(401);
    expect((await call('GET', '/api/payments/x/events')).status).toBe(401);
  });
});

describe('aislamiento entre clientes y persistencia', () => {
  it('cada cliente parte con su negocio vacío y no ve los datos de otro', async () => {
    await createTenant(PEPE);
    await createTenant(LUCIA);
    const a = await login(PEPE);
    const b = await login(LUCIA);
    expect((await rpc(a, 'listProducts')).body).toEqual([]);
    expect((await rpc(a, 'listCashiers')).body).toEqual([]);
    await rpc(a, 'receiveStock', 'branch_1', { barcode: '7801', name: 'Leche', costClp: 700, priceNetClp: 1000, quantity: 10 });
    await rpc(a, 'upsertCashier', { name: 'Pepe', pin: '1234' });
    expect((await rpc(a, 'listProducts')).body).toHaveLength(1);
    expect((await rpc(b, 'listProducts')).body).toEqual([]);
    expect((await rpc(b, 'listCashiers')).body).toEqual([]);
    expect((await rpc(b, 'findProduct', '7801')).body).toBeNull();
    expect((await rpc(a, 'getBusiness')).body).toMatchObject({ name: 'Almacén Don Pepe', rut: '12345678-5' });
    expect((await rpc(b, 'getBusiness')).body).toMatchObject({ name: 'Minimarket Lucía' });
  });

  it('los datos siguen ahí al reiniciar el servidor (el historial del primer día se ve el segundo)', async () => {
    await createTenant(PEPE);
    const t1 = await login(PEPE);
    const cashier = (await rpc(t1, 'upsertCashier', { name: 'Pepe', pin: '4321' })).body;
    await rpc(t1, 'receiveStock', 'branch_1', { barcode: '7801', name: 'Leche', costClp: 700, priceNetClp: 1000, quantity: 10 });
    await rpc(t1, 'openShift', cashier.id, '4321', 5000);
    const cart = (await rpc(t1, 'createCart', 'branch_1', 'physical')).body;
    await rpc(t1, 'cartAdd', cart.id, '7801', 2);
    const pay = await call('POST', `/api/carts/${cart.id}/pay`, { token: t1, body: { method: 'cash', receivedClp: 5000 } });
    expect(pay.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect((await rpc(t1, 'listSales')).body).toHaveLength(1);

    await stop();
    start(); // "día siguiente": servidor nuevo, mismos archivos
    const t2 = await login(PEPE);
    const sales = (await rpc(t2, 'listSales')).body;
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ number: 1, totalClp: 2380, status: 'completed' });
    expect((await rpc(t2, 'findProduct', '7801')).body).toMatchObject({ name: 'Leche' });
    expect((await rpc(t2, 'shiftInfo')).body).toMatchObject({ salesCount: 1 });
    expect((await rpc(t2, 'inventory', 'branch_1')).body[0].physical.qty).toBe(8);
  });

  it('el cobro por la API funciona de punta a punta y avisa por eventos', async () => {
    await createTenant(PEPE);
    const t = await login(PEPE);
    const cashier = (await rpc(t, 'upsertCashier', { name: 'Pepe', pin: '4321' })).body;
    await rpc(t, 'receiveStock', 'branch_1', { barcode: '7801', name: 'Leche', costClp: 700, priceNetClp: 1000, quantity: 3 });
    await rpc(t, 'openShift', cashier.id, '4321', 0);
    const cart = (await rpc(t, 'createCart', 'branch_1', 'physical')).body;
    await rpc(t, 'cartAdd', cart.id, '7801', 1);
    const pay = (await call('POST', `/api/carts/${cart.id}/pay`, { token: t, body: { method: 'debit' } })).body;
    const res = await fetch(`${base}/api/payments/${pay.id}/events?token=${t}`);
    const text = await res.text();
    expect(text).toContain('"type":"approved"');
    expect((await rpc(t, 'getPayment', pay.id)).body.status).toBe('approved');
  });

  it('los errores del motor llegan con su código', async () => {
    await createTenant(PEPE);
    const t = await login(PEPE);
    const r = await rpc(t, 'cartAdd', 'no-existe', 'x', 1);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
    expect((await call('POST', '/api/rpc/borrarTodo', { token: t, body: { args: [] } })).status).toBe(404);
  });
});
