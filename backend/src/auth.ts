import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

/** Hash de contraseña con scrypt y sal aleatoria. Formato: `scrypt$<sal hex>$<hash hex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Comparación en tiempo constante de dos textos (claves de administrador, firmas). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export interface TokenPayload {
  /** Id del negocio (tenant). */
  tid: string;
  /** Vencimiento, en ms desde epoch. */
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');

/** Sesión firmada con HMAC-SHA256: `<payload>.<firma>`. No se guarda nada en el servidor. */
export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): TokenPayload | null {
  const [body, sig] = (token ?? '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (typeof p.tid !== 'string' || typeof p.exp !== 'number' || p.exp <= now) return null;
    return p;
  } catch {
    return null;
  }
}

/** Limita los intentos fallidos de inicio de sesión por clave (p. ej. IP + RUT). */
export class LoginLimiter {
  private readonly fails = new Map<string, number[]>();
  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const t = this.now();
    const list = (this.fails.get(key) ?? []).filter((x) => t - x < this.windowMs);
    this.fails.set(key, list);
    return list;
  }

  /** Milisegundos que faltan para poder reintentar (0 = permitido). */
  blockedFor(key: string): number {
    const list = this.recent(key);
    return list.length >= this.max ? this.windowMs - (this.now() - list[0]!) : 0;
  }

  fail(key: string): void {
    this.recent(key).push(this.now());
  }

  reset(key: string): void {
    this.fails.delete(key);
  }
}
