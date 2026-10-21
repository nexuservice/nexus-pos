export type Channel = 'physical' | 'online';

export const PAY_METHODS = ['cash', 'debit', 'credit', 'cheque', 'transfer', 'convenio'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: 'Efectivo', debit: 'Débito', credit: 'Crédito', cheque: 'Cheque', transfer: 'Transferencia', convenio: 'Convenio',
};
/** Solo débito y crédito pasan por un terminal; el resto se confirma al instante. */
export const isTerminalMethod = (m: PayMethod): boolean => m === 'debit' || m === 'credit';

export type Provider = 'cash' | 'manual' | 'transbank' | 'mercadopago' | 'getnet';

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
  /** Costo de compra (para utilidad bruta). */
  costClp: number;
  published: boolean;
  active: boolean;
}

/** Cliente registrado. */
export interface Client {
  id: string;
  name: string;
  rut?: string;
  email?: string;
  phone?: string;
  isVip: boolean;
  /** Autorizado para pagar con convenio (a crédito). Exige RUT. */
  creditAuthorized?: boolean;
}

/** Cliente con lo que debe en total por ventas a convenio (ya descontados sus abonos). */
export interface ClientWithDebt extends Client {
  debtClp: number;
}

/** Abono a la deuda de convenio de un cliente. */
export interface CreditPayment {
  id: string;
  clientId: string;
  amountClp: number;
  method: PayMethod;
  shiftId: string | null;
  cashierName?: string;
  at: string;
}

export interface ClientBalance {
  clientId: string;
  debtClp: number;
  /** Total vendido a convenio (sin las ventas anuladas). */
  creditSalesClp: number;
  paidClp: number;
  sales: { id: string; number: number; totalClp: number; paidAt: string }[];
  payments: CreditPayment[];
}

/** Datos del cliente asociados a un carrito (registrado o escrito a mano). */
export interface Customer {
  clientId?: string;
  rut?: string;
  name?: string;
  email?: string;
  phone?: string;
  isVip?: boolean;
  creditAuthorized?: boolean;
}

export interface Cashier {
  id: string;
  name: string;
  pin: string;
  active: boolean;
}

export type PromoType = 'percent' | 'fixed';
export interface Promotion {
  id: string;
  name: string;
  type: PromoType;
  value: number;
  code: string;
  /** YYYY-MM-DD, inclusive. */
  validUntil?: string;
  active: boolean;
}
export interface AppliedPromo {
  id: string;
  name: string;
  code: string;
  type: PromoType;
  value: number;
}

export interface CartLine {
  productId: string;
  name: string;
  unitPriceClp: number;
  costClp: number;
  category?: string;
  quantity: number;
}

export interface Cart {
  id: string;
  branchId: string;
  channel: Channel;
  customer: Customer;
  lines: CartLine[];
  subtotalClp: number;
  discountClp: number;
  totalClp: number;
  promotion?: AppliedPromo;
  status: 'open' | 'paying' | 'closed' | 'held';
}

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Payment {
  id: string;
  cartId: string;
  method: PayMethod;
  provider: Provider;
  amountClp: number;
  receivedClp?: number;
  changeClp?: number;
  status: PaymentStatus;
  idempotencyKey: string;
  authCode?: string;
  message?: string;
  saleId?: string;
}

export interface Sale {
  id: string;
  /** Número correlativo visible (#23). */
  number: number;
  branchId: string;
  channel: Channel;
  shiftId: string | null;
  cashierName?: string;
  customer: Customer;
  lines: CartLine[];
  subtotalClp: number;
  discountClp: number;
  promotionCode?: string;
  totalClp: number;
  netClp: number;
  ivaClp: number;
  method: PayMethod;
  provider: Provider;
  authCode?: string;
  receivedClp?: number;
  changeClp?: number;
  status: 'completed' | 'voided';
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
  paidAt: string;
  documentId: string | null;
}

/**
 * Consumo propio: salida de inventario que no es una venta. Se valoriza al costo, así que no genera
 * ingreso ni ganancia, y no emite boleta ni usa folio.
 */
export interface Consumption {
  id: string;
  number: number;
  branchId: string;
  shiftId: string | null;
  cashierName?: string;
  /** Quién consumió (cliente del pedido, si lo hay). */
  who?: string;
  note?: string;
  lines: CartLine[];
  /** Σ costo × cantidad: lo que sale del inventario. */
  costClp: number;
  status: 'active' | 'voided';
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
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
  reason: 'sale' | 'adjustment' | 'transfer' | 'return' | 'consumption';
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

export interface Shift {
  id: string;
  cashierId: string;
  cashierName: string;
  terminal: string;
  openedAt: string;
  initialCashClp: number;
  status: 'open' | 'closed';
  closedAt?: string;
  notes?: string;
  counted?: Partial<Record<PayMethod, number>>;
  expected?: Partial<Record<PayMethod, number>>;
  /** Contado − esperado, por forma de pago. */
  difference?: Partial<Record<PayMethod, number>>;
  salesCount?: number;
  salesTotalClp?: number;
}

export interface ShiftInfo {
  shift: Shift;
  elapsedMs: number;
  salesCount: number;
  salesTotalClp: number;
  expected: Partial<Record<PayMethod, number>>;
}

export type TicketChannel = 'phone' | 'whatsapp' | 'inperson' | 'web';
export interface Ticket {
  id: string;
  number: number;
  /** Carrito retenido (pedido pendiente de pago). null si ya se pagó. */
  cartId: string | null;
  saleId?: string;
  customerName: string;
  phone?: string;
  email?: string;
  channel: TicketChannel;
  note?: string;
  paid: boolean;
  status: 'open' | 'done';
  lines: CartLine[];
  totalClp: number;
  createdAt: string;
}

export interface SalesFilter {
  from?: string;
  to?: string;
  shiftId?: string;
  branchId?: string;
  limit?: number;
}

export interface Kpis {
  count: number;
  revenueClp: number;
  avgTicketClp: number;
  items: number;
  discountsClp: number;
  costClp: number;
  profitClp: number;
  marginPct: number;
  voidedCount: number;
  voidedClp: number;
  folioFrom: number | null;
  folioTo: number | null;
}

export interface SalesReport {
  from: string;
  to: string;
  kpis: Kpis;
  prev: Kpis;
  /** Variación % frente al período anterior (null si no hay base). */
  deltas: { count: number | null; revenueClp: number | null; avgTicketClp: number | null; items: number | null };
  byDay: { date: string; count: number; revenueClp: number }[];
  byMethod: { method: PayMethod; count: number; revenueClp: number }[];
  byCategory: { category: string; units: number; revenueClp: number; profitClp: number; marginPct: number }[];
  byWeekday: { day: number; count: number; revenueClp: number }[];
  byHour: { hour: number; count: number }[];
  topProducts: { name: string; units: number; revenueClp: number; profitClp: number; marginPct: number }[];
  promotions: { code: string; name: string; uses: number; discountClp: number }[];
  /** Consumo propio del período, al costo (no entra en ingresos ni utilidad). */
  consumption: { count: number; units: number; costClp: number };
}

export interface EngineState {
  branches: Branch[];
  products: Product[];
  clients: Client[];
  cashiers: Cashier[];
  promotions: Promotion[];
  shifts: Shift[];
  tickets: Ticket[];
  stock: Record<string, StockCell>;
  carts: Record<string, Cart>;
  payments: Record<string, Payment>;
  sales: Sale[];
  documents: TaxDocument[];
  movements: StockMovement[];
  /** Abonos a deudas de convenio. Opcional: las bases guardadas antes de esta función no lo traen. */
  creditPayments?: CreditPayment[];
  /** Consumos propios. Opcional: las bases guardadas antes de esta función no lo traen. */
  consumptions?: Consumption[];
  nextFolio: number;
  lastFolio: number;
  saleSeq: number;
  ticketSeq: number;
  seq: number;
}
