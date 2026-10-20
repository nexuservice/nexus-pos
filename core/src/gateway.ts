import type { Payment, PayMethod, Provider } from './types';
import type { PosEngine } from './engine';

export interface ChargeRequest {
  amountClp: number;
  method: PayMethod;
  provider: Provider;
  reference: string;
}
export interface ChargeResult {
  approved: boolean;
  authCode?: string;
  message?: string;
}

/**
 * Puente hacia el terminal o la pasarela. La implementación real hablaría con el SDK/POS de
 * Transbank, Getnet o Mercado Pago; aquí solo existe el simulador.
 */
export interface TerminalGateway {
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

export interface SimulatedGatewayOptions {
  delayMs?: number;
  /** Devuelve true para rechazar el cobro (p. ej. tarjeta sin fondos). */
  rejectWhen?: (req: ChargeRequest) => boolean;
}

export class SimulatedGateway implements TerminalGateway {
  private n = 0;
  constructor(private readonly opts: SimulatedGatewayOptions = {}) {}

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const delay = req.provider === 'cash' ? 0 : (this.opts.delayMs ?? 1500);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (this.opts.rejectWhen?.(req)) return { approved: false, message: 'Tarjeta rechazada por el emisor' };
    const code = `${req.provider.slice(0, 2).toUpperCase()}${String(++this.n).padStart(6, '0')}`;
    return { approved: true, authCode: code };
  }
}

/** Inicia el cobro y lo resuelve contra el terminal. No inicia dos cobros con la misma clave. */
export async function payCart(
  engine: PosEngine,
  gateway: TerminalGateway,
  req: { cartId: string; method: PayMethod; provider?: Provider; idempotencyKey?: string },
): Promise<Payment> {
  const { payment, created } = engine.beginPayment(req.cartId, req.method, req.provider, req.idempotencyKey);
  if (!created) return payment;
  return runCharge(engine, gateway, payment);
}

/** Variante que devuelve el pago pendiente de inmediato y completa el cobro en segundo plano. */
export function startPayCart(
  engine: PosEngine,
  gateway: TerminalGateway,
  req: { cartId: string; method: PayMethod; provider?: Provider; idempotencyKey?: string },
): Payment {
  const { payment, created } = engine.beginPayment(req.cartId, req.method, req.provider, req.idempotencyKey);
  if (created) void runCharge(engine, gateway, payment);
  return payment;
}

async function runCharge(engine: PosEngine, gateway: TerminalGateway, payment: Payment): Promise<Payment> {
  engine.emit(payment.id, 'terminal_waiting', 'Esperando al terminal');
  const outcome = await gateway.charge({
    amountClp: payment.amountClp, method: payment.method, provider: payment.provider, reference: payment.id,
  });
  return engine.resolvePayment(payment.id, outcome);
}
