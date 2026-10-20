import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import {
  PosEngine, PosError, SimulatedGateway, startPayCart, seedState, isRpcName, isReadMethod,
  type EngineState, type PayMethod, type Provider,
} from '@nexus/core';

const PORT = Number(process.env.PORT ?? 3001);
const DB_FILE = process.env.NEXUS_DB ?? path.join(import.meta.dirname, '..', 'data', 'nexus-db.json');
const TERMINAL_DELAY = Number(process.env.TERMINAL_DELAY_MS ?? 1500);

function load(): EngineState {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as EngineState;
  } catch {
    return seedState();
  }
}

const engine = new PosEngine(load());
const gateway = new SimulatedGateway({ delayMs: TERMINAL_DELAY });

/** Guarda el estado completo tras cada mutación (escritura atómica con archivo temporal). */
function persist(): void {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(engine.snapshot()));
  fs.renameSync(tmp, DB_FILE);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, foliosRemaining: engine.foliosRemaining() });
});

/** Invoca un método público del motor: POST /api/rpc/:método con { args: [...] }. */
app.post('/api/rpc/:method', (req, res, next) => {
  try {
    const name = String(req.params.method);
    if (!isRpcName(name)) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Método no existe' });
      return;
    }
    const args: unknown[] = Array.isArray(req.body?.args) ? req.body.args : [];
    const out = (engine as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
    if (!isReadMethod(name)) persist();
    res.json(out ?? null);
  } catch (e) {
    next(e);
  }
});

/** Responde 202 con el pago pendiente; el avance se sigue por SSE. */
app.post('/api/carts/:id/pay', (req, res, next) => {
  try {
    const body = req.body as { method: PayMethod; provider?: Provider; receivedClp?: number };
    const payment = startPayCart(engine, gateway, { cartId: String(req.params.id), ...body });
    persist();
    res.status(202).json(payment);
  } catch (e) {
    next(e);
  }
});

app.get('/api/payments/:id/events', (req, res) => {
  const id = String(req.params.id);
  try {
    engine.getPayment(id);
  } catch {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Pago no existe' });
    return;
  }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const off = engine.onPaymentEvent(id, (e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (e.type === 'approved' || e.type === 'rejected' || e.type === 'cancelled') {
      persist();
      off();
      res.end();
    }
  });
  req.on('close', off);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof PosError) {
    res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ code: err.code, message: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL', message: 'Error interno' });
});

app.listen(PORT, () => console.log(`Nexus API en http://localhost:${PORT}  (BD: ${DB_FILE})`));
