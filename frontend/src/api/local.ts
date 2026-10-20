import { PosEngine, SimulatedGateway, seedState, startPayCart, type EngineState } from '@nexus/core';
import type { PosApi } from './types';

const KEY = 'nexus-demo-v1';

function load(): EngineState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as EngineState;
  } catch {
    /* almacenamiento no disponible: arranca con datos de ejemplo */
  }
  return seedState();
}

/**
 * Modo demo: el mismo motor del backend corre en el navegador y guarda el estado en localStorage.
 * Así la app funciona en Netlify sin servidor.
 */
export function createLocalApi(): PosApi {
  const engine = new PosEngine(load());
  const gateway = new SimulatedGateway({ delayMs: 1500 });
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(engine.snapshot()));
    } catch {
      /* sin persistencia */
    }
  };
  const run = async <T,>(fn: () => T, mutates = true): Promise<T> => {
    const out = fn();
    if (mutates) save();
    return out;
  };

  return {
    mode: 'demo',
    branches: () => run(() => engine.branches(), false),
    catalog: (b, c) => run(() => engine.catalog(b, c), false),
    inventory: (b) => run(() => engine.inventory(b), false),
    moveStock: (b, p, f, t, q) => run(() => engine.moveStock(b, p, f, t, q)),
    createCart: (b, c, cu) => run(() => engine.createCart(b, c, cu)),
    addItem: (id, code, q = 1) => run(() => engine.cartAdd(id, code, q)),
    setQuantity: (id, i, q) => run(() => engine.cartSetQuantity(id, i, q)),
    clearCart: (id) => run(() => engine.cartClear(id)),
    setCustomer: (id, cu) => run(() => engine.setCustomer(id, cu)),
    pay: (id, method, provider) => run(() => startPayCart(engine, gateway, { cartId: id, method, provider })),
    watchPayment: (id, onEvent) =>
      engine.onPaymentEvent(id, (e) => {
        onEvent(e);
        if (e.type === 'approved' || e.type === 'rejected' || e.type === 'cancelled') save();
      }),
    cancelPayment: (id) => run(() => engine.cancelPayment(id)),
    sale: (id) => run(() => engine.getSale(id), false),
    report: (date, b) => run(() => engine.dailyReport(date, b), false),
  };
}

export function resetLocalDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}
