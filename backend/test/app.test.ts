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
    expect(a.body.business).toEqual({ name: 'Almacén Don Pepe', rut: '12345678-5', webStore: false, slug: null });
    expect((await call('POST', '/api/auth/login', { body: { rut: '123456785', password: PEPE.password } })).status).toBe(200);
    const me = await call('GET', '/api/auth/me', { token: a.body.token });
    expect(me.body).toMatchObject({ name: 'Almacén Don Pepe', rut: '12345678-5', webStore: false, slug: null, terms: { required: false, accepted: false } });
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

describe('tienda web pública', () => {
  async function conTienda(slug?: string) {
    await createTenant(PEPE);
    const token = await login(PEPE);
    const r = await rpc(token, 'receiveStock', 'branch_1', { barcode: '7801', name: 'Leche 1L', category: 'Lácteos', priceNetClp: 1000, costClp: 700, quantity: 5 });
    await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { webStore: true, ...(slug ? { slug } : {}) } });
    return { token, productId: r.body.product.id as string };
  }

  it('sin el plan la tienda no existe; con el plan responde sin sesión y sin datos internos', async () => {
    await createTenant(PEPE);
    expect((await call('GET', '/api/public/almacen-don-pepe')).status).toBe(404);
    const { productId } = await conTienda();
    const r = await call('GET', '/api/public/almacen-don-pepe');
    expect(r.status).toBe(200);
    expect(r.body.business.name).toBe('Almacén Don Pepe');
    expect(r.body.products).toEqual([{ id: productId, name: 'Leche 1L', category: 'Lácteos', priceClp: 1190, available: 5 }]);
    expect(JSON.stringify(r.body)).not.toMatch(/cost|passwordHash|12345678/);
  });

  it('el nombre de la tienda no distingue mayúsculas de minúsculas', async () => {
    await conTienda();
    expect((await call('GET', '/api/public/ALMACEN-DON-PEPE')).status).toBe(200);
    expect((await call('GET', '/api/public/Almacen-Don-Pepe')).status).toBe(200);
  });

  it('desactivar el plan o el cliente cierra la tienda', async () => {
    await conTienda();
    await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { webStore: false } });
    expect((await call('GET', '/api/public/almacen-don-pepe')).status).toBe(404);
    await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { webStore: true } });
    expect((await call('GET', '/api/public/almacen-don-pepe')).status).toBe(200);
    await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { active: false } });
    expect((await call('GET', '/api/public/almacen-don-pepe')).status).toBe(404);
  });

  it('un pedido reserva stock, aparece en Pedidos del negocio y el precio lo pone el servidor', async () => {
    const { token, productId } = await conTienda();
    const o = await call('POST', '/api/public/almacen-don-pepe/orders', {
      body: { items: [{ productId, quantity: 2, unitPriceClp: 1 }], customerName: 'Ana', phone: '+56 9 8765 4321', privacyAccepted: true },
    });
    expect(o.status).toBe(201);
    expect(o.body.totalClp).toBe(2380);
    expect((await call('GET', '/api/public/almacen-don-pepe')).body.products[0].available).toBe(3);
    const tickets = (await rpc(token, 'listTickets')).body;
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ channel: 'web', paid: false, customerName: 'Ana' });
    const sobra = await call('POST', '/api/public/almacen-don-pepe/orders', { body: { items: [{ productId, quantity: 4 }], customerName: 'Beto', phone: '+56 9 8765 4321', privacyAccepted: true } });
    expect(sobra.status).toBe(409);
  });

  it('el pedido exige aceptar el aviso de privacidad', async () => {
    const { productId } = await conTienda();
    const sin = await call('POST', '/api/public/almacen-don-pepe/orders', { body: { items: [{ productId, quantity: 1 }], customerName: 'Ana', phone: '+56 9 8765 4321' } });
    expect(sin.status).toBe(409);
    expect(sin.body.message).toMatch(/aviso de privacidad/);
    const ok = await call('POST', '/api/public/almacen-don-pepe/orders', { body: { items: [{ productId, quantity: 1 }], customerName: 'Ana', phone: '+56 9 8765 4321', privacyAccepted: true } });
    expect(ok.status).toBe(201);
  });

  it('el público no puede usar el motor ni ver otra tienda', async () => {
    await conTienda();
    expect((await call('POST', '/api/rpc/listTickets', { body: { args: [] } })).status).toBe(401);
    expect((await call('POST', '/api/public/otra/orders', { body: { items: [], customerName: 'x', phone: '12345678' } })).status).toBe(404);
  });

  it('valida el nombre de la tienda y que no se repita', async () => {
    await createTenant(PEPE);
    await createTenant(LUCIA);
    const set = (rut: string, slug: string) => call('PATCH', `/api/admin/tenants/${rut}`, { admin: ADMIN, body: { webStore: true, slug } });
    expect((await set('12345678-5', 'Mal Nombre!')).status).toBe(400);
    expect((await set('12345678-5', 'don-pepe')).status).toBe(200);
    expect((await set('11111111-1', 'don-pepe')).status).toBe(409);
  });

  it('la sesión informa si el negocio tiene tienda', async () => {
    const { token } = await conTienda('pepe');
    const me = await call('GET', '/api/auth/me', { token });
    expect(me.body).toMatchObject({ webStore: true, slug: 'pepe' });
  });
});

describe('aceptación de términos', () => {
  async function conServidorQueExige() {
    await stop();
    manager = new TenantManager(new FileTenantStorage(dir));
    const app = createApp({ manager, secret: SECRET, adminKey: ADMIN, gateway: new SimulatedGateway({ delayMs: 0 }), requireTerms: true });
    server = http.createServer(app).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('por defecto no se exige y el estado lo informa', async () => {
    await createTenant(PEPE);
    const token = await login(PEPE);
    const me = await call('GET', '/api/auth/me', { token });
    expect(me.body.terms).toMatchObject({ required: false, accepted: false });
    expect(me.body.terms.version).toMatch(/^\d{4}-\d{2}$/);
  });

  it('si se exige, queda pendiente hasta aceptar la versión vigente, y se guarda con fecha', async () => {
    await createTenant(PEPE);
    await conServidorQueExige();
    const token = await login(PEPE);
    const antes = (await call('GET', '/api/auth/me', { token })).body.terms;
    expect(antes).toMatchObject({ required: true, accepted: false });
    expect((await call('POST', '/api/auth/accept-terms', { token, body: { version: 'vieja' } })).status).toBe(409);
    expect((await call('POST', '/api/auth/accept-terms', { body: { version: antes.version } })).status).toBe(401);
    const ok = await call('POST', '/api/auth/accept-terms', { token, body: { version: antes.version } });
    expect(ok.body).toMatchObject({ required: true, accepted: true });
    const rec = manager.list().find((t) => t.rut === '12345678-5')!;
    expect(rec.termsAccepted?.version).toBe(antes.version);
    expect(Date.parse(rec.termsAccepted!.at)).not.toBeNaN();
    expect((await call('GET', '/api/auth/me', { token })).body.terms.accepted).toBe(true);
  });
});

describe('fotos de productos', () => {
  const jpeg = (extra = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 7)]);
  const put = (token: string | null, id: string, body: Buffer, type = 'image/jpeg') =>
    fetch(`${base}/api/products/${id}/image`, { method: 'PUT', headers: { 'Content-Type': type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: new Uint8Array(body) });

  async function conTiendaYProducto() {
    await createTenant(PEPE);
    const token = await login(PEPE);
    const r = await rpc(token, 'receiveStock', 'branch_1', { barcode: '7801', name: 'Leche 1L', category: 'Lácteos', priceClp: 1190, costClp: 700, quantity: 5 });
    await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { webStore: true } });
    return { token, id: r.body.product.id as string };
  }

  it('sube una foto, la entrega en la tienda y la quita', async () => {
    const { token, id } = await conTiendaYProducto();
    const up = await put(token, id, jpeg());
    expect(up.status).toBe(200);
    expect((await up.json() as { imageVersion: number }).imageVersion).toBe(1);

    const pub = await call('GET', '/api/public/almacen-don-pepe');
    expect(pub.body.products[0]).toMatchObject({ id, imageVersion: 1 });
    const img = await fetch(`${base}/api/public/almacen-don-pepe/img/${id}?v=1`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(img.headers.get('cache-control')).toMatch(/immutable/);
    expect(Buffer.from(await img.arrayBuffer()).length).toBe(jpeg().length);

    expect((await fetch(`${base}/api/products/${id}/image`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${base}/api/public/almacen-don-pepe/img/${id}`)).status).toBe(404);
    expect((await call('GET', '/api/public/almacen-don-pepe')).body.products[0].imageVersion).toBeUndefined();
  });

  it('exige sesión, un JPEG de verdad, un producto que exista y un tamaño razonable', async () => {
    const { token, id } = await conTiendaYProducto();
    expect((await put(null, id, jpeg())).status).toBe(401);
    expect((await put(token, id, Buffer.from('no soy una imagen'))).status).toBe(415);
    expect((await put(token, id, jpeg(), 'image/png')).status).toBeGreaterThanOrEqual(400);
    expect((await put(token, 'no_existe', jpeg())).status).toBe(404);
    expect((await put(token, id, jpeg(500_000))).status).toBe(413);
  });

  it('no entrega fotos de productos ocultos ni de tiendas cerradas', async () => {
    const { token, id } = await conTiendaYProducto();
    await put(token, id, jpeg());
    await rpc(token, 'upsertProduct', { id, name: 'Leche 1L', priceClp: 1190, published: false });
    expect((await fetch(`${base}/api/public/almacen-don-pepe/img/${id}`)).status).toBe(404);
    await rpc(token, 'upsertProduct', { id, name: 'Leche 1L', priceClp: 1190, published: true });
    expect((await fetch(`${base}/api/public/almacen-don-pepe/img/${id}`)).status).toBe(200);
    await call('PATCH', '/api/admin/tenants/12345678-5', { admin: ADMIN, body: { webStore: false } });
    expect((await fetch(`${base}/api/public/almacen-don-pepe/img/${id}`)).status).toBe(404);
  });
});

describe('perfil de cajero', () => {
  async function conCajero() {
    await createTenant(PEPE);
    const owner = await login(PEPE);
    await rpc(owner, 'upsertCashier', { name: 'Ana Rojas', pin: '4321' });
    return owner;
  }
  const cajeroLogin = (body: object) => call('POST', '/api/auth/cashier-login', { body });

  it('entra con RUT, nombre y PIN, y el servidor sabe que es cajero', async () => {
    await conCajero();
    const r = await cajeroLogin({ rut: PEPE.rut, name: 'ana rojas', pin: '4321' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: 'cashier', cashierName: 'Ana Rojas', business: { name: 'Almacén Don Pepe' } });
    const me = await call('GET', '/api/auth/me', { token: r.body.token });
    expect(me.body).toMatchObject({ role: 'cashier', cashierName: 'Ana Rojas', terms: { required: false, accepted: true } });
  });

  it('rechaza datos incorrectos con el mismo mensaje y bloquea tras varios intentos', async () => {
    await conCajero();
    for (const b of [{ rut: PEPE.rut, name: 'Ana Rojas', pin: '0000' }, { rut: PEPE.rut, name: 'Otra', pin: '4321' }, { rut: '11.111.111-1', name: 'Ana Rojas', pin: '4321' }]) {
      const r = await cajeroLogin(b);
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('RUT, nombre o PIN incorrectos');
    }
    for (let i = 0; i < 3; i++) await cajeroLogin({ rut: PEPE.rut, name: 'Ana Rojas', pin: '9999' });
    const bloqueado = await cajeroLogin({ rut: PEPE.rut, name: 'Ana Rojas', pin: '4321' });
    expect(bloqueado.status).toBe(429);
  });

  it('puede vender y ingresar mercadería, pero no tocar precios, reportes ni datos del negocio', async () => {
    const owner = await conCajero();
    const { body } = await cajeroLogin({ rut: PEPE.rut, name: 'Ana Rojas', pin: '4321' });
    const token = body.token as string;
    expect((await rpc(token, 'branches')).status).toBe(200);
    expect((await rpc(token, 'receiveStock', 'branch_1', { barcode: '7801', name: 'Leche', priceClp: 1190, costClp: 700, quantity: 3 })).status).toBe(200);
    expect((await rpc(token, 'createCart', 'branch_1', 'physical')).status).toBe(200);
    expect((await rpc(token, 'listSales', {})).status).toBe(200);
    for (const m of ['upsertProduct', 'adjustStock', 'setProductSalePrice', 'voidSale', 'registerPurchase', 'updateBusiness', 'upsertCashier', 'salesReport', 'snapshot', 'inventory']) {
      const r = await rpc(token, m);
      expect(r.status, m).toBe(403);
      expect(r.body.code).toBe('FORBIDDEN');
    }
    // el dueño sí puede
    expect((await rpc(owner, 'inventory', 'branch_1')).status).toBe(200);
  });

  it('no sube fotos ni acepta términos, y deja de valer si el dueño desactiva al cajero', async () => {
    const owner = await conCajero();
    const { body } = await cajeroLogin({ rut: PEPE.rut, name: 'Ana Rojas', pin: '4321' });
    const token = body.token as string;
    const foto = await fetch(`${base}/api/products/x/image`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` }, body: new Uint8Array([0xff, 0xd8, 0xff, 1]) });
    expect(foto.status).toBe(403);
    expect((await call('POST', '/api/auth/accept-terms', { token, body: { version: 'x' } })).status).toBe(403);

    const cajeros = (await rpc(owner, 'listCashiers')).body as { id: string; name: string }[];
    await rpc(owner, 'upsertCashier', { id: cajeros[0]!.id, name: cajeros[0]!.name, active: false });
    expect((await rpc(token, 'branches')).status).toBe(401);
    expect((await cajeroLogin({ rut: PEPE.rut, name: 'Ana Rojas', pin: '4321' })).status).toBe(401);
  });

  it('el dueño cambia el PIN de un cajero y el anterior deja de servir', async () => {
    const owner = await conCajero();
    const id = ((await rpc(owner, 'listCashiers')).body as { id: string }[])[0]!.id;
    await rpc(owner, 'upsertCashier', { id, name: 'Ana Rojas', pin: '7777' });
    expect((await cajeroLogin({ rut: PEPE.rut, name: 'Ana Rojas', pin: '4321' })).status).toBe(401);
    expect((await cajeroLogin({ rut: PEPE.rut, name: 'Ana Rojas', pin: '7777' })).status).toBe(200);
  });
});
