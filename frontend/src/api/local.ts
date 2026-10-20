import { PosEngine, RPC_METHODS, SimulatedGateway, isReadMethod, seedState, startPayCart, type EngineState } from '@nexus/core';
import type { PosApi, Rpc } from './types';

const KEY = 'nexus-demo-v2';

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

  const rpc = {} as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const name of RPC_METHODS) {
    rpc[name] = async (...args: unknown[]) => {
      const out = (engine as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
      if (!isReadMethod(name)) save();
      return out;
    };
  }

  return {
    mode: 'demo',
    rpc: rpc as unknown as Rpc,
    pay: async (cartId, method, opts = {}) => {
      const p = startPayCart(engine, gateway, { cartId, method, ...opts });
      save();
      return p;
    },
    watchPayment: (id, onEvent) =>
      engine.onPaymentEvent(id, (e) => {
        onEvent(e);
        if (e.type === 'approved' || e.type === 'rejected' || e.type === 'cancelled') save();
      }),
    backup: async () => JSON.stringify(engine.snapshot(), null, 2),
  };
}

export function resetLocalDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}
