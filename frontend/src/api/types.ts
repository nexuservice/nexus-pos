import type { Payment, PaymentEvent, PayMethod, PosEngine, Provider, RpcName } from '@nexus/core';

type Methods = Extract<RpcName, keyof PosEngine>;

/** Todos los métodos públicos del motor, en versión asíncrona: cada llamada va al servidor, al negocio de la sesión. */
export type Rpc = {
  [K in Methods]: PosEngine[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
};

export interface PayOptions {
  provider?: Provider;
  /** Solo efectivo: monto entregado por el cliente. */
  receivedClp?: number;
}

export interface PosApi {
  rpc: Rpc;
  /** Devuelve el pago pendiente; el resultado llega por watchPayment. */
  pay(cartId: string, method: PayMethod, opts?: PayOptions): Promise<Payment>;
  watchPayment(paymentId: string, onEvent: (e: PaymentEvent) => void): () => void;
  /** Respalda toda la base de datos del negocio en un archivo JSON descargable. */
  backup(): Promise<string>;
}
