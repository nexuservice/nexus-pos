import type { Payment, PaymentEvent, PayMethod, PosEngine, Provider, RpcName } from '@nexus/core';

type Methods = Extract<RpcName, keyof PosEngine>;

/** Todos los métodos públicos del motor, en versión asíncrona (funcionan igual en modo demo y con servidor). */
export type Rpc = {
  [K in Methods]: PosEngine[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
};

export interface PayOptions {
  provider?: Provider;
  /** Solo efectivo: monto entregado por el cliente. */
  receivedClp?: number;
}

export interface PosApi {
  readonly mode: 'demo' | 'server';
  rpc: Rpc;
  /** Devuelve el pago pendiente; el resultado llega por watchPayment. */
  pay(cartId: string, method: PayMethod, opts?: PayOptions): Promise<Payment>;
  watchPayment(paymentId: string, onEvent: (e: PaymentEvent) => void): () => void;
  /** Respalda toda la base de datos en un archivo JSON descargable. */
  backup(): Promise<string>;
}
