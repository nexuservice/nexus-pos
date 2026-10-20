import type {
  Branch, Cart, CatalogItem, Channel, Customer, DailyReport, InventoryRow, PayMethod, Payment, PaymentEvent,
  Provider, Sale, TaxDocument,
} from '@nexus/core';

export type SaleWithDoc = Sale & { document: TaxDocument | null };

export interface PosApi {
  readonly mode: 'demo' | 'server';
  branches(): Promise<Branch[]>;
  catalog(branchId: string, channel: Channel): Promise<CatalogItem[]>;
  inventory(branchId: string): Promise<InventoryRow[]>;
  moveStock(branchId: string, productId: string, from: Channel, to: Channel, quantity: number): Promise<void>;
  createCart(branchId: string, channel: Channel, customer?: Customer): Promise<Cart>;
  addItem(cartId: string, code: string, quantity?: number): Promise<Cart>;
  setQuantity(cartId: string, index: number, quantity: number): Promise<Cart>;
  clearCart(cartId: string): Promise<Cart>;
  setCustomer(cartId: string, customer: Customer): Promise<Cart>;
  /** Devuelve el pago pendiente; el resultado llega por watchPayment. */
  pay(cartId: string, method: PayMethod, provider?: Provider): Promise<Payment>;
  watchPayment(paymentId: string, onEvent: (e: PaymentEvent) => void): () => void;
  cancelPayment(paymentId: string): Promise<Payment>;
  sale(saleId: string): Promise<SaleWithDoc>;
  report(date: string, branchId: string): Promise<DailyReport>;
}
