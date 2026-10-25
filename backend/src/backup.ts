import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ExportData, TenantManager } from './tenants';

export interface BackupMeta {
  /** AAAAMMDD-HHMMSS (UTC), con sufijo -N si hay dos en el mismo segundo. */
  id: string;
  createdAt: string;
  tenants: number;
  bytes: number;
  hash: string;
  /** "automático", "manual", "antes de restaurar"… */
  reason: string;
}

const ID = /^\d{8}-\d{6}(-\d+)?$/;
/** Respaldos más recientes que esto se guardan todos; los más viejos, uno por día. */
const KEEP_ALL_MS = 48 * 3600_000;

export const isBackupId = (s: string): boolean => ID.test(s);

/**
 * Respaldos en carpetas, una por copia: el índice de clientes y el estado de cada negocio.
 * - No duplica: si nada cambió desde la última copia, no crea otra.
 * - Retención: todas las de las últimas 48 h, luego una por día hasta `keepDays` días; lo más viejo se borra.
 * - Escritura atómica: la copia se arma en una carpeta temporal y se renombra al terminar.
 * Ojo: una copia en el mismo disco no protege de perder el disco. Hay que bajarla a otro lado (panel de administración).
 */
export class BackupService {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
    private readonly keepDays = 30,
  ) {}

  private idOf(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  }

  private hashOf(data: ExportData): string {
    const h = createHash('sha256').update(JSON.stringify(data.index));
    for (const id of Object.keys(data.states).sort()) h.update(id).update(JSON.stringify(data.states[id]));
    return h.digest('hex');
  }

  /** Crea una copia. Devuelve null si no hay cambios desde la última (salvo `force`). */
  create(data: ExportData, opts: { force?: boolean; reason?: string } = {}): BackupMeta | null {
    const hash = this.hashOf(data);
    if (!opts.force && this.list()[0]?.hash === hash) return null;

    const at = this.now();
    let id = this.idOf(at);
    for (let n = 2; fs.existsSync(path.join(this.dir, id)); n++) id = `${this.idOf(at)}-${n}`;

    const tmp = path.join(this.dir, `.tmp-${id}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    let bytes = 0;
    const put = (name: string, content: string) => { fs.writeFileSync(path.join(tmp, name), content); bytes += Buffer.byteLength(content); };
    put('index.json', JSON.stringify(data.index));
    for (const [tid, state] of Object.entries(data.states)) put(`${tid}.json`, JSON.stringify(state));
    const meta: BackupMeta = {
      id, createdAt: at.toISOString(), tenants: data.index.length, bytes, hash, reason: opts.reason ?? 'automático',
    };
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(meta));
    fs.renameSync(tmp, path.join(this.dir, id));
    return meta;
  }

  /** Copias existentes, de la más nueva a la más antigua. */
  list(): BackupMeta[] {
    let names: string[];
    try { names = fs.readdirSync(this.dir); } catch { return []; }
    const out: BackupMeta[] = [];
    for (const n of names) {
      if (!ID.test(n)) continue;
      try { out.push(JSON.parse(fs.readFileSync(path.join(this.dir, n, 'meta.json'), 'utf8')) as BackupMeta); } catch { /* copia incompleta: se ignora */ }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id.localeCompare(a.id)));
  }

  load(id: string): ExportData {
    if (!ID.test(id)) throw new Error('Identificador de respaldo inválido');
    const dir = path.join(this.dir, id);
    if (!fs.existsSync(dir)) throw new Error('El respaldo no existe');
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as ExportData['index'];
    const states: ExportData['states'] = {};
    for (const t of index) {
      try { states[t.id] = JSON.parse(fs.readFileSync(path.join(dir, `${t.id}.json`), 'utf8')); } catch { /* ese negocio no tenía datos en la copia */ }
    }
    return { index, states };
  }

  /** Borra lo que ya no corresponde según la retención. Devuelve los ids borrados. */
  prune(): string[] {
    const now = this.now().getTime();
    const deleted: string[] = [];
    const seenDay = new Set<string>();
    for (const b of this.list()) {
      const age = now - new Date(b.createdAt).getTime();
      let drop = false;
      if (age > this.keepDays * 86_400_000) drop = true;
      else if (age > KEEP_ALL_MS) {
        const day = b.createdAt.slice(0, 10);
        if (seenDay.has(day)) drop = true;
        else seenDay.add(day);
      }
      if (drop) {
        fs.rmSync(path.join(this.dir, b.id), { recursive: true, force: true });
        deleted.push(b.id);
      }
    }
    return deleted;
  }
}

/** Una vuelta: copia si hubo cambios y poda lo viejo. */
export function runBackupCycle(manager: TenantManager, service: BackupService, reason = 'automático'): BackupMeta | null {
  const meta = service.create(manager.exportAll(), { reason });
  service.prune();
  return meta;
}

/** Copia al arrancar (si la última es vieja) y luego cada `intervalMs`. Devuelve la función para detenerlo. */
export function startBackupScheduler(
  manager: TenantManager, service: BackupService, intervalMs: number, log: (m: string) => void = console.log,
): () => void {
  if (intervalMs <= 0) { log('Respaldos automáticos desactivados (BACKUP_INTERVAL_HOURS=0)'); return () => undefined; }
  const run = () => {
    try {
      const m = runBackupCycle(manager, service);
      if (m) log(`Respaldo ${m.id}: ${m.tenants} cliente(s), ${(m.bytes / 1024).toFixed(0)} KB`);
    } catch (e) {
      console.error('Falló el respaldo automático:', e);
    }
  };
  const latest = service.list()[0];
  const first = setTimeout(run, !latest || Date.now() - new Date(latest.createdAt).getTime() >= intervalMs ? 5_000 : intervalMs);
  const timer = setInterval(run, intervalMs);
  return () => { clearTimeout(first); clearInterval(timer); };
}
