import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedGateway } from '@nexus/core';
import { createApp } from '../src/app';
import { BackupService, isBackupId, runBackupCycle } from '../src/backup';
import { FileTenantStorage, TenantManager } from '../src/tenants';

const PEPE = { rut: '12.345.678-5', name: 'Almacén Don Pepe', password: 'clave-pepe-123' };
const LUCIA = { rut: '11.111.111-1', name: 'Minimarket Lucía', password: 'clave-lucia-456' };

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-bk-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe('servicio de respaldos', () => {
  const fixture = () => {
    const manager = new TenantManager(new FileTenantStorage(path.join(dir, 'data')));
    manager.create(PEPE);
    return manager;
  };

  it('crea una copia con el índice y el estado de cada negocio, y se puede leer de vuelta', () => {
    const manager = fixture();
    const svc = new BackupService(path.join(dir, 'bk'));
    const meta = svc.create(manager.exportAll(), { reason: 'prueba' })!;
    expect(meta).toMatchObject({ tenants: 1, reason: 'prueba' });
    expect(isBackupId(meta.id)).toBe(true);
    expect(svc.list().map((b) => b.id)).toEqual([meta.id]);
    const data = svc.load(meta.id);
    expect(data.index[0]!.rut).toBe('12345678-5');
    expect(Object.values(data.states)[0]!.business?.name).toBe('Almacén Don Pepe');
  });

  it('no duplica: sin cambios no crea otra, con cambios sí', () => {
    const manager = fixture();
    const svc = new BackupService(path.join(dir, 'bk'));
    expect(runBackupCycle(manager, svc)).not.toBeNull();
    expect(runBackupCycle(manager, svc)).toBeNull();
    manager.engine(manager.list()[0]!.id).upsertCashier({ name: 'Pepe', pin: '1234' });
    expect(runBackupCycle(manager, svc)).not.toBeNull();
    expect(svc.list()).toHaveLength(2);
    expect(svc.create(manager.exportAll(), { force: true })).not.toBeNull(); // forzado: crea igual
  });

  it('dos copias en el mismo segundo no se pisan', () => {
    const manager = fixture();
    const svc = new BackupService(path.join(dir, 'bk'), () => new Date('2026-10-25T12:00:00Z'));
    const a = svc.create(manager.exportAll(), { force: true })!;
    const b = svc.create(manager.exportAll(), { force: true })!;
    expect(a.id).not.toBe(b.id);
    expect(svc.list()).toHaveLength(2);
  });

  it('guarda lo más reciente de memoria, aunque aún no se haya escrito a disco', () => {
    const manager = fixture();
    const tid = manager.list()[0]!.id;
    manager.engine(tid).upsertCashier({ name: 'Solo en memoria', pin: '5555' }); // sin llamar a save()
    const svc = new BackupService(path.join(dir, 'bk'));
    const meta = svc.create(manager.exportAll())!;
    expect(svc.load(meta.id).states[tid]!.cashiers.map((c) => c.name)).toEqual(['Solo en memoria']);
  });

  it('retención: todo lo de 48 h, una por día hasta 30 días, y borra lo más viejo', () => {
    const manager = fixture();
    let now = new Date('2026-09-01T10:00:00Z');
    const svc = new BackupService(path.join(dir, 'bk'), () => now, 30);
    const mk = (iso: string) => { now = new Date(iso); return svc.create(manager.exportAll(), { force: true })!.id; };
    const old = mk('2026-09-01T10:00:00Z');           // 54 días antes: se borra
    const d10a = mk('2026-10-05T08:00:00Z');          // 20 días antes, mismo día: se queda solo la última
    const d10b = mk('2026-10-05T20:00:00Z');
    const d22 = mk('2026-10-22T09:00:00Z');           // 3 días antes: una por día
    const recent1 = mk('2026-10-24T08:00:00Z');       // dentro de 48 h: se quedan todas
    const recent2 = mk('2026-10-24T20:00:00Z');
    const recent3 = mk('2026-10-25T02:00:00Z');
    now = new Date('2026-10-25T12:00:00Z');
    const deleted = svc.prune();
    const left = svc.list().map((b) => b.id);
    expect(deleted).toEqual(expect.arrayContaining([old, d10a]));
    expect(left).toEqual(expect.arrayContaining([d10b, d22, recent1, recent2, recent3]));
    expect(left).not.toContain(old);
    expect(left).not.toContain(d10a);
  });

  it('rechaza identificadores que intenten salirse de la carpeta', () => {
    const svc = new BackupService(path.join(dir, 'bk'));
    expect(() => svc.load('../data')).toThrow(/inválido/);
    expect(() => svc.load('20260101-000000')).toThrow(/no existe/);
    expect(isBackupId('..\\x')).toBe(false);
    expect(isBackupId('20261025-030000-2')).toBe(true);
  });

  it('ignora copias incompletas', () => {
    const svc = new BackupService(path.join(dir, 'bk'));
    fs.mkdirSync(path.join(dir, 'bk', '20261025-030000'), { recursive: true }); // sin meta.json
    fs.mkdirSync(path.join(dir, 'bk', '.tmp-20261025-040000'), { recursive: true });
    expect(svc.list()).toEqual([]);
  });
});

describe('respaldos y restauración por la API', () => {
  let server: http.Server;
  let base: string;
  let manager: TenantManager;
  let svc: BackupService;
  const ADMIN = 'clave-admin-de-prueba';

  beforeEach(() => {
    manager = new TenantManager(new FileTenantStorage(path.join(dir, 'data')));
    svc = new BackupService(path.join(dir, 'bk'));
    const app = createApp({ manager, secret: 's', adminKey: ADMIN, gateway: new SimulatedGateway({ delayMs: 0 }), backups: svc });
    server = http.createServer(app).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }); });

  const call = async (method: string, url: string, o: { body?: unknown; token?: string; admin?: string } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...(o.admin ? { 'x-admin-key': o.admin } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const rpc = (token: string, name: string, ...args: unknown[]) => call('POST', `/api/rpc/${name}`, { token, body: { args } });
  const login = async (t: typeof PEPE) => (await call('POST', '/api/auth/login', { body: { rut: t.rut, password: t.password } })).body.token as string;

  it('solo el administrador puede ver, crear, descargar y restaurar respaldos', async () => {
    manager.create(PEPE);
    expect((await call('GET', '/api/admin/backups')).status).toBe(401);
    expect((await call('POST', '/api/admin/backups')).status).toBe(401);
    expect((await call('GET', '/api/admin/backups/20261025-030000')).status).toBe(401);
    expect((await call('POST', '/api/admin/tenants/12345678-5/restore', { body: { backupId: '20261025-030000' } })).status).toBe(401);
    const created = await call('POST', '/api/admin/backups', { admin: ADMIN });
    expect(created.status).toBe(201);
    expect((await call('GET', '/api/admin/backups', { admin: ADMIN })).body).toHaveLength(1);
  });

  it('descarga el respaldo completo o solo el de un cliente (sin claves)', async () => {
    manager.create(PEPE);
    manager.create(LUCIA);
    const id = (await call('POST', '/api/admin/backups', { admin: ADMIN })).body.id as string;
    const all = await call('GET', `/api/admin/backups/${id}`, { admin: ADMIN });
    expect(all.body.index).toHaveLength(2);
    const one = await call('GET', `/api/admin/backups/${id}?rut=12.345.678-5`, { admin: ADMIN });
    expect(one.body.business).toEqual({ rut: '12345678-5', name: 'Almacén Don Pepe' });
    expect(JSON.stringify(one.body)).not.toContain('scrypt');
    expect(JSON.stringify(one.body)).not.toContain('Minimarket Lucía');
    expect((await call('GET', `/api/admin/backups/${id}?rut=99.999.999-9`, { admin: ADMIN })).status).toBe(404);
    expect((await call('GET', '/api/admin/backups/no-valido', { admin: ADMIN })).status).toBe(400);
    expect((await call('GET', '/api/admin/backups/20200101-000000', { admin: ADMIN })).status).toBe(404);
  });

  it('restaura el negocio de un cliente a como estaba, con copia de seguridad previa, sin tocar a otros', async () => {
    manager.create(PEPE);
    manager.create(LUCIA);
    const pepe = await login(PEPE);
    const lucia = await login(LUCIA);
    await rpc(pepe, 'receiveStock', 'branch_1', { barcode: '7801', name: 'Leche', costClp: 700, priceNetClp: 1000, quantity: 10 });
    await rpc(lucia, 'receiveStock', 'branch_1', { barcode: '9001', name: 'Pan', costClp: 300, priceNetClp: 500, quantity: 5 });
    const id = (await call('POST', '/api/admin/backups', { admin: ADMIN })).body.id as string;

    // después del respaldo: Pepe "pierde" su inventario y Lucía sigue trabajando
    await rpc(pepe, 'adjustStock', 'branch_1', (await rpc(pepe, 'findProduct', '7801')).body.id, 'physical', -10);
    await rpc(lucia, 'receiveStock', 'branch_1', { barcode: '9001', quantity: 3 });
    expect((await rpc(pepe, 'inventory', 'branch_1')).body[0].physical.qty).toBe(0);

    const r = await call('POST', '/api/admin/tenants/12345678-5/restore', { admin: ADMIN, body: { backupId: id } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ restored: '12345678-5', from: id });
    expect(r.body.safetyBackup).toBeTruthy();
    expect((await rpc(pepe, 'inventory', 'branch_1')).body[0].physical.qty).toBe(10); // Pepe volvió al respaldo
    expect((await rpc(lucia, 'inventory', 'branch_1')).body[0].physical.qty).toBe(8);  // Lucía no se tocó
    expect(svc.list().some((b) => b.reason.startsWith('antes de restaurar'))).toBe(true);
    // lo restaurado también quedó en disco
    const reloaded = new TenantManager(new FileTenantStorage(path.join(dir, 'data')));
    expect(reloaded.engine(reloaded.list().find((t) => t.rut === '12345678-5')!.id).inventory('branch_1')[0]!.physical.qty).toBe(10);
  });

  it('valida los datos de la restauración', async () => {
    manager.create(PEPE);
    const id = (await call('POST', '/api/admin/backups', { admin: ADMIN })).body.id as string;
    const post = (rut: string, body: unknown) => call('POST', `/api/admin/tenants/${rut}/restore`, { admin: ADMIN, body });
    expect((await post('12345678-5', {})).status).toBe(400);
    expect((await post('12345678-5', { backupId: '../x' })).status).toBe(400);
    expect((await post('12345678-5', { backupId: '20200101-000000' })).status).toBe(404);
    expect((await post('99999999-9', { backupId: id })).status).toBe(404);
    manager.create(LUCIA); // Lucía no existía cuando se hizo el respaldo
    expect((await post('11111111-1', { backupId: id })).status).toBe(404);
  });
});
