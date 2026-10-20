import type { PaymentEvent } from '@nexus/core';
import type { PosApi } from './types';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function createHttpApi(base: string): PosApi {
  const url = (p: string) => base.replace(/\/$/, '') + p;
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(url(path), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.code ?? 'HTTP', data.message ?? `Error ${res.status}`);
    return data as T;
  }
  const q = (o: Record<string, string>) => '?' + new URLSearchParams(o).toString();

  return {
    mode: 'server',
    branches: () => call('GET', '/api/branches'),
    catalog: (branchId, channel) => call('GET', '/api/catalog' + q({ branchId, channel })),
    inventory: (branchId) => call('GET', '/api/inventory' + q({ branchId })),
    moveStock: (branchId, productId, from, to, quantity) =>
      call('POST', '/api/inventory/move', { branchId, productId, from, to, quantity }),
    createCart: (branchId, channel, customer) => call('POST', '/api/carts', { branchId, channel, customer }),
    addItem: (id, code, quantity = 1) => call('POST', `/api/carts/${id}/items`, { code, quantity }),
    setQuantity: (id, index, quantity) => call('PATCH', `/api/carts/${id}/items/${index}`, { quantity }),
    clearCart: (id) => call('DELETE', `/api/carts/${id}/items`),
    setCustomer: (id, customer) => call('PUT', `/api/carts/${id}/customer`, customer),
    pay: (id, method, provider) => call('POST', `/api/carts/${id}/pay`, { method, provider }),
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
    cancelPayment: (id) => call('POST', `/api/payments/${id}/cancel`),
    sale: (id) => call('GET', `/api/sales/${id}`),
    report: (date, branchId) => call('GET', '/api/reports/daily' + q({ date, branchId })),
  };
}
