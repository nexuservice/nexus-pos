export type Channel = 'physical' | 'online';
export type PayMethod = 'cash' | 'debit' | 'credit';
export type Provider = 'cash' | 'transbank' | 'mercadopago' | 'getnet';

export interface Branch {
  id: string;
  code: string;
  name: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  /** CLP sin decimales, IVA incluido. */
  priceClp: number;
  published: boolean;
}

export interface Customer {
  rut?: string;
  name?: string;
  email?: string;
}

export interface CartLine {
  productId: string;
  name: string;
  unitPriceClp: number;
  quantity: number;
}

export interface Cart {
  id: string;
  branchId: string;
  channel: Channel;
  customer: Customer;
  lines: CartLine[];
  totalClp: number;
  status: 'open' | 'paying' | 'closed';
}

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Payment {
  id: string;
  cartId: string;
  method: PayMethod;
  provider: Provider;
  amountClp: number;
  status: PaymentStatus;
  idempotencyKey: string;
  authCode?: string;
  message?: string;
  saleId?: string;
}

export interface Sale {
  id: string;
  branchId: string;
  channel: Channel;
  customer: Customer;
  lines: CartLine[];
  totalClp: number;
  netClp: number;
  ivaClp: number;
  method: PayMethod;
  provider: Provider;
  authCode?: string;
  createdAt: string;
  paidAt: string;
  documentId: string | null;
}

export interface TaxDocument {
  id: string;
  saleId: string;
  dteType: 39 | 33;
  folio: number;
  xml: string;
  /** Sin firma ni timbre: "draft" hasta integrarse con un certificador SII. */
  siiStatus: 'draft';
  issuedAt: string;
}

export interface StockMovement {
  id: string;
  branchId: string;
  productId: string;
  channel: Channel;
  delta: number;
  reason: 'sale' | 'adjustment' | 'transfer';
  refId?: string;
  at: string;
}

export interface StockCell {
  qty: number;
  reserved: number;
}

export interface Emisor {
  rut: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  comuna: string;
}

export interface PaymentEvent {
  paymentId: string;
  type: 'pending' | 'terminal_waiting' | 'approved' | 'rejected' | 'cancelled';
  message?: string;
  saleId?: string;
  at: string;
}

export interface CatalogItem extends Product {
  available: number;
}

export interface InventoryRow {
  product: Product;
  physical: StockCell;
  online: StockCell;
}

export interface DailyReport {
  date: string;
  branchId?: string;
  count: number;
  totalClp: number;
  avgTicketClp: number;
  byChannel: Record<Channel, { count: number; totalClp: number }>;
  byMethod: Record<string, { count: number; totalClp: number }>;
  topProducts: { name: string; quantity: number; totalClp: number }[];
}

export interface EngineState {
  branches: Branch[];
  products: Product[];
  stock: Record<string, StockCell>;
  carts: Record<string, Cart>;
  payments: Record<string, Payment>;
  sales: Sale[];
  documents: TaxDocument[];
  movements: StockMovement[];
  nextFolio: number;
  lastFolio: number;
  seq: number;
}
