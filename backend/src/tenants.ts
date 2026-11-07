import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PosEngine, emptyState, isValidRut, normalizeRut, type EngineState } from '@nexus/core';
import { hashPassword, verifyPassword } from './auth';

export interface TenantRecord {
  id: string;
  /** RUT del negocio, sin puntos y con guion: es el usuario con el que entra. */
  rut: string;
  name: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  /** Nombre en la dirección pública de su tienda web (/t/<slug>). Solo existe si contrató el plan. */
  slug?: string;
  /** Plan «tienda web» contratado. Los clientes antiguos no lo tienen: se tratan como sin tienda. */
  webStore?: boolean;
  /** Última versión de los términos y la política de privacidad que aceptó el negocio, y cuándo. */
  termsAccepted?: { version: string; at: string };
}
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const slugify = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
export type PublicTenant = Omit<TenantRecord, 'passwordHash'>;

/** Todo lo que hay que guardar para poder reconstruir el sistema: la lista de clientes y el estado de cada negocio. */
export interface ExportData {
  index: TenantRecord[];
  states: Record<string, EngineState>;
}

export class TenantError extends Error {
  constructor(public readonly code: 'INVALID_DATA' | 'INVALID_RUT' | 'DUPLICATE' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'TenantError';
  }
}

/**
 * Dónde se guardan los datos. Hoy: archivos JSON (un índice y un archivo por negocio).
 * Más adelante se reemplaza por Postgres sin tocar el resto del servidor.
 */
export interface TenantStorage {
  loadIndex(): TenantRecord[];
  saveIndex(records: TenantRecord[]): void;
  /** Cambia cuando otro proceso (p. ej. el comando `cliente`) modifica la lista de clientes. */
  indexVersion?(): number;
  loadState(id: string): EngineState | null;
  saveState(id: string, state: EngineState): void;
  /** Fotos de productos (JPEG), una por producto y negocio. */
  saveImage?(tenantId: string, productId: string, data: Buffer): void;
  loadImage?(tenantId: string, productId: string): Buffer | null;
  deleteImage?(tenantId: string, productId: string): void;
}

function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class FileTenantStorage implements TenantStorage {
  constructor(private readonly dir: string) {}
  private index() { return path.join(this.dir, 'tenants.json'); }
  private stateFile(id: string) { return path.join(this.dir, 'tenants', `${id}.json`); }

  loadIndex(): TenantRecord[] {
    try { return JSON.parse(fs.readFileSync(this.index(), 'utf8')) as TenantRecord[]; } catch { return []; }
  }
  saveIndex(records: TenantRecord[]): void { writeAtomic(this.index(), JSON.stringify(records, null, 2)); }
  indexVersion(): number {
    try { return fs.statSync(this.index()).mtimeMs; } catch { return 0; }
  }
  loadState(id: string): EngineState | null {
    try { return JSON.parse(fs.readFileSync(this.stateFile(id), 'utf8')) as EngineState; } catch { return null; }
  }
  saveState(id: string, state: EngineState): void { writeAtomic(this.stateFile(id), JSON.stringify(state)); }

  private imageFile(tenantId: string, productId: string) { return path.join(this.dir, 'images', tenantId, `${productId}.jpg`); }
  saveImage(tenantId: string, productId: string, data: Buffer): void {
    const file = this.imageFile(tenantId, productId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }
  loadImage(tenantId: string, productId: string): Buffer | null {
    try { return fs.readFileSync(this.imageFile(tenantId, productId)); } catch { return null; }
  }
  deleteImage(tenantId: string, productId: string): void {
    try { fs.unlinkSync(this.imageFile(tenantId, productId)); } catch { /* ya no estaba */ }
  }
}

/** Un hash válido de una contraseña que nadie conoce: se verifica igual si el RUT no existe, para no delatar qué RUT están registrados. */
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));
export const MIN_PASSWORD = 8;

export class TenantManager {
  private records: TenantRecord[];
  private seen: number;
  private readonly engines = new Map<string, PosEngine>();

  constructor(private readonly storage: TenantStorage, private readonly now: () => Date = () => new Date()) {
    this.records = storage.loadIndex();
    this.seen = storage.indexVersion?.() ?? -1;
  }

  /** Recarga la lista de clientes si otro proceso la cambió (así un cliente creado con el comando entra sin reiniciar el servidor). */
  private sync(): void {
    const v = this.storage.indexVersion?.() ?? -1;
    if (v !== this.seen) {
      this.records = this.storage.loadIndex();
      this.seen = v;
    }
  }
  private persist(): void {
    this.storage.saveIndex(this.records);
    this.seen = this.storage.indexVersion?.() ?? -1;
  }

  private pub(r: TenantRecord): PublicTenant {
    const { passwordHash: _h, ...rest } = r;
    return rest;
  }
  private byRut(rut: string): TenantRecord | undefined {
    this.sync();
    if (!isValidRut(rut)) return undefined;
    const n = normalizeRut(rut);
    return this.records.find((r) => r.rut === n);
  }
  private checkPassword(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new TenantError('INVALID_DATA', `La clave debe tener al menos ${MIN_PASSWORD} caracteres`);
    if (password.length > 200) throw new TenantError('INVALID_DATA', 'La clave es demasiado larga');
  }

  list(): PublicTenant[] {
    this.sync();
    return this.records.map((r) => this.pub(r));
  }

  get(id: string): TenantRecord | undefined {
    this.sync();
    return this.records.find((r) => r.id === id);
  }

  /** Crea un cliente con su negocio vacío. El RUT es su usuario. */
  create(input: { rut: string; name: string; password: string }): PublicTenant {
    const name = input.name?.trim();
    if (!name) throw new TenantError('INVALID_DATA', 'El nombre del negocio es obligatorio');
    if (!isValidRut(input.rut ?? '')) throw new TenantError('INVALID_RUT', 'RUT inválido');
    this.checkPassword(input.password);
    this.sync();
    const rut = normalizeRut(input.rut);
    if (this.records.some((r) => r.rut === rut)) throw new TenantError('DUPLICATE', 'Ya existe un cliente con ese RUT');
    const record: TenantRecord = {
      id: `t_${randomBytes(6).toString('hex')}`, rut, name, passwordHash: hashPassword(input.password), active: true,
      createdAt: this.now().toISOString(),
    };
    this.storage.saveState(record.id, emptyState({ name, rut }));
    this.records.push(record);
    this.persist();
    return this.pub(record);
  }

  /** Verifica RUT y clave. Devuelve null si no coincide o si el cliente está desactivado. */
  authenticate(rut: string, password: string): TenantRecord | null {
    const rec = this.byRut(rut ?? '');
    const ok = verifyPassword(String(password ?? ''), rec?.passwordHash ?? DUMMY_HASH);
    return rec && ok && rec.active ? rec : null;
  }

  setPassword(rut: string, password: string): PublicTenant {
    const rec = this.byRut(rut);
    if (!rec) throw new TenantError('NOT_FOUND', 'No existe un cliente con ese RUT');
    this.checkPassword(password);
    rec.passwordHash = hashPassword(password);
    this.persist();
    return this.pub(rec);
  }

  setActive(rut: string, active: boolean): PublicTenant {
    const rec = this.byRut(rut);
    if (!rec) throw new TenantError('NOT_FOUND', 'No existe un cliente con ese RUT');
    rec.active = active;
    this.persist();
    return this.pub(rec);
  }

  saveImage(id: string, productId: string, data: Buffer): void {
    if (!this.storage.saveImage) throw new TenantError('INVALID_DATA', 'Este almacenamiento no guarda fotos');
    this.storage.saveImage(id, productId, data);
  }
  loadImage(id: string, productId: string): Buffer | null { return this.storage.loadImage?.(id, productId) ?? null; }
  deleteImage(id: string, productId: string): void { this.storage.deleteImage?.(id, productId); }

  /** Deja constancia de que el negocio aceptó la versión indicada de los términos. */
  acceptTerms(id: string, version: string): void {
    const rec = this.get(id);
    if (!rec) throw new TenantError('NOT_FOUND', 'Cliente no existe');
    rec.termsAccepted = { version, at: this.now().toISOString() };
    this.persist();
  }

  /** Negocio con tienda web activa, por el nombre de su dirección pública. Cualquier otro caso devuelve undefined (sin delatar cuál). */
  bySlug(slug: string): TenantRecord | undefined {
    this.sync();
    const wanted = String(slug ?? '').toLowerCase();
    return this.records.find((r) => r.slug === wanted && r.active && r.webStore);
  }

  /** Activa o desactiva la tienda web de un cliente. Al activar por primera vez, el nombre de la dirección sale del negocio si no se indica. */
  setWebStore(rut: string, enabled: boolean, slug?: string): PublicTenant {
    const rec = this.byRut(rut);
    if (!rec) throw new TenantError('NOT_FOUND', 'No existe un cliente con ese RUT');
    if (enabled) {
      const wanted = (slug?.trim() || rec.slug || slugify(rec.name)).toLowerCase();
      if (!SLUG_RE.test(wanted)) throw new TenantError('INVALID_DATA', 'El nombre de la tienda debe tener 3 a 40 letras minúsculas, números o guiones');
      if (this.records.some((r) => r.id !== rec.id && r.slug === wanted)) throw new TenantError('DUPLICATE', 'Ese nombre de tienda ya está en uso');
      rec.slug = wanted;
    }
    rec.webStore = enabled;
    this.persist();
    return this.pub(rec);
  }

  /** Motor del negocio, cargado una vez y mantenido en memoria. Cada negocio tiene el suyo: no comparten nada. */
  engine(id: string): PosEngine {
    let e = this.engines.get(id);
    if (!e) {
      const rec = this.get(id);
      if (!rec) throw new TenantError('NOT_FOUND', 'Cliente no existe');
      e = new PosEngine(this.storage.loadState(id) ?? emptyState({ name: rec.name, rut: rec.rut }));
      this.engines.set(id, e);
    }
    return e;
  }

  save(id: string): void {
    const e = this.engines.get(id);
    if (e) this.storage.saveState(id, e.snapshot());
  }

  /** Foto de todos los negocios, con lo que hay en memoria (lo más reciente) o, si no está cargado, lo guardado. */
  exportAll(): ExportData {
    this.sync();
    const states: Record<string, EngineState> = {};
    for (const r of this.records) {
      states[r.id] = this.engines.get(r.id)?.snapshot() ?? this.storage.loadState(r.id) ?? emptyState({ name: r.name, rut: r.rut });
    }
    return { index: structuredClone(this.records), states };
  }

  /** Reemplaza los datos de un negocio por los de un respaldo. No toca su RUT ni su clave. */
  restoreState(id: string, state: EngineState): void {
    if (!this.get(id)) throw new TenantError('NOT_FOUND', 'Cliente no existe');
    const ok = state && typeof state === 'object' && ['products', 'sales', 'shifts', 'cashiers', 'clients', 'movements'].every((k) => Array.isArray((state as unknown as Record<string, unknown>)[k]))
      && typeof state.stock === 'object' && typeof state.saleSeq === 'number';
    if (!ok) throw new TenantError('INVALID_DATA', 'El respaldo no tiene el formato esperado');
    this.engines.delete(id); // el próximo uso carga el estado restaurado
    this.storage.saveState(id, state);
  }
}
