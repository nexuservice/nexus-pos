import { describe, expect, it } from 'vitest';
import { LoginLimiter, hashPassword, safeEqual, signToken, verifyPassword, verifyToken } from '../src/auth';

describe('contraseñas', () => {
  it('guarda un hash con sal y lo verifica', () => {
    const h = hashPassword('clave-segura-1');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('clave-segura-1');
    expect(verifyPassword('clave-segura-1', h)).toBe(true);
    expect(verifyPassword('clave-segura-2', h)).toBe(false);
    expect(verifyPassword('', h)).toBe(false);
  });
  it('la misma clave da hashes distintos (sal aleatoria)', () => {
    expect(hashPassword('abc12345')).not.toBe(hashPassword('abc12345'));
  });
  it('rechaza formatos de hash inválidos', () => {
    expect(verifyPassword('x', 'texto-plano')).toBe(false);
    expect(verifyPassword('x', 'md5$aa$bb')).toBe(false);
  });
  it('safeEqual compara en tiempo constante textos de distinto largo', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('sesiones firmadas', () => {
  const secret = 'secreto-de-prueba';
  const now = 1_000_000;

  it('firma y verifica', () => {
    const t = signToken({ tid: 't_1', exp: now + 1000 }, secret);
    expect(verifyToken(t, secret, now)).toEqual({ tid: 't_1', exp: now + 1000 });
  });
  it('rechaza un token vencido', () => {
    expect(verifyToken(signToken({ tid: 't_1', exp: now - 1 }, secret), secret, now)).toBeNull();
  });
  it('rechaza un token con otro secreto o alterado', () => {
    const t = signToken({ tid: 't_1', exp: now + 1000 }, secret);
    expect(verifyToken(t, 'otro-secreto', now)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ tid: 't_2', exp: now + 1000 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(verifyToken(`${body}.`, secret, now)).toBeNull();
    expect(verifyToken('', secret, now)).toBeNull();
    expect(verifyToken('basura', secret, now)).toBeNull();
  });
});

describe('límite de intentos', () => {
  it('bloquea tras 5 fallos y libera pasada la ventana', () => {
    let t = 0;
    const l = new LoginLimiter(5, 60_000, () => t);
    for (let i = 0; i < 4; i++) l.fail('k');
    expect(l.blockedFor('k')).toBe(0);
    l.fail('k');
    expect(l.blockedFor('k')).toBeGreaterThan(0);
    t = 61_000;
    expect(l.blockedFor('k')).toBe(0);
  });
  it('un acierto reinicia el contador y cada clave es independiente', () => {
    const l = new LoginLimiter(2, 60_000, () => 0);
    l.fail('a'); l.fail('a');
    expect(l.blockedFor('a')).toBeGreaterThan(0);
    expect(l.blockedFor('b')).toBe(0);
    l.reset('a');
    expect(l.blockedFor('a')).toBe(0);
  });
});
