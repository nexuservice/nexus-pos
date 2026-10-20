import { RPC_METHODS, type PaymentEvent } from '@nexus/core';
import type { PosApi, Rpc } from './types';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function createHttpApi(base: string): PosApi {
  const url = (p: string) => base.replace(/\/$/, '') + p;
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.code ?? 'HTTP', data.message ?? `Error ${res.status}`);
    return data as T;
  }

  const rpc = {} as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const name of RPC_METHODS) rpc[name] = (...args: unknown[]) => post(`/api/rpc/${name}`, { args });
  const call = rpc as unknown as Rpc;

  return {
    mode: 'server',
    rpc: call,
    pay: (cartId, method, opts = {}) => post(`/api/carts/${cartId}/pay`, { method, ...opts }),
    watchPayment(paymentId, onEvent) {
      const es = new EventSource(url(`/api/payments/${paymentId}/events`));
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as PaymentEvent;
        onEvent(e);
        if (e.type === 'approved' || e.type === 'rejected' || e.type === 'cancelled') es.close();
      };
      es.onerror = () => es.close();
      return () => es.close();
    },
    backup: async () => JSON.stringify(await call.snapshot(), null, 2),
  };
}
