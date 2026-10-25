import { RPC_METHODS, type PaymentEvent } from '@nexus/core';
import type { PosApi, Rpc } from './types';
import type { Session } from './session';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
}

/**
 * Dirección del servidor. Vacía = la misma dirección desde la que se abrió la página (lo normal en producción,
 * donde el servidor entrega también la app). En desarrollo apunta al servidor local; si el frontend se publica
 * aparte, se fija al compilar con VITE_API_URL.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

const join = (base: string, p: string) => base.replace(/\/$/, '') + p;

async function request<T>(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(join(base, path), {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', 'No se pudo conectar con el servidor. Revisa tu conexión.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.code ?? 'HTTP', data.message ?? `Error ${res.status}`, res.status);
  return data as T;
}

export async function login(base: string, rut: string, password: string): Promise<Session> {
  return request<Session>(base, 'POST', '/api/auth/login', { rut, password });
}

/** Cliente de la API del negocio con sesión. Si el servidor responde 401, avisa para volver al login. */
export function createHttpApi(base: string, getToken: () => string, onUnauthorized: () => void): PosApi {
  async function post<T>(path: string, body: unknown): Promise<T> {
    try {
      return await request<T>(base, 'POST', path, body, { Authorization: `Bearer ${getToken()}` });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      throw e;
    }
  }

  const rpc = {} as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const name of RPC_METHODS) rpc[name] = (...args: unknown[]) => post(`/api/rpc/${name}`, { args });
  const call = rpc as unknown as Rpc;

  return {
    rpc: call,
    pay: (cartId, method, opts = {}) => post(`/api/carts/${cartId}/pay`, { method, ...opts }),
    watchPayment(paymentId, onEvent) {
      // Canal principal: eventos en vivo (SSE). Respaldo: consultar el estado del pago cada 1,5 s, por si algún
      // proxy, túnel o red móvil bloquea o corta SSE; así el cobro nunca queda "cobrando" para siempre.
      let finished = false;
      const terminal = (t: PaymentEvent['type']) => t === 'approved' || t === 'rejected' || t === 'cancelled';
      const finish = () => { finished = true; es.close(); clearInterval(poll); clearTimeout(start); };
      const deliver = (e: PaymentEvent) => {
        if (finished) return;
        if (terminal(e.type)) finish();
        onEvent(e);
      };

      const es = new EventSource(join(base, `/api/payments/${paymentId}/events?token=${encodeURIComponent(getToken())}`));
      es.onmessage = (m) => deliver(JSON.parse(m.data) as PaymentEvent);
      es.onerror = () => es.close();

      let poll: ReturnType<typeof setInterval>;
      const start = setTimeout(() => {
        poll = setInterval(async () => {
          try {
            const p = await call.getPayment(paymentId);
            if (p.status === 'approved') deliver({ paymentId, type: 'approved', saleId: p.saleId, at: new Date().toISOString() });
            else if (p.status === 'rejected') deliver({ paymentId, type: 'rejected', message: p.message, at: new Date().toISOString() });
            else if (p.status === 'cancelled') deliver({ paymentId, type: 'cancelled', message: p.message, at: new Date().toISOString() });
          } catch {
            /* sin red por un momento: se reintenta en el siguiente ciclo */
          }
        }, 1500);
      }, 2500);

      return finish;
    },
    backup: async () => JSON.stringify(await call.snapshot(), null, 2),
  };
}

export interface TenantInfo {
  id: string;
  rut: string;
  name: string;
  active: boolean;
  createdAt: string;
}

/** Administración de clientes (solo con la clave de administrador). */
export function createAdminClient(base: string, adminKey: string) {
  const h = { 'x-admin-key': adminKey };
  return {
    list: () => request<TenantInfo[]>(base, 'GET', '/api/admin/tenants', undefined, h),
    create: (rut: string, name: string, password: string) => request<TenantInfo>(base, 'POST', '/api/admin/tenants', { rut, name, password }, h),
    setActive: (rut: string, active: boolean) => request<TenantInfo>(base, 'PATCH', `/api/admin/tenants/${encodeURIComponent(rut)}`, { active }, h),
    setPassword: (rut: string, password: string) => request<TenantInfo>(base, 'PATCH', `/api/admin/tenants/${encodeURIComponent(rut)}`, { password }, h),
  };
}
