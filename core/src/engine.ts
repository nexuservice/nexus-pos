import type {
  Branch, CartLine, Cart, CatalogItem, Channel, Customer, DailyReport, Emisor, EngineState, InventoryRow,
  PayMethod, Payment, PaymentEvent, Product, Provider, Sale, StockCell, TaxDocument,
} from './types';
import { splitIva } from './money';
import { isValidRut, normalizeRut } from './rut';
import { buildBoletaXml } from './billing';

export type ErrorCode =
  | 'NOT_FOUND' | 'INVALID_QTY' | 'OUT_OF_STOCK' | 'CART_NOT_OPEN' | 'EMPTY_CART'
  | 'INVALID_RUT' | 'CUSTOMER_REQUIRED' | 'METHOD_NOT_ALLOWED' | 'NO_FOLIOS' | 'INSUFFICIENT_STOCK';

export class PosError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'PosError';
  }
}

export interface EngineOptions {
  now?: () => Date;
  emisor?: Emisor;
}

export const DEFAULT_EMISOR: Emisor = {
  rut: '11111111-1',
  razonSocial: 'Nexus Demo SpA',
  giro: 'Comercio al por menor',
  direccion: 'Av. Providencia 1234',
  comuna: 'Providencia',
};

type Listener = (e: PaymentEvent) => void;

/**
 * Motor de ventas. Toda operación es síncrona (sin await dentro de una mutación),
 * así que en JavaScript es atómica: dos carritos no pueden reservar la misma unidad.
 */
export class PosEngine {
  private state: EngineState;
  private readonly now: () => Date;
  private readonly emisor: Emisor;
  private readonly eventLog = new Map<string, PaymentEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(state: EngineState, opts: EngineOptions = {}) {
    this.state = state;
    this.now = opts.now ?? (() => new Date());
    this.emisor = opts.emisor ?? DEFAULT_EMISOR;
  }

  // ---------- utilidades ----------
  private id(prefix: string): string {
    return `${prefix}_${++this.state.seq}`;
  }
  private key(b: string, p: string, c: Channel): string {
    return `${b}:${p}:${c}`;
  }
  private cell(b: string, p: string, c: Channel): StockCell {
    const k = this.key(b, p, c);
    return (this.state.stock[k] ??= { qty: 0, reserved: 0 });
  }
  private product(code: string): Product | undefined {
    return this.state.products.find((p) => p.id === code || p.barcode === code || p.sku === code);
  }
  private openCart(id: string): Cart {
    const cart = this.state.carts[id];
    if (!cart) throw new PosError('NOT_FOUND', 'Carrito no existe');
    if (cart.status !== 'open') throw new PosError('CART_NOT_OPEN', 'El carrito no admite cambios');
    return cart;
  }
  private recompute(cart: Cart): void {
    cart.totalClp = cart.lines.reduce((s, l) => s + l.unitPriceClp * l.quantity, 0);
  }
  private releaseAll(cart: Cart): void {
    for (const l of cart.lines) this.cell(cart.branchId, l.productId, cart.channel).reserved -= l.quantity;
  }

  // ---------- consulta ----------
  branches(): Branch[] {
    return structuredClone(this.state.branches);
  }

  available(branchId: string, productId: string, channel: Channel): number {
    const c = this.cell(branchId, productId, channel);
    return c.qty - c.reserved;
  }

  catalog(branchId: string, channel: Channel): CatalogItem[] {
    return this.state.products
      .filter((p) => channel === 'physical' || p.published)
      .map((p) => ({ ...p, available: this.available(branchId, p.id, channel) }));
  }

  inventory(branchId: string): InventoryRow[] {
    return this.state.products.map((product) => ({
      product: { ...product },
      physical: { ...this.cell(branchId, product.id, 'physical') },
      online: { ...this.cell(branchId, product.id, 'online') },
    }));
  }

  getCart(id: string): Cart {
    const c = this.state.carts[id];
    if (!c) throw new PosError('NOT_FOUND', 'Carrito no existe');
    return structuredClone(c);
  }
  getPayment(id: string): Payment {
    const p = this.state.payments[id];
    if (!p) throw new PosError('NOT_FOUND', 'Pago no existe');
    return structuredClone(p);
  }
  getSale(id: string): Sale & { document: TaxDocument | null } {
    const s = this.state.sales.find((x) => x.id === id);
    if (!s) throw new PosError('NOT_FOUND', 'Venta no existe');
    const document = this.state.documents.find((d) => d.id === s.documentId) ?? null;
    return structuredClone({ ...s, document });
  }
  sales(branchId?: string): Sale[] {
    return structuredClone(this.state.sales.filter((s) => !branchId || s.branchId === branchId));
  }
  foliosRemaining(): number {
    return Math.max(0, this.state.lastFolio - this.state.nextFolio + 1);
  }

  // ---------- carrito ----------
  createCart(branchId: string, channel: Channel, customer: Customer = {}): Cart {
    if (!this.state.branches.some((b) => b.id === branchId)) throw new PosError('NOT_FOUND', 'Sucursal no existe');
    const cart: Cart = { id: this.id('cart'), branchId, channel, customer, lines: [], totalClp: 0, status: 'open' };
    this.state.carts[cart.id] = cart;
    return structuredClone(cart);
  }

  cartAdd(cartId: string, code: string, quantity = 1): Cart {
    const cart = this.openCart(cartId);
    const p = this.product(code);
    if (!p || (cart.channel === 'online' && !p.published)) throw new PosError('NOT_FOUND', 'Producto no encontrado');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new PosError('INVALID_QTY', 'Cantidad inválida');
    const cell = this.cell(cart.branchId, p.id, cart.channel);
    if (cell.qty - cell.reserved < quantity) throw new PosError('OUT_OF_STOCK', `Sin stock suficiente de ${p.name}`);
    cell.reserved += quantity;
    const line = cart.lines.find((l) => l.productId === p.id);
    if (line) line.quantity += quantity;
    else cart.lines.push({ productId: p.id, name: p.name, unitPriceClp: p.priceClp, quantity });
    this.recompute(cart);
    return structuredClone(cart);
  }

  /** quantity = 0 quita la línea. */
  cartSetQuantity(cartId: string, index: number, quantity: number): Cart {
    const cart = this.openCart(cartId);
    const line = cart.lines[index];
    if (!line) throw new PosError('NOT_FOUND', 'Línea no existe');
    if (!Number.isInteger(quantity) || quantity < 0) throw new PosError('INVALID_QTY', 'Cantidad inválida');
    const delta = quantity - line.quantity;
    const cell = this.cell(cart.branchId, line.productId, cart.channel);
    if (delta > 0 && cell.qty - cell.reserved < delta) throw new PosError('OUT_OF_STOCK', `Sin stock suficiente de ${line.name}`);
    cell.reserved += delta;
    if (quantity === 0) cart.lines.splice(index, 1);
    else line.quantity = quantity;
    this.recompute(cart);
    return structuredClone(cart);
  }

  cartRemove(cartId: string, index: number): Cart {
    return this.cartSetQuantity(cartId, index, 0);
  }

  cartClear(cartId: string): Cart {
    const cart = this.openCart(cartId);
    this.releaseAll(cart);
    cart.lines = [];
    this.recompute(cart);
    return structuredClone(cart);
  }

  setCustomer(cartId: string, customer: Customer): Cart {
    const cart = this.openCart(cartId);
    const next: Customer = { ...customer };
    if (next.rut) {
      if (!isValidRut(next.rut)) throw new PosError('INVALID_RUT', 'RUT inválido');
      next.rut = normalizeRut(next.rut);
    }
    cart.customer = next;
    return structuredClone(cart);
  }

  // ---------- pagos ----------
  beginPayment(
    cartId: string, method: PayMethod, provider?: Provider, idempotencyKey?: string,
  ): { payment: Payment; created: boolean } {
    const key = idempotencyKey ?? `${cartId}:${method}`;
    const existing = Object.values(this.state.payments).find((p) => p.idempotencyKey === key);
    if (existing) return { payment: structuredClone(existing), created: false };

    const cart = this.openCart(cartId);
    if (cart.lines.length === 0) throw new PosError('EMPTY_CART', 'El carrito está vacío');
    if (cart.channel === 'online') {
      if (!cart.customer.name || !cart.customer.email) throw new PosError('CUSTOMER_REQUIRED', 'Faltan nombre y correo del cliente');
      if (method === 'cash') throw new PosError('METHOD_NOT_ALLOWED', 'La tienda online no acepta efectivo');
    }
    if (this.foliosRemaining() === 0) throw new PosError('NO_FOLIOS', 'No quedan folios de boleta disponibles');

    const resolved: Provider = method === 'cash' ? 'cash' : provider && provider !== 'cash' ? provider : cart.channel === 'online' ? 'mercadopago' : 'transbank';
    const payment: Payment = {
      id: this.id('pay'), cartId, method, provider: resolved, amountClp: cart.totalClp,
      status: 'pending', idempotencyKey: key,
    };
    this.state.payments[payment.id] = payment;
    cart.status = 'paying';
    this.emit(payment.id, 'pending');
    return { payment: structuredClone(payment), created: true };
  }

  /** Cierra el pago con el resultado del terminal. Idempotente: si ya no está pendiente, no hace nada. */
  resolvePayment(paymentId: string, outcome: { approved: boolean; authCode?: string; message?: string }): Payment {
    const payment = this.state.payments[paymentId];
    if (!payment) throw new PosError('NOT_FOUND', 'Pago no existe');
    if (payment.status !== 'pending') return structuredClone(payment);
    const cart = this.state.carts[payment.cartId]!;

    if (!outcome.approved) {
      payment.status = 'rejected';
      payment.message = outcome.message ?? 'Pago rechazado';
      cart.status = 'open';
      this.emit(paymentId, 'rejected', payment.message);
      return structuredClone(payment);
    }

    const at = this.now();
    const iso = at.toISOString();
    const saleId = this.id('sale');
    const { netClp, ivaClp } = splitIva(cart.totalClp);
    const lines: CartLine[] = structuredClone(cart.lines);
    for (const l of lines) {
      const cell = this.cell(cart.branchId, l.productId, cart.channel);
      cell.qty -= l.quantity;
      cell.reserved -= l.quantity;
      this.state.movements.push({
        id: this.id('mov'), branchId: cart.branchId, productId: l.productId, channel: cart.channel,
        delta: -l.quantity, reason: 'sale', refId: saleId, at: iso,
      });
    }

    let documentId: string | null = null;
    if (this.state.nextFolio <= this.state.lastFolio) {
      const folio = this.state.nextFolio++;
      const doc: TaxDocument = {
        id: this.id('doc'), saleId, dteType: 39, folio, siiStatus: 'draft', issuedAt: iso,
        xml: buildBoletaXml({
          folio, date: iso.slice(0, 10), emisor: this.emisor, receptor: cart.customer, lines, totalClp: cart.totalClp,
        }),
      };
      this.state.documents.push(doc);
      documentId = doc.id;
    }

    const sale: Sale = {
      id: saleId, branchId: cart.branchId, channel: cart.channel, customer: structuredClone(cart.customer), lines,
      totalClp: cart.totalClp, netClp, ivaClp, method: payment.method, provider: payment.provider,
      authCode: outcome.authCode, createdAt: iso, paidAt: iso, documentId,
    };
    this.state.sales.push(sale);
    payment.status = 'approved';
    payment.authCode = outcome.authCode;
    payment.saleId = saleId;
    cart.status = 'closed';
    this.emit(paymentId, 'approved', undefined, saleId);
    return structuredClone(payment);
  }

  cancelPayment(paymentId: string): Payment {
    const payment = this.state.payments[paymentId];
    if (!payment) throw new PosError('NOT_FOUND', 'Pago no existe');
    if (payment.status === 'pending') {
      payment.status = 'cancelled';
      this.state.carts[payment.cartId]!.status = 'open';
      this.emit(paymentId, 'cancelled', 'Cobro cancelado');
    }
    return structuredClone(payment);
  }

  // ---------- eventos de pago (para SSE) ----------
  emit(paymentId: string, type: PaymentEvent['type'], message?: string, saleId?: string): void {
    const e: PaymentEvent = { paymentId, type, message, saleId, at: this.now().toISOString() };
    const log = this.eventLog.get(paymentId) ?? [];
    log.push(e);
    this.eventLog.set(paymentId, log);
    this.listeners.get(paymentId)?.forEach((fn) => fn(e));
  }

  /** Reproduce los eventos previos y luego los nuevos. Devuelve la función para desuscribirse. */
  onPaymentEvent(paymentId: string, fn: Listener): () => void {
    (this.eventLog.get(paymentId) ?? []).forEach(fn);
    const set = this.listeners.get(paymentId) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(paymentId, set);
    return () => set.delete(fn);
  }

  // ---------- inventario ----------
  adjustStock(branchId: string, productId: string, channel: Channel, delta: number): void {
    if (!this.product(productId)) throw new PosError('NOT_FOUND', 'Producto no existe');
    const c = this.cell(branchId, productId, channel);
    if (c.qty + delta < c.reserved) throw new PosError('INSUFFICIENT_STOCK', 'El ajuste deja menos stock que lo reservado');
    c.qty += delta;
    this.state.movements.push({
      id: this.id('mov'), branchId, productId, channel, delta, reason: 'adjustment', at: this.now().toISOString(),
    });
  }

  /** Mueve stock entre canales (p. ej. del local a la tienda online) sin perder unidades. */
  moveStock(branchId: string, productId: string, from: Channel, to: Channel, quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new PosError('INVALID_QTY', 'Cantidad inválida');
    const src = this.cell(branchId, productId, from);
    if (src.qty - src.reserved < quantity) throw new PosError('INSUFFICIENT_STOCK', 'No hay stock libre para mover');
    const dst = this.cell(branchId, productId, to);
    src.qty -= quantity;
    dst.qty += quantity;
    const at = this.now().toISOString();
    const refId = this.id('xfer');
    this.state.movements.push(
      { id: this.id('mov'), branchId, productId, channel: from, delta: -quantity, reason: 'transfer', refId, at },
      { id: this.id('mov'), branchId, productId, channel: to, delta: quantity, reason: 'transfer', refId, at },
    );
  }

  // ---------- reportes ----------
  dailyReport(date: string, branchId?: string): DailyReport {
    const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const sales = this.state.sales.filter((s) => (!branchId || s.branchId === branchId) && day(s.paidAt) === date);
    const byChannel: DailyReport['byChannel'] = { physical: { count: 0, totalClp: 0 }, online: { count: 0, totalClp: 0 } };
    const byMethod: DailyReport['byMethod'] = {};
    const top = new Map<string, { name: string; quantity: number; totalClp: number }>();
    let totalClp = 0;
    for (const s of sales) {
      totalClp += s.totalClp;
      byChannel[s.channel].count++;
      byChannel[s.channel].totalClp += s.totalClp;
      const m = (byMethod[s.method] ??= { count: 0, totalClp: 0 });
      m.count++;
      m.totalClp += s.totalClp;
      for (const l of s.lines) {
        const t = top.get(l.productId) ?? { name: l.name, quantity: 0, totalClp: 0 };
        t.quantity += l.quantity;
        t.totalClp += l.quantity * l.unitPriceClp;
        top.set(l.productId, t);
      }
    }
    return {
      date, branchId, count: sales.length, totalClp,
      avgTicketClp: sales.length ? Math.round(totalClp / sales.length) : 0,
      byChannel, byMethod,
      topProducts: [...top.values()].sort((a, b) => b.totalClp - a.totalClp).slice(0, 5),
    };
  }

  // ---------- persistencia ----------
  snapshot(): EngineState {
    return structuredClone(this.state);
  }
}
