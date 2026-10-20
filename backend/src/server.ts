import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import {
  PosEngine, PosError, SimulatedGateway, startPayCart, seedState,
  type Channel, type EngineState, type PayMethod, type Provider,
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
app.use(express.json());

const h = (fn: (req: Request, res: Response) => unknown, mutates = false) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = fn(req, res);
      if (mutates) persist();
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (e) {
      next(e);
    }
  };
const p = (req: Request, name: string): string => String(req.params[name]);

app.get('/api/health', h(() => ({ ok: true, foliosRemaining: engine.foliosRemaining() })));
app.get('/api/branches', h(() => engine.branches()));
app.get('/api/catalog', h((req) => engine.catalog(String(req.query.branchId ?? 'branch_1'), (req.query.channel as Channel) ?? 'physical')));
app.get('/api/inventory', h((req) => engine.inventory(String(req.query.branchId ?? 'branch_1'))));
app.post('/api/inventory/move', h((req) => {
  const { branchId, productId, from, to, quantity } = req.body;
  engine.moveStock(branchId, productId, from, to, Number(quantity));
  return { ok: true };
}, true));

app.post('/api/carts', h((req) => engine.createCart(req.body.branchId, req.body.channel, req.body.customer), true));
app.get('/api/carts/:id', h((req) => engine.getCart(p(req, 'id'))));
app.post('/api/carts/:id/items', h((req) => engine.cartAdd(p(req, 'id'), String(req.body.code), Number(req.body.quantity ?? 1)), true));
app.patch('/api/carts/:id/items/:index', h((req) => engine.cartSetQuantity(p(req, 'id'), Number(p(req, 'index')), Number(req.body.quantity)), true));
app.delete('/api/carts/:id/items', h((req) => engine.cartClear(p(req, 'id')), true));
app.put('/api/carts/:id/customer', h((req) => engine.setCustomer(p(req, 'id'), req.body), true));

/** Responde 202 con el pago pendiente; el avance se sigue por SSE. */
app.post('/api/carts/:id/pay', h((req, res) => {
  const body = req.body as { method: PayMethod; provider?: Provider; idempotencyKey?: string };
  const payment = startPayCart(engine, gateway, { cartId: p(req, 'id'), ...body });
  persist();
  res.status(202).json(payment);
}));
app.get('/api/payments/:id', h((req) => engine.getPayment(p(req, 'id'))));
app.post('/api/payments/:id/cancel', h((req) => engine.cancelPayment(p(req, 'id')), true));

app.get('/api/payments/:id/events', (req, res) => {
  const id = p(req, 'id');
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

app.get('/api/sales', h((req) => engine.sales(req.query.branchId ? String(req.query.branchId) : undefined)));
app.get('/api/sales/:id', h((req) => engine.getSale(p(req, 'id'))));
app.get('/api/reports/daily', h((req) =>
  engine.dailyReport(String(req.query.date), req.query.branchId ? String(req.query.branchId) : undefined)));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof PosError) {
    res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ code: err.code, message: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL', message: 'Error interno' });
});

app.listen(PORT, () => console.log(`Nexus API en http://localhost:${PORT}  (BD: ${DB_FILE})`));
