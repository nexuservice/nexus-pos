import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import {
  PosError, SimulatedGateway, startPayCart, isRpcName, isReadMethod, isValidRut, normalizeRut,
  type PayMethod, type Provider, type TerminalGateway,
} from '@nexus/core';
import { LoginLimiter, safeEqual, signToken, verifyToken } from './auth';
import { TenantError, type TenantManager } from './tenants';

export interface AppOptions {
  manager: TenantManager;
  /** Secreto con el que se firman las sesiones. */
  secret: string;
  /** Clave del administrador (tú): crea y administra clientes. */
  adminKey: string;
  gateway?: TerminalGateway;
  tokenTtlMs?: number;
  /** Orígenes permitidos (CORS). Sin lista, se aceptan todos (solo para desarrollo local). */
  allowedOrigins?: string[];
  limiter?: LoginLimiter;
  /**
   * Carpeta con la app web compilada (frontend/dist). Si existe, el mismo servidor la entrega:
   * la página y la API quedan en una sola dirección, sin CORS ni segundo hosting.
   */
  staticDir?: string;
  /**
   * Cantidad de proxys de confianza delante del servidor (1 en Railway, Render, Fly…).
   * Sin esto, todos los usuarios parecerían tener la IP del proxy y el límite de intentos de login se mezclaría.
   */
  trustProxy?: number;
}

type Json = Record<string, unknown>;

export function createApp(opts: AppOptions) {
  const { manager, secret, adminKey } = opts;
  const gateway = opts.gateway ?? new SimulatedGateway({ delayMs: 1500 });
  const ttl = opts.tokenTtlMs ?? 12 * 3600_000;
  const limiter = opts.limiter ?? new LoginLimiter();

  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(cors(opts.allowedOrigins?.length ? { origin: opts.allowedOrigins } : undefined));
  app.use(express.json({ limit: '1mb' }));

  const unauthorized = (res: Response, message = 'Sesión no válida o vencida') => res.status(401).json({ code: 'UNAUTHORIZED', message });

  /** Exige sesión de un cliente activo. Deja su id en res.locals.tid. */
  const requireTenant = (allowQueryToken = false) => (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : allowQueryToken ? String(req.query.token ?? '') : '';
    const payload = token ? verifyToken(token, secret) : null;
    const tenant = payload ? manager.get(payload.tid) : undefined;
    if (!payload || !tenant || !tenant.active) return unauthorized(res);
    res.locals.tid = tenant.id;
    next();
  };

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const key = `admin|${req.ip}`;
    const wait = limiter.blockedFor(key);
    if (wait > 0) return res.status(429).json({ code: 'TOO_MANY', message: 'Demasiados intentos. Espera unos minutos.' });
    if (!safeEqual(String(req.headers['x-admin-key'] ?? ''), adminKey)) {
      limiter.fail(key);
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Clave de administrador incorrecta' });
    }
    limiter.reset(key);
    next();
  };

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  // ---------- sesión de cliente ----------
  app.post('/api/auth/login', (req, res) => {
    const { rut, password } = (req.body ?? {}) as { rut?: string; password?: string };
    const rutKey = isValidRut(String(rut ?? '')) ? normalizeRut(String(rut)) : String(rut ?? '').slice(0, 20);
    const key = `${req.ip}|${rutKey}`;
    const wait = limiter.blockedFor(key);
    if (wait > 0) {
      return res.status(429).json({ code: 'TOO_MANY', message: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(wait / 60_000)} minuto(s).` });
    }
    const tenant = manager.authenticate(String(rut ?? ''), String(password ?? ''));
    if (!tenant) {
      limiter.fail(key);
      return res.status(401).json({ code: 'BAD_CREDENTIALS', message: 'RUT o clave incorrectos' });
    }
    limiter.reset(key);
    const exp = Date.now() + ttl;
    res.json({ token: signToken({ tid: tenant.id, exp }, secret), expiresAt: exp, business: { name: tenant.name, rut: tenant.rut } });
  });

  app.get('/api/auth/me', requireTenant(), (_req, res) => {
    const t = manager.get(res.locals.tid)!;
    res.json({ name: t.name, rut: t.rut });
  });

  // ---------- datos del negocio (todo pasa por el motor del negocio de la sesión) ----------
  app.post('/api/rpc/:method', requireTenant(), (req, res, next) => {
    try {
      const name = String(req.params.method);
      if (!isRpcName(name)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Método no existe' });
      const engine = manager.engine(res.locals.tid);
      const args: unknown[] = Array.isArray(req.body?.args) ? req.body.args : [];
      const out = (engine as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
      if (!isReadMethod(name)) manager.save(res.locals.tid);
      res.json(out ?? null);
    } catch (e) {
      next(e);
    }
  });

  /** Responde 202 con el pago pendiente; el avance se sigue por SSE. */
  app.post('/api/carts/:id/pay', requireTenant(), (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { method: PayMethod; provider?: Provider; receivedClp?: number };
      const tid = res.locals.tid as string;
      const engine = manager.engine(tid);
      const payment = startPayCart(engine, gateway, { cartId: String(req.params.id), ...body });
      manager.save(tid);
      // El resultado del cobro se guarda en disco aunque nadie esté mirando el progreso (cierre de pestaña, corte de red).
      let off: () => void = () => undefined;
      let finished = false;
      off = engine.onPaymentEvent(payment.id, (e) => {
        if (e.type === 'approved' || e.type === 'rejected' || e.type === 'cancelled') {
          finished = true;
          manager.save(tid);
          off();
        }
      });
      if (finished) off();
      res.status(202).json(payment);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/payments/:id/events', requireTenant(true), (req, res) => {
    const tid = res.locals.tid as string;
    const engine = manager.engine(tid);
    const id = String(req.params.id);
    try {
      engine.getPayment(id);
    } catch {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Pago no existe' });
    }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    // Si el pago ya terminó, el motor repite sus eventos de inmediato: el cierre puede ocurrir antes de tener `off`.
    let off: () => void = () => undefined;
    let ended = false;
    off = engine.onPaymentEvent(id, (e) => {
      if (ended) return;
      res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (e.type === 'approved' || e.type === 'rejected' || e.type === 'cancelled') {
        ended = true;
        off();
        res.end();
      }
    });
    if (ended) off();
    req.on('close', () => off());
  });

  // ---------- administración (solo tú) ----------
  app.get('/api/admin/tenants', requireAdmin, (_req, res) => { res.json(manager.list()); });

  app.post('/api/admin/tenants', requireAdmin, (req, res, next) => {
    try {
      const b = (req.body ?? {}) as Json;
      res.status(201).json(manager.create({ rut: String(b.rut ?? ''), name: String(b.name ?? ''), password: String(b.password ?? '') }));
    } catch (e) {
      next(e);
    }
  });

  app.patch('/api/admin/tenants/:rut', requireAdmin, (req, res, next) => {
    try {
      const rut = String(req.params.rut);
      const b = (req.body ?? {}) as Json;
      let out = manager.list().find((t) => t.rut === (isValidRut(rut) ? normalizeRut(rut) : rut));
      if (typeof b.active === 'boolean') out = manager.setActive(rut, b.active);
      if (typeof b.password === 'string') out = manager.setPassword(rut, b.password);
      if (!out) return res.status(404).json({ code: 'NOT_FOUND', message: 'No existe un cliente con ese RUT' });
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  // ---------- app web (si está compilada) ----------
  // Una ruta /api que no existe responde JSON, nunca la página.
  app.use('/api', (_req, res) => { res.status(404).json({ code: 'NOT_FOUND', message: 'Ruta no existe' }); });
  const index = opts.staticDir ? path.join(opts.staticDir, 'index.html') : null;
  if (opts.staticDir && index && fs.existsSync(index)) {
    // Los archivos con nombre único (assets/…) se pueden guardar un año; la página principal siempre se revalida.
    app.use(express.static(opts.staticDir, {
      index: false,
      setHeaders: (res, file) => { if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); },
    }));
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(index); });
  }

  // ---------- errores ----------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof PosError) {
      return res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ code: err.code, message: err.message });
    }
    if (err instanceof TenantError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'DUPLICATE' ? 409 : 400;
      return res.status(status).json({ code: err.code, message: err.message });
    }
    console.error(err);
    res.status(500).json({ code: 'INTERNAL', message: 'Error interno' });
  });

  return app;
}
