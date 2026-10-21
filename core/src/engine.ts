import type {
  AppliedPromo, Branch, Cart, CartLine, CatalogItem, Cashier, Channel, Client, ClientBalance, ClientWithDebt, Consumption, CreditPayment, Customer, Emisor, EngineState,
  InventoryRow, PayMethod, Payment, PaymentEvent, Product, Promotion, Provider, Sale, SalesFilter, SalesReport,
  Shift, ShiftInfo, StockCell, TaxDocument, Ticket, TicketChannel,
} from './types';
import { PAY_METHODS, isTerminalMethod } from './types';
import { splitIva } from './money';
import { isValidRut, normalizeRut } from './rut';
import { buildBoletaXml } from './billing';
import { buildSalesReport, santiagoDay } from './reports';

export type ErrorCode =
  | 'NOT_FOUND' | 'INVALID_QTY' | 'OUT_OF_STOCK' | 'CART_NOT_OPEN' | 'EMPTY_CART' | 'INVALID_RUT'
  | 'CUSTOMER_REQUIRED' | 'METHOD_NOT_ALLOWED' | 'NO_FOLIOS' | 'INSUFFICIENT_STOCK' | 'NO_SHIFT' | 'SHIFT_OPEN'
  | 'BAD_PIN' | 'INVALID_AMOUNT' | 'PROMO_INVALID' | 'INVALID_DATA' | 'NOT_ALLOWED';

export class PosError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'PosError';
  }
}

export interface EngineOptions {
  now?: () => Date;
  emisor?: Emisor;
  terminal?: string;
}

export const DEFAULT_EMISOR: Emisor = {
  rut: '11111111-1',
  razonSocial: 'Nexus Demo SpA',
  giro: 'Comercio al por menor',
  direccion: 'Av. Providencia 1234',
  comuna: 'Providencia',
};

type Listener = (e: PaymentEvent) => void;
const clone = <T>(v: T): T => structuredClone(v);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Motor de ventas. Toda operación es síncrona (sin await dentro de una mutación),
 * así que en JavaScript es atómica: dos carritos no pueden reservar la misma unidad.
 */
export class PosEngine {
  private state: EngineState;
  private readonly now: () => Date;
  private readonly emisor: Emisor;
  private readonly terminal: string;
  private readonly eventLog = new Map<string, PaymentEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(state: EngineState, opts: EngineOptions = {}) {
    this.state = state;
    this.state.creditPayments ??= [];
    this.state.consumptions ??= [];
    this.now = opts.now ?? (() => new Date());
    this.emisor = opts.emisor ?? DEFAULT_EMISOR;
    this.terminal = opts.terminal ?? 'CAJA1';
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
  private cartOf(id: string): Cart {
    const cart = this.state.carts[id];
    if (!cart) throw new PosError('NOT_FOUND', 'Carrito no existe');
    return cart;
  }
  private openCart(id: string): Cart {
    const cart = this.cartOf(id);
    if (cart.status !== 'open') throw new PosError('CART_NOT_OPEN', 'El carrito no admite cambios');
    return cart;
  }
  private recompute(cart: Cart): void {
    cart.subtotalClp = cart.lines.reduce((s, l) => s + l.unitPriceClp * l.quantity, 0);
    const p = cart.promotion;
    let discount = 0;
    if (p && cart.subtotalClp > 0) {
      discount = p.type === 'percent' ? Math.round((cart.subtotalClp * p.value) / 100) : Math.min(p.value, cart.subtotalClp);
    }
    cart.discountClp = discount;
    cart.totalClp = cart.subtotalClp - discount;
  }
  private releaseAll(cart: Cart): void {
    for (const l of cart.lines) this.cell(cart.branchId, l.productId, cart.channel).reserved -= l.quantity;
  }
  private today(): string {
    return santiagoDay(this.now().toISOString());
  }

  // ---------- catálogo e inventario ----------
  branches(): Branch[] {
    return clone(this.state.branches);
  }

  available(branchId: string, productId: string, channel: Channel): number {
    const c = this.cell(branchId, productId, channel);
    return c.qty - c.reserved;
  }

  catalog(branchId: string, channel: Channel): CatalogItem[] {
    return this.state.products
      .filter((p) => p.active && (channel === 'physical' || p.published))
      .map((p) => ({ ...p, available: this.available(branchId, p.id, channel) }));
  }

  listProducts(): Product[] {
    return clone(this.state.products);
  }

  upsertProduct(input: Partial<Product> & { name: string; priceClp: number }): Product {
    const name = input.name?.trim();
    if (!name || !Number.isInteger(input.priceClp) || input.priceClp < 0) throw new PosError('INVALID_DATA', 'Nombre y precio válidos son obligatorios');
    const cost = input.costClp ?? 0;
    if (!Number.isInteger(cost) || cost < 0) throw new PosError('INVALID_DATA', 'Costo inválido');
    const existing = input.id ? this.state.products.find((p) => p.id === input.id) : undefined;
    const barcode = (input.barcode ?? existing?.barcode ?? '').trim();
    if (barcode && this.state.products.some((p) => p.barcode === barcode && p.id !== existing?.id)) {
      throw new PosError('INVALID_DATA', 'Ya existe un producto con ese código de barras');
    }
    if (existing) {
      Object.assign(existing, { ...input, name, barcode, costClp: cost });
      return clone(existing);
    }
    const n = this.state.products.length + 1;
    // el contador de ids parte de 0 y los productos de ejemplo ya usan prod_1…prod_N: se salta los ocupados
    let newId = this.id('prod');
    while (this.state.products.some((x) => x.id === newId)) newId = this.id('prod');
    const p: Product = {
      id: newId, sku: input.sku?.trim() || `NX-${String(n).padStart(4, '0')}`,
      barcode: barcode || `78${String(Date.now()).slice(-11)}`, name, category: input.category?.trim() || 'General',
      priceClp: input.priceClp, costClp: cost, published: input.published ?? true, active: input.active ?? true,
    };
    this.state.products.push(p);
    return clone(p);
  }

  inventory(branchId: string): InventoryRow[] {
    return this.state.products.map((product) => ({
      product: { ...product },
      physical: { ...this.cell(branchId, product.id, 'physical') },
      online: { ...this.cell(branchId, product.id, 'online') },
    }));
  }

  adjustStock(branchId: string, productId: string, channel: Channel, delta: number): void {
    const p = this.product(productId);
    if (!p) throw new PosError('NOT_FOUND', 'Producto no existe');
    if (!Number.isInteger(delta) || delta === 0) throw new PosError('INVALID_QTY', 'Cantidad inválida');
    const c = this.cell(branchId, p.id, channel);
    if (c.qty + delta < c.reserved) throw new PosError('INSUFFICIENT_STOCK', 'El ajuste deja menos stock que lo reservado');
    c.qty += delta;
    this.state.movements.push({
      id: this.id('mov'), branchId, productId: p.id, channel, delta, reason: 'adjustment', at: this.now().toISOString(),
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

  movements(productId?: string, limit = 100): EngineState['movements'] {
    return clone(this.state.movements.filter((m) => !productId || m.productId === productId).slice(-limit).reverse());
  }

  // ---------- clientes, cajeros ----------
  listClients(): ClientWithDebt[] {
    return clone(this.state.clients.map((c) => ({ ...c, debtClp: this.debtOf(c.id) })));
  }

  /** Búsqueda por nombre o RUT (mínimo 2 caracteres, sin tildes ni puntos). Incluye lo que cada cliente debe. */
  searchClients(q: string): ClientWithDebt[] {
    const term = norm(q ?? '').replace(/[.\s]/g, '');
    if (term.length < 2) return [];
    return clone(
      this.state.clients
        .filter((c) => norm(c.name).replace(/\s/g, '').includes(term) || (c.rut ?? '').replace(/[.\-]/g, '').toLowerCase().includes(term.replace(/-/g, '')))
        .slice(0, 8)
        .map((c) => ({ ...c, debtClp: this.debtOf(c.id) })),
    );
  }

  // ---------- convenio (venta a crédito) ----------
  private creditSales(clientId: string): Sale[] {
    return this.state.sales.filter((s) => s.method === 'convenio' && s.status === 'completed' && s.customer.clientId === clientId);
  }

  private debtOf(clientId: string): number {
    const sold = this.creditSales(clientId).reduce((n, s) => n + s.totalClp, 0);
    const paid = (this.state.creditPayments ?? []).filter((p) => p.clientId === clientId).reduce((n, p) => n + p.amountClp, 0);
    return Math.max(0, sold - paid);
  }

  /** Lo que el cliente debe en total por ventas a convenio, con el detalle de ventas y abonos. */
  clientBalance(clientId: string): ClientBalance {
    if (!this.state.clients.some((c) => c.id === clientId)) throw new PosError('NOT_FOUND', 'Cliente no existe');
    const sales = this.creditSales(clientId);
    const payments = (this.state.creditPayments ?? []).filter((p) => p.clientId === clientId);
    return clone({
      clientId,
      debtClp: this.debtOf(clientId),
      creditSalesClp: sales.reduce((n, s) => n + s.totalClp, 0),
      paidClp: payments.reduce((n, p) => n + p.amountClp, 0),
      sales: sales.map((s) => ({ id: s.id, number: s.number, totalClp: s.totalClp, paidAt: s.paidAt })).reverse(),
      payments: [...payments].reverse(),
    });
  }

  /** Registra un abono (o el pago completo) a la deuda de convenio. Entra a la jornada abierta con su forma de pago. */
  payClientDebt(clientId: string, amountClp: number, method: PayMethod): ClientBalance {
    if (!this.state.clients.some((c) => c.id === clientId)) throw new PosError('NOT_FOUND', 'Cliente no existe');
    if (!PAY_METHODS.includes(method) || method === 'convenio') throw new PosError('METHOD_NOT_ALLOWED', 'Elige una forma de pago distinta de convenio');
    const shift = this.openShiftRef();
    if (!shift) throw new PosError('NO_SHIFT', 'Debe haber una jornada abierta para registrar el pago');
    if (!Number.isInteger(amountClp) || amountClp <= 0) throw new PosError('INVALID_AMOUNT', 'Monto inválido');
    const debt = this.debtOf(clientId);
    if (debt === 0) throw new PosError('NOT_ALLOWED', 'El cliente no tiene deuda');
    if (amountClp > debt) throw new PosError('INVALID_AMOUNT', 'El monto supera la deuda del cliente');
    const payment: CreditPayment = {
      id: this.id('abono'), clientId, amountClp, method, shiftId: shift.id, cashierName: shift.cashierName, at: this.now().toISOString(),
    };
    this.state.creditPayments!.push(payment);
    return this.clientBalance(clientId);
  }

  upsertClient(input: Partial<Client> & { name: string }): Client {
    const name = input.name?.trim();
    if (!name) throw new PosError('INVALID_DATA', 'El nombre es obligatorio');
    let rut = input.rut?.trim() || undefined;
    if (rut) {
      if (!isValidRut(rut)) throw new PosError('INVALID_RUT', 'RUT inválido');
      rut = normalizeRut(rut);
    }
    const existing = input.id ? this.state.clients.find((c) => c.id === input.id) : undefined;
    if (rut && this.state.clients.some((c) => c.rut === rut && c.id !== existing?.id)) throw new PosError('INVALID_DATA', 'Ya existe un cliente con ese RUT');
    const creditAuthorized = !!input.creditAuthorized;
    if (creditAuthorized && !rut) throw new PosError('INVALID_DATA', 'Para autorizar convenio el cliente necesita RUT');
    if (existing) {
      Object.assign(existing, { name, rut, email: input.email?.trim() || undefined, phone: input.phone?.trim() || undefined, isVip: !!input.isVip, creditAuthorized });
      return clone(existing);
    }
    const c: Client = { id: this.id('cli'), name, rut, email: input.email?.trim() || undefined, phone: input.phone?.trim() || undefined, isVip: !!input.isVip, creditAuthorized };
    this.state.clients.push(c);
    return clone(c);
  }

  deleteClient(id: string): void {
    if (this.debtOf(id) > 0) throw new PosError('NOT_ALLOWED', 'No se puede eliminar un cliente con deuda pendiente');
    this.state.clients = this.state.clients.filter((c) => c.id !== id);
  }

  listCashiers(): Omit<Cashier, 'pin'>[] {
    return this.state.cashiers.map(({ pin: _pin, ...c }) => c);
  }

  upsertCashier(input: Partial<Cashier> & { name: string; pin?: string }): Omit<Cashier, 'pin'> {
    const name = input.name?.trim();
    if (!name) throw new PosError('INVALID_DATA', 'El nombre es obligatorio');
    if (input.pin !== undefined && input.pin !== '' && !/^\d{4,8}$/.test(input.pin)) throw new PosError('INVALID_DATA', 'El PIN debe tener de 4 a 8 dígitos');
    const existing = input.id ? this.state.cashiers.find((c) => c.id === input.id) : undefined;
    if (existing) {
      existing.name = name;
      existing.active = input.active ?? existing.active;
      if (input.pin) existing.pin = input.pin;
      const { pin: _pin, ...rest } = existing;
      return rest;
    }
    if (!input.pin) throw new PosError('INVALID_DATA', 'El PIN es obligatorio');
    const c: Cashier = { id: this.id('cashier'), name, pin: input.pin, active: input.active ?? true };
    this.state.cashiers.push(c);
    const { pin: _pin, ...rest } = c;
    return rest;
  }

  // ---------- promociones ----------
  listPromotions(): Promotion[] {
    return clone(this.state.promotions);
  }

  activePromotions(): Promotion[] {
    const today = this.today();
    return clone(this.state.promotions.filter((p) => p.active && (!p.validUntil || p.validUntil >= today)));
  }

  upsertPromotion(input: Partial<Promotion> & { name: string; type: Promotion['type']; value: number; code: string }): Promotion {
    const name = input.name?.trim();
    const code = input.code?.trim().toUpperCase();
    if (!name || !code) throw new PosError('INVALID_DATA', 'Nombre y código son obligatorios');
    if (!Number.isInteger(input.value) || input.value <= 0 || (input.type === 'percent' && input.value > 100)) {
      throw new PosError('INVALID_DATA', 'Valor inválido (porcentaje de 1 a 100 o monto en CLP)');
    }
    if (input.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) throw new PosError('INVALID_DATA', 'Fecha inválida');
    const existing = input.id ? this.state.promotions.find((p) => p.id === input.id) : undefined;
    if (this.state.promotions.some((p) => p.code === code && p.id !== existing?.id)) throw new PosError('INVALID_DATA', 'Ya existe una promoción con ese código');
    if (existing) {
      Object.assign(existing, { name, code, type: input.type, value: input.value, validUntil: input.validUntil || undefined, active: input.active ?? existing.active });
      return clone(existing);
    }
    const p: Promotion = { id: this.id('promo'), name, code, type: input.type, value: input.value, validUntil: input.validUntil || undefined, active: input.active ?? true };
    this.state.promotions.push(p);
    return clone(p);
  }

  deletePromotion(id: string): void {
    this.state.promotions = this.state.promotions.filter((p) => p.id !== id);
  }

  applyPromo(cartId: string, code: string): Cart {
    const cart = this.openCart(cartId);
    const promo = this.activePromotions().find((p) => p.code === (code ?? '').trim().toUpperCase());
    if (!promo) throw new PosError('PROMO_INVALID', 'Código de promoción inválido o vencido');
    if (cart.lines.length === 0) throw new PosError('EMPTY_CART', 'Agrega productos antes de aplicar una promoción');
    const applied: AppliedPromo = { id: promo.id, name: promo.name, code: promo.code, type: promo.type, value: promo.value };
    cart.promotion = applied;
    this.recompute(cart);
    return clone(cart);
  }

  removePromo(cartId: string): Cart {
    const cart = this.openCart(cartId);
    delete cart.promotion;
    this.recompute(cart);
    return clone(cart);
  }

  // ---------- carrito ----------
  getCart(id: string): Cart {
    return clone(this.cartOf(id));
  }

  createCart(branchId: string, channel: Channel, customer?: Customer | null): Cart {
    if (!this.state.branches.some((b) => b.id === branchId)) throw new PosError('NOT_FOUND', 'Sucursal no existe');
    const cart: Cart = {
      id: this.id('cart'), branchId, channel, customer: customer ?? {}, lines: [],
      subtotalClp: 0, discountClp: 0, totalClp: 0, status: 'open',
    };
    this.state.carts[cart.id] = cart;
    return clone(cart);
  }

  /** Número que se muestra como "Pedido #N" en la caja. */
  nextOrderNumber(): number {
    return this.state.saleSeq + 1;
  }

  cartAdd(cartId: string, code: string, quantity?: number | null): Cart {
    const q = quantity ?? 1;
    const cart = this.openCart(cartId);
    const p = this.product(code);
    if (!p || !p.active || (cart.channel === 'online' && !p.published)) throw new PosError('NOT_FOUND', 'Producto no encontrado');
    if (!Number.isInteger(q) || q <= 0) throw new PosError('INVALID_QTY', 'Cantidad inválida');
    const cell = this.cell(cart.branchId, p.id, cart.channel);
    if (cell.qty - cell.reserved < q) throw new PosError('OUT_OF_STOCK', `Sin stock suficiente de ${p.name}`);
    cell.reserved += q;
    const line = cart.lines.find((l) => l.productId === p.id);
    if (line) line.quantity += q;
    else cart.lines.push({ productId: p.id, name: p.name, unitPriceClp: p.priceClp, costClp: p.costClp, category: p.category, quantity: q });
    this.recompute(cart);
    return clone(cart);
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
    if (cart.lines.length === 0) delete cart.promotion;
    this.recompute(cart);
    return clone(cart);
  }

  cartRemove(cartId: string, index: number): Cart {
    return this.cartSetQuantity(cartId, index, 0);
  }

  cartClear(cartId: string): Cart {
    const cart = this.openCart(cartId);
    this.releaseAll(cart);
    cart.lines = [];
    delete cart.promotion;
    this.recompute(cart);
    return clone(cart);
  }

  /** Asocia un cliente registrado (clientId) o datos escritos a mano. */
  setCustomer(cartId: string, customer: Customer): Cart {
    const cart = this.openCart(cartId);
    const next: Customer = { ...customer };
    if (next.clientId) {
      const c = this.state.clients.find((x) => x.id === next.clientId);
      if (!c) throw new PosError('NOT_FOUND', 'Cliente no existe');
      cart.customer = { clientId: c.id, name: c.name, rut: c.rut, email: c.email, phone: c.phone, isVip: c.isVip, creditAuthorized: !!c.creditAuthorized };
      return clone(cart);
    }
    if (next.rut) {
      if (!isValidRut(next.rut)) throw new PosError('INVALID_RUT', 'RUT inválido');
      next.rut = normalizeRut(next.rut);
    }
    cart.customer = next;
    return clone(cart);
  }

  // ---------- jornada ----------
  private openShiftRef(): Shift | undefined {
    return this.state.shifts.find((s) => s.status === 'open');
  }

  currentShift(): Shift | null {
    const s = this.openShiftRef();
    return s ? clone(s) : null;
  }

  private shiftSales(shiftId: string): Sale[] {
    return this.state.sales.filter((s) => s.shiftId === shiftId && s.status === 'completed');
  }

  private expectedFor(shift: Shift): Partial<Record<PayMethod, number>> {
    const expected: Partial<Record<PayMethod, number>> = {};
    for (const s of this.shiftSales(shift.id)) expected[s.method] = (expected[s.method] ?? 0) + s.totalClp;
    // Los abonos a convenio cobrados en esta jornada también entran por su forma de pago.
    for (const p of this.state.creditPayments ?? []) if (p.shiftId === shift.id) expected[p.method] = (expected[p.method] ?? 0) + p.amountClp;
    // El efectivo esperado = fondo inicial + efectivo recibido − vueltos (= total de ventas en efectivo).
    expected.cash = (expected.cash ?? 0) + shift.initialCashClp;
    return expected;
  }

  shiftInfo(): ShiftInfo | null {
    const shift = this.openShiftRef();
    if (!shift) return null;
    const sales = this.shiftSales(shift.id);
    return {
      shift: clone(shift),
      elapsedMs: this.now().getTime() - new Date(shift.openedAt).getTime(),
      salesCount: sales.length,
      salesTotalClp: sales.reduce((s, x) => s + x.totalClp, 0),
      expected: this.expectedFor(shift),
    };
  }

  openShift(cashierId: string, pin: string, initialCashClp: number): Shift {
    if (this.openShiftRef()) throw new PosError('SHIFT_OPEN', 'Ya hay una jornada abierta');
    const cashier = this.state.cashiers.find((c) => c.id === cashierId && c.active);
    if (!cashier) throw new PosError('NOT_FOUND', 'Cajero no existe');
    if (cashier.pin !== String(pin)) throw new PosError('BAD_PIN', 'PIN incorrecto');
    if (!Number.isInteger(initialCashClp) || initialCashClp < 0) throw new PosError('INVALID_AMOUNT', 'Efectivo inicial inválido');
    const shift: Shift = {
      id: this.id('shift'), cashierId, cashierName: cashier.name, terminal: this.terminal,
      openedAt: this.now().toISOString(), initialCashClp, status: 'open',
    };
    this.state.shifts.push(shift);
    return clone(shift);
  }

  /** Cierra la jornada con el monto contado por forma de pago y calcula las diferencias. */
  closeShift(counted: Partial<Record<PayMethod, number>>, notes?: string | null): Shift {
    const shift = this.openShiftRef();
    if (!shift) throw new PosError('NO_SHIFT', 'No hay jornada abierta');
    if (this.state.carts && Object.values(this.state.carts).some((c) => c.status === 'paying')) {
      throw new PosError('NOT_ALLOWED', 'Hay un cobro en curso: termínalo antes de cerrar la jornada');
    }
    const expected = this.expectedFor(shift);
    const countedClean: Partial<Record<PayMethod, number>> = {};
    const difference: Partial<Record<PayMethod, number>> = {};
    for (const m of PAY_METHODS) {
      const c = counted?.[m];
      if (c !== undefined && c !== null) {
        if (!Number.isInteger(c) || c < 0) throw new PosError('INVALID_AMOUNT', 'Monto contado inválido');
        countedClean[m] = c;
      }
      if (expected[m] !== undefined || countedClean[m] !== undefined) difference[m] = (countedClean[m] ?? 0) - (expected[m] ?? 0);
    }
    const sales = this.shiftSales(shift.id);
    Object.assign(shift, {
      status: 'closed', closedAt: this.now().toISOString(), notes: notes?.trim() || undefined,
      counted: countedClean, expected, difference, salesCount: sales.length, salesTotalClp: sales.reduce((s, x) => s + x.totalClp, 0),
    });
    return clone(shift);
  }

  listShifts(): Shift[] {
    return clone([...this.state.shifts].reverse());
  }

  // ---------- pagos ----------
  beginPayment(
    cartId: string, method: PayMethod, provider?: Provider | null, idempotencyKey?: string | null, receivedClp?: number | null,
  ): { payment: Payment; created: boolean } {
    if (idempotencyKey) {
      const existing = Object.values(this.state.payments).find((p) => p.idempotencyKey === idempotencyKey);
      if (existing) return { payment: clone(existing), created: false };
    }
    if (!PAY_METHODS.includes(method)) throw new PosError('METHOD_NOT_ALLOWED', 'Medio de pago no válido');
    const cart = this.openCart(cartId);
    if (cart.lines.length === 0) throw new PosError('EMPTY_CART', 'El carrito está vacío');
    if (cart.channel === 'online') {
      if (!cart.customer.name || !cart.customer.email) throw new PosError('CUSTOMER_REQUIRED', 'Faltan nombre y correo del cliente');
      if (!isTerminalMethod(method)) throw new PosError('METHOD_NOT_ALLOWED', 'La tienda online solo acepta tarjeta');
    } else if (!this.openShiftRef()) {
      throw new PosError('NO_SHIFT', 'Debe haber una jornada abierta para cobrar');
    }
    if (method === 'convenio') {
      // La autorización se valida en el motor con los datos actuales del cliente, no con lo que mande la pantalla.
      const client = cart.customer.clientId ? this.state.clients.find((c) => c.id === cart.customer.clientId) : undefined;
      if (!client || !client.name || !client.rut) throw new PosError('CUSTOMER_REQUIRED', 'El convenio requiere un cliente registrado con nombre y RUT');
      if (!client.creditAuthorized) throw new PosError('METHOD_NOT_ALLOWED', `${client.name} no está autorizado para pagar con convenio`);
    }
    if (this.foliosRemaining() === 0) throw new PosError('NO_FOLIOS', 'No quedan folios de boleta disponibles');

    let received: number | undefined;
    let change: number | undefined;
    if (method === 'cash') {
      received = receivedClp ?? cart.totalClp;
      if (!Number.isInteger(received) || received < cart.totalClp) throw new PosError('INVALID_AMOUNT', 'El monto recibido no alcanza para pagar');
      change = received - cart.totalClp;
    }
    const resolved: Provider = method === 'cash' ? 'cash' : !isTerminalMethod(method) ? 'manual'
      : provider && provider !== 'cash' && provider !== 'manual' ? provider : cart.channel === 'online' ? 'mercadopago' : 'transbank';
    const attempts = Object.values(this.state.payments).filter((p) => p.cartId === cartId).length;
    const payment: Payment = {
      id: this.id('pay'), cartId, method, provider: resolved, amountClp: cart.totalClp,
      receivedClp: received, changeClp: change, status: 'pending', idempotencyKey: idempotencyKey ?? `${cartId}:${method}:${attempts}`,
    };
    this.state.payments[payment.id] = payment;
    cart.status = 'paying';
    this.emit(payment.id, 'pending');
    return { payment: clone(payment), created: true };
  }

  getPayment(id: string): Payment {
    const p = this.state.payments[id];
    if (!p) throw new PosError('NOT_FOUND', 'Pago no existe');
    return clone(p);
  }

  /** Cierra el pago con el resultado del terminal. Idempotente: si ya no está pendiente, no hace nada. */
  resolvePayment(paymentId: string, outcome: { approved: boolean; authCode?: string; message?: string }): Payment {
    const payment = this.state.payments[paymentId];
    if (!payment) throw new PosError('NOT_FOUND', 'Pago no existe');
    if (payment.status !== 'pending') return clone(payment);
    const cart = this.state.carts[payment.cartId]!;

    if (!outcome.approved) {
      payment.status = 'rejected';
      payment.message = outcome.message ?? 'Pago rechazado';
      cart.status = 'open';
      this.emit(paymentId, 'rejected', payment.message);
      return clone(payment);
    }

    const iso = this.now().toISOString();
    const saleId = this.id('sale');
    const { netClp, ivaClp } = splitIva(cart.totalClp);
    const lines: CartLine[] = clone(cart.lines);
    for (const l of lines) {
      const cell = this.cell(cart.branchId, l.productId, cart.channel);
      cell.qty -= l.quantity;
      cell.reserved -= l.quantity;
      this.state.movements.push({
        id: this.id('mov'), branchId: cart.branchId, productId: l.productId, channel: cart.channel,
        delta: -l.quantity, reason: 'sale', refId: saleId, at: iso,
      });
    }

    const shift = cart.channel === 'physical' ? this.openShiftRef() : undefined;
    let documentId: string | null = null;
    if (this.state.nextFolio <= this.state.lastFolio) {
      const folio = this.state.nextFolio++;
      const doc: TaxDocument = {
        id: this.id('doc'), saleId, dteType: 39, folio, siiStatus: 'draft', issuedAt: iso,
        xml: buildBoletaXml({
          folio, date: santiagoDay(iso), emisor: this.emisor, receptor: cart.customer, lines,
          discountClp: cart.discountClp, totalClp: cart.totalClp,
        }),
      };
      this.state.documents.push(doc);
      documentId = doc.id;
    }

    const sale: Sale = {
      id: saleId, number: ++this.state.saleSeq, branchId: cart.branchId, channel: cart.channel, shiftId: shift?.id ?? null,
      cashierName: shift?.cashierName, customer: clone(cart.customer), lines, subtotalClp: cart.subtotalClp,
      discountClp: cart.discountClp, promotionCode: cart.promotion?.code, totalClp: cart.totalClp, netClp, ivaClp,
      method: payment.method, provider: payment.provider, authCode: outcome.authCode, receivedClp: payment.receivedClp,
      changeClp: payment.changeClp, status: 'completed', createdAt: iso, paidAt: iso, documentId,
    };
    this.state.sales.push(sale);
    payment.status = 'approved';
    payment.authCode = outcome.authCode;
    payment.saleId = saleId;
    cart.status = 'closed';
    this.emit(paymentId, 'approved', undefined, saleId);
    return clone(payment);
  }

  cancelPayment(paymentId: string): Payment {
    const payment = this.state.payments[paymentId];
    if (!payment) throw new PosError('NOT_FOUND', 'Pago no existe');
    if (payment.status === 'pending') {
      payment.status = 'cancelled';
      this.state.carts[payment.cartId]!.status = 'open';
      this.emit(paymentId, 'cancelled', 'Cobro cancelado');
    }
    return clone(payment);
  }

  // ---------- consumo propio ----------
  /**
   * Registra el contenido del carrito como consumo propio: descuenta el stock y lo valoriza al costo.
   * No es una venta: no hay cobro, boleta ni folio, y no suma ingresos ni utilidad.
   */
  registerConsumption(cartId: string, note?: string | null): Consumption {
    const cart = this.openCart(cartId);
    if (cart.lines.length === 0) throw new PosError('EMPTY_CART', 'El carrito está vacío');
    if (cart.channel !== 'physical') throw new PosError('NOT_ALLOWED', 'El consumo solo se registra en la caja');
    const shift = this.openShiftRef();
    if (!shift) throw new PosError('NO_SHIFT', 'Debe haber una jornada abierta para registrar un consumo');
    const iso = this.now().toISOString();
    const consumptions = this.state.consumptions!;
    const id = this.id('cons');
    const lines: CartLine[] = clone(cart.lines);
    for (const l of lines) {
      const cell = this.cell(cart.branchId, l.productId, cart.channel);
      cell.qty -= l.quantity;
      cell.reserved -= l.quantity;
      this.state.movements.push({
        id: this.id('mov'), branchId: cart.branchId, productId: l.productId, channel: cart.channel,
        delta: -l.quantity, reason: 'consumption', refId: id, at: iso,
      });
    }
    const consumption: Consumption = {
      id, number: consumptions.length + 1, branchId: cart.branchId, shiftId: shift.id, cashierName: shift.cashierName,
      who: cart.customer.name?.trim() || undefined, note: note?.trim() || undefined, lines,
      costClp: lines.reduce((n, l) => n + l.costClp * l.quantity, 0), status: 'active', createdAt: iso,
    };
    consumptions.push(consumption);
    cart.status = 'closed';
    return clone(consumption);
  }

  listConsumptions(filter: { from?: string; to?: string; branchId?: string; limit?: number } = {}): Consumption[] {
    const f = filter ?? {};
    return clone(
      [...(this.state.consumptions ?? [])]
        .filter((c) =>
          (!f.branchId || c.branchId === f.branchId) &&
          (!f.from || santiagoDay(c.createdAt) >= f.from) &&
          (!f.to || santiagoDay(c.createdAt) <= f.to))
        .reverse()
        .slice(0, f.limit ?? 100),
    );
  }

  /** Anula un consumo y devuelve las unidades al inventario. Deja de contar en el reporte. */
  voidConsumption(consumptionId: string, reason?: string | null): Consumption {
    const c = (this.state.consumptions ?? []).find((x) => x.id === consumptionId);
    if (!c) throw new PosError('NOT_FOUND', 'Consumo no existe');
    if (c.status === 'voided') throw new PosError('NOT_ALLOWED', 'El consumo ya está anulado');
    const iso = this.now().toISOString();
    for (const l of c.lines) {
      this.cell(c.branchId, l.productId, 'physical').qty += l.quantity;
      this.state.movements.push({
        id: this.id('mov'), branchId: c.branchId, productId: l.productId, channel: 'physical',
        delta: l.quantity, reason: 'return', refId: c.id, at: iso,
      });
    }
    c.status = 'voided';
    c.voidedAt = iso;
    c.voidReason = reason?.trim() || undefined;
    return clone(c);
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

  // ---------- ventas, historial, anulación ----------
  foliosRemaining(): number {
    return Math.max(0, this.state.lastFolio - this.state.nextFolio + 1);
  }

  currentFolio(): number {
    return this.state.nextFolio;
  }

  getSale(id: string): Sale & { document: TaxDocument | null } {
    const s = this.state.sales.find((x) => x.id === id);
    if (!s) throw new PosError('NOT_FOUND', 'Venta no existe');
    const document = this.state.documents.find((d) => d.id === s.documentId) ?? null;
    return clone({ ...s, document });
  }

  listSales(filter: SalesFilter = {}): (Sale & { folio: number | null })[] {
    const f = filter ?? {};
    const rows = this.state.sales
      .filter((s) =>
        (!f.branchId || s.branchId === f.branchId) &&
        (!f.shiftId || s.shiftId === f.shiftId) &&
        (!f.from || santiagoDay(s.paidAt) >= f.from) &&
        (!f.to || santiagoDay(s.paidAt) <= f.to))
      .slice(-(f.limit ?? 100))
      .reverse();
    return clone(rows.map((s) => ({ ...s, folio: this.state.documents.find((d) => d.id === s.documentId)?.folio ?? null })));
  }

  /**
   * Anula una venta y devuelve el stock. En la realidad, una boleta emitida se anula con una
   * nota de crédito electrónica (DTE 61); aquí queda marcada para emitirla con el certificador.
   */
  voidSale(saleId: string, reason?: string | null): Sale {
    const sale = this.state.sales.find((s) => s.id === saleId);
    if (!sale) throw new PosError('NOT_FOUND', 'Venta no existe');
    if (sale.status === 'voided') throw new PosError('NOT_ALLOWED', 'La venta ya está anulada');
    const iso = this.now().toISOString();
    for (const l of sale.lines) {
      this.cell(sale.branchId, l.productId, sale.channel).qty += l.quantity;
      this.state.movements.push({
        id: this.id('mov'), branchId: sale.branchId, productId: l.productId, channel: sale.channel,
        delta: l.quantity, reason: 'return', refId: sale.id, at: iso,
      });
    }
    sale.status = 'voided';
    sale.voidedAt = iso;
    sale.voidReason = reason?.trim() || undefined;
    return clone(sale);
  }

  // ---------- pedidos abiertos ----------
  listTickets(): Ticket[] {
    return clone(this.state.tickets.filter((t) => t.status === 'open').reverse());
  }

  private newTicket(base: Omit<Ticket, 'id' | 'number' | 'status' | 'createdAt'>): Ticket {
    const customerName = base.customerName?.trim();
    if (!customerName) throw new PosError('CUSTOMER_REQUIRED', 'El nombre del cliente es obligatorio');
    const t: Ticket = {
      ...base, customerName, id: this.id('ticket'), number: ++this.state.ticketSeq, status: 'open', createdAt: this.now().toISOString(),
    };
    this.state.tickets.push(t);
    return t;
  }

  /** Deja el pedido abierto (pendiente de pago): retiene el carrito y su stock. */
  holdCart(
    cartId: string,
    data: { customerName: string; phone?: string; email?: string; channel: TicketChannel; note?: string },
  ): Ticket {
    const cart = this.openCart(cartId);
    if (cart.lines.length === 0) throw new PosError('EMPTY_CART', 'El carrito está vacío');
    const t = this.newTicket({
      cartId, customerName: data.customerName, phone: data.phone?.trim() || undefined, email: data.email?.trim() || undefined,
      channel: data.channel, note: data.note?.trim() || undefined, paid: false, lines: clone(cart.lines), totalClp: cart.totalClp,
    });
    cart.status = 'held';
    cart.customer = { ...cart.customer, name: t.customerName, phone: t.phone, email: t.email };
    return clone(t);
  }

  /** Registra un pedido que ya se pagó (la venta existe) para entregarlo después. */
  createPaidTicket(
    saleId: string,
    data: { customerName: string; phone?: string; email?: string; channel: TicketChannel; note?: string },
  ): Ticket {
    const sale = this.state.sales.find((s) => s.id === saleId);
    if (!sale) throw new PosError('NOT_FOUND', 'Venta no existe');
    const t = this.newTicket({
      cartId: null, saleId, customerName: data.customerName, phone: data.phone?.trim() || undefined, email: data.email?.trim() || undefined,
      channel: data.channel, note: data.note?.trim() || undefined, paid: true, lines: clone(sale.lines), totalClp: sale.totalClp,
    });
    return clone(t);
  }

  /** Retoma un pedido pendiente de pago: devuelve el carrito abierto para cobrarlo. */
  resumeTicket(ticketId: string): Cart {
    const t = this.state.tickets.find((x) => x.id === ticketId);
    if (!t || t.status !== 'open') throw new PosError('NOT_FOUND', 'Pedido no existe');
    if (t.paid || !t.cartId) throw new PosError('NOT_ALLOWED', 'El pedido ya está pagado');
    const cart = this.cartOf(t.cartId);
    cart.status = 'open';
    t.status = 'done';
    return clone(cart);
  }

  /** Marca como entregado un pedido pagado. */
  completeTicket(ticketId: string): Ticket {
    const t = this.state.tickets.find((x) => x.id === ticketId);
    if (!t) throw new PosError('NOT_FOUND', 'Pedido no existe');
    t.status = 'done';
    return clone(t);
  }

  /** Cancela un pedido pendiente: libera el stock reservado. */
  cancelTicket(ticketId: string): void {
    const t = this.state.tickets.find((x) => x.id === ticketId);
    if (!t || t.status !== 'open') throw new PosError('NOT_FOUND', 'Pedido no existe');
    if (!t.paid && t.cartId) {
      const cart = this.cartOf(t.cartId);
      this.releaseAll(cart);
      cart.status = 'closed';
    }
    t.status = 'done';
  }

  // ---------- reportes ----------
  salesReport(from: string, to: string, branchId?: string | null): SalesReport {
    return buildSalesReport(
      this.state.sales.filter((s) => !branchId || s.branchId === branchId), (id) => this.state.documents.find((d) => d.id === id)?.folio ?? null, from, to,
      (this.state.consumptions ?? []).filter((c) => !branchId || c.branchId === branchId),
    );
  }

  // ---------- persistencia ----------
  snapshot(): EngineState {
    return clone(this.state);
  }
}
