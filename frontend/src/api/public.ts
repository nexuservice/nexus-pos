import { API_URL, ApiError } from './http';

export interface PublicBusiness { name: string; direccion?: string; comuna?: string; phone?: string }
export interface PublicProduct { id: string; name: string; category: string; priceClp: number; available: number }
export interface PublicStore { business: PublicBusiness; products: PublicProduct[] }
export interface PublicOrderInput {
  items: { productId: string; quantity: number }[];
  customerName: string;
  phone: string;
  email?: string;
  note?: string;
  /** El cliente marcó que leyó el aviso de privacidad de la tienda. */
  privacyAccepted: boolean;
}
export interface PublicOrderResult { number: number; totalClp: number; lines: { name: string; quantity: number; unitPriceClp: number }[] }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL.replace(/\/$/, '') + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.code ?? 'HTTP', data.message ?? `Error ${res.status}`, res.status);
  return data as T;
}

/** Tienda web pública de un negocio: no usa sesión ni token. */
export const publicStore = {
  get: (slug: string) => call<PublicStore>('GET', `/api/public/${encodeURIComponent(slug)}`),
  order: (slug: string, input: PublicOrderInput) => call<PublicOrderResult>('POST', `/api/public/${encodeURIComponent(slug)}/orders`, input),
};
