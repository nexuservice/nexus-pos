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
  clientName: string;
  clientRut?: string;
  debtClp: number;
  /** Total vendido a convenio (sin las ventas anuladas). */
  creditSalesClp: number;
  paidClp: number;
  /** Compras a convenio con su detalle (productos, cantidades y precios), de la más nueva a la más antigua. */
  sales: { id: string; number: number; totalClp: number; subtotalClp: number; discountClp: number; lines: CartLine[]; paidAt: string }[];
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

/** Cambio del precio de venta de un producto (corrección o alza). Las ventas ya hechas conservan el precio al que se vendieron. */
export interface PriceChange {
  id: string;
  productId: string;
  at: string;
  /** Precios con IVA, antes y después. */
  oldPriceClp: number;
  newPriceClp: number;
  /** Costo del producto en ese momento. */
  costClp: number;
  reason?: string;
}

export const PURCHASE_DOC_TYPES = ['factura', 'boleta', 'guia'] as const;
export type PurchaseDocType = (typeof PURCHASE_DOC_TYPES)[number];
export const PURCHASE_DOC_LABEL: Record<PurchaseDocType, string> = { factura: 'Factura', boleta: 'Boleta', guia: 'Guía de despacho' };

export interface PurchaseLine {
  productId: string;
  name: string;
  quantity: number;
  /** Costo unitario neto (sin IVA), tal como viene en la factura. */
  unitCostClp: number;
  totalClp: number;
  /** Precio de venta unitario del producto después de esta compra (neto y con IVA). */
  priceNetClp?: number;
  priceClp?: number;
}

/**
 * Compra a un proveedor: entra al inventario como «compra» (no como ajuste), con el documento y su fecha,
 * para que la tarjeta de existencia refleje el origen real de cada unidad.
 */
export interface Purchase {
  id: string;
  number: number;
  branchId: string;
  supplierName: string;
  supplierRut?: string;
  docType: PurchaseDocType;
  docNumber: string;
  /** Fecha del documento (YYYY-MM-DD). */
  docDate: string;
  note?: string;
  lines: PurchaseLine[];
  netClp: number;
  ivaClp: number;
  totalClp: number;
  status: 'active' | 'voided';
  voidedAt?: string;
  voidReason?: string;
  /** Cuándo se registró en el sistema. */
  createdAt: string;
}

/** Línea de una compra por registrar: un producto existente o uno nuevo que se crea con la compra. */
export interface PurchaseLineInput {
  productId?: string;
  /** Si no trae priceClp (con IVA), el precio sale de priceNetClp de la línea. */
  newProduct?: { name: string; category?: string; sku?: string; barcode?: string; priceClp?: number; published?: boolean };
  quantity: number;
  /** Costo unitario neto de la factura. */
  unitCostClp: number;
  /** Precio de venta neto unitario nuevo (el sistema calcula el valor con IVA). Si se omite, el precio de un producto existente no cambia. */
  priceNetClp?: number;
}

export interface PurchaseInput {
  branchId: string;
  supplierName: string;
  supplierRut?: string;
  docType?: PurchaseDocType;
  docNumber: string;
  docDate: string;
  note?: string;
  /** Recalcula el costo del producto (promedio ponderado con lo que ya hay). Por defecto sí. */
  updateCost?: boolean;
  lines: PurchaseLineInput[];
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
  reason: 'sale' | 'adjustment' | 'transfer' | 'return' | 'consumption' | 'purchase';
  refId?: string;
  /** Costo neto unitario y precio de venta unitario (con IVA) vigentes en ese movimiento: con la inflación van cambiando. */
  unitCostClp?: number;
  unitPriceClp?: number;
  at: string;
}

/** Una línea de la tarjeta de existencia: lo que entró o salió y el saldo que quedó. */
export interface StockCardRow {
  id: string;
  at: string;
  /** null en los cambios de precio, que no son de ningún canal. */
  channel: Channel | null;
  /** 'price' = cambio de precio (sin entrada ni salida). */
  type: StockMovement['reason'] | 'price';
  /** Qué originó el movimiento (Venta #12, Consumo #3, Ajuste, Traspaso a Online…). */
  detail: string;
  /** Las compras se fechan con el día del documento, así que solo cuenta la fecha, no la hora. */
  dateOnly?: boolean;
  /** Venta de origen (o la venta anulada), para abrir su boleta desde la tarjeta. */
  saleId?: string;
  entry: number;
  exit: number;
  /** Existencia después de este movimiento. */
  balance: number;
  /** Costo neto unitario y precio de venta unitario (neto y con IVA) vigentes en ese movimiento. */
  unitCostClp: number;
  unitPriceNetClp: number;
  unitPriceClp: number;
  /** Cantidad × costo. Vacío en traspasos entre canales, que no se valoran. */
  entryValueClp?: number;
  /** Cantidad × precio de venta neto (consumos y anulaciones de compra, al costo). */
  exitValueClp?: number;
}

/** Tarjeta de existencia (kardex) de un producto. Las filas van de la más nueva a la más antigua. */
export interface StockCard {
  product: Product;
  channel: Channel | 'all';
  openingQty: number;
  closingQty: number;
  entries: number;
  exits: number;
  /** Valor de las entradas del período (al costo) y de las salidas (al precio de venta neto; consumos al costo). */
  entryValueClp: number;
  exitValueClp: number;
  /** Cantidad reservada en carritos y pedidos abiertos (dentro de la existencia actual). */
  reservedQty: number;
  /** Existencia actual del producto en el canal consultado. */
  currentQty: number;
  rows: StockCardRow[];
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
  /** Compras a proveedores. Opcional: las bases guardadas antes de esta función no lo traen. */
  purchases?: Purchase[];
  /** Historial de cambios de precio. Opcional: las bases guardadas antes de esta función no lo traen. */
  priceChanges?: PriceChange[];
  nextFolio: number;
  lastFolio: number;
  saleSeq: number;
  ticketSeq: number;
  seq: number;
}
