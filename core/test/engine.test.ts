import { describe, expect, it } from 'vitest';
import {
  PosEngine, PosError, SimulatedGateway, payCart, seedState, splitIva, addIva, isValidRut, normalizeRut,
  emptyState, RPC_METHODS, normalizePhone, whatsappUrl, whatsappMessage, formatClp,
} from '../src';

const B = 'branch_1';
const fast = () => new SimulatedGateway({ delayMs: 0 });
const COLA = 'prod_1'; // $1.990
const AGUA = 'prod_2'; // $990

/** Motor con jornada abierta (como en una caja operando). */
function make(o: Parameters<typeof seedState>[0] = {}, opts: ConstructorParameters<typeof PosEngine>[1] = {}, shift = true) {
  const e = new PosEngine(seedState(o), opts);
  if (shift) e.openShift('cashier_1', '1234', 10_000);
  return e;
}

describe('IVA y RUT', () => {
  it('formatea pesos, también los negativos', () => {
    expect(formatClp(1990)).toBe('$1.990');
    expect(formatClp(-473)).toBe('-$473');
    expect(formatClp(0)).toBe('$0');
  });
  it('separa neto e IVA con total exacto', () => {
    for (const t of [100, 1990, 8990, 119, 1]) {
      const { netClp, ivaClp } = splitIva(t);
      expect(netClp + ivaClp).toBe(t);
    }
    expect(splitIva(1190)).toEqual({ netClp: 1000, ivaClp: 190 });
  });
  it('valida RUT con módulo 11', () => {
    expect(isValidRut('11.111.111-1')).toBe(true);
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('12.345.678-9')).toBe(false);
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5');
  });
});

describe('inventario y reservas', () => {
  it('reserva al agregar y libera al limpiar', () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 3);
    expect(e.available(B, COLA, 'physical')).toBe(37);
    e.cartClear(c.id);
    expect(e.available(B, COLA, 'physical')).toBe(40);
  });
  it('actualiza cantidades y rechaza pasarse del stock', () => {
    const e = make({ physical: 5 });
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2);
    e.cartSetQuantity(c.id, 0, 5);
    expect(() => e.cartSetQuantity(c.id, 0, 6)).toThrow(PosError);
    e.cartSetQuantity(c.id, 0, 0);
    expect(e.getCart(c.id).lines).toHaveLength(0);
    expect(e.available(B, COLA, 'physical')).toBe(5);
  });
  it('el stock físico y el online son independientes', () => {
    const e = make({ physical: 3, online: 1 });
    const online = e.createCart(B, 'online');
    e.cartAdd(online.id, COLA, 1);
    expect(() => e.cartAdd(online.id, COLA, 1)).toThrow(/Sin stock/);
    expect(e.available(B, COLA, 'physical')).toBe(3);
  });
  it('la tienda online no vende productos no publicados ni inactivos', () => {
    const e = make();
    const c = e.createCart(B, 'online');
    expect(() => e.cartAdd(c.id, 'prod_24', 1)).toThrow(PosError);
    e.upsertProduct({ id: COLA, name: 'Bebida cola 1,5 L', priceClp: 1990, active: false });
    expect(() => e.cartAdd(c.id, COLA, 1)).toThrow(PosError);
    expect(e.catalog(B, 'physical').some((p) => p.id === COLA)).toBe(false);
  });
  it('un producto nuevo nace con 0 unidades y no hereda el stock de uno existente', () => {
    const e = make();
    const nuevo = e.upsertProduct({ name: 'Producto nuevo', priceClp: 1000 });
    expect(e.listProducts().filter((p) => p.id === nuevo.id)).toHaveLength(1);
    expect(e.available(B, nuevo.id, 'physical')).toBe(0);
    expect(e.available(B, nuevo.id, 'online')).toBe(0);
    e.adjustStock(B, nuevo.id, 'physical', 7);
    expect(e.available(B, nuevo.id, 'physical')).toBe(7);
    expect(e.available(B, COLA, 'physical')).toBe(40);
    expect(e.available(B, AGUA, 'physical')).toBe(40);
  });
  it('mueve stock entre canales sin perder unidades', () => {
    const e = make({ physical: 10, online: 0 });
    e.moveStock(B, COLA, 'physical', 'online', 4);
    expect(e.available(B, COLA, 'physical')).toBe(6);
    expect(e.available(B, COLA, 'online')).toBe(4);
  });
});

describe('concurrencia', () => {
  it('50 carritos compiten por 5 unidades: exactamente 5 ganan', async () => {
    const e = make({ physical: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, async () => {
        const c = e.createCart(B, 'physical');
        e.cartAdd(c.id, COLA, 1);
        await Promise.resolve();
        return c.id;
      }),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(e.available(B, COLA, 'physical')).toBe(0);
  });

  it('pagos simultáneos: stock nunca negativo y números de venta únicos y consecutivos', async () => {
    const e = make({ physical: 5 });
    const g = fast();
    const carts = Array.from({ length: 5 }, () => {
      const c = e.createCart(B, 'physical');
      e.cartAdd(c.id, COLA, 1);
      return c.id;
    });
    const paid = await Promise.all(carts.map((id) => payCart(e, g, { cartId: id, method: 'debit' })));
    expect(paid.every((p) => p.status === 'approved')).toBe(true);
    const snap = e.snapshot();
    expect(snap.stock[`${B}:${COLA}:physical`]).toEqual({ qty: 0, reserved: 0 });
    expect(snap.sales.map((s) => s.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('online y caja no pueden vender la misma unidad', async () => {
    const e = make({ physical: 1, online: 1 });
    e.moveStock(B, COLA, 'online', 'physical', 1);
    const caja = e.createCart(B, 'physical');
    const web = e.createCart(B, 'online', { name: 'Ana', email: 'a@b.cl' });
    e.cartAdd(caja.id, COLA, 2);
    expect(() => e.cartAdd(web.id, COLA, 1)).toThrow(PosError);
    const p = await payCart(e, fast(), { cartId: caja.id, method: 'cash' });
    expect(p.status).toBe('approved');
    expect(e.snapshot().sales).toHaveLength(1);
  });

  it('misma clave de idempotencia: un solo cobro y una sola venta', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    const g = fast();
    const [a, b] = await Promise.all([
      payCart(e, g, { cartId: c.id, method: 'credit', idempotencyKey: 'k1' }),
      payCart(e, g, { cartId: c.id, method: 'credit', idempotencyKey: 'k1' }),
    ]);
    expect(a.id).toBe(b.id);
    expect(e.snapshot().sales).toHaveLength(1);
  });
});

describe('pagos', () => {
  it('pago aprobado descuenta stock y registra la venta', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2);
    const p = await payCart(e, fast(), { cartId: c.id, method: 'debit' });
    expect(p.status).toBe('approved');
    expect(p.provider).toBe('transbank');
    const sale = e.getSale(p.saleId!);
    expect(sale).toMatchObject({ totalClp: 3980, number: 1, status: 'completed', cashierName: 'Cajero 1' });
    expect(sale.netClp + sale.ivaClp).toBe(3980);
    expect(e.available(B, COLA, 'physical')).toBe(38);
  });
  it('efectivo calcula el vuelto y exige monto suficiente', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    expect(() => e.beginPayment(c.id, 'cash', null, null, 1000)).toThrow(/no alcanza/);
    const p = await payCart(e, fast(), { cartId: c.id, method: 'cash', receivedClp: 5000 });
    expect(e.getSale(p.saleId!)).toMatchObject({ receivedClp: 5000, changeClp: 3010, provider: 'cash' });
  });
  it('cheque, transferencia y convenio se confirman sin terminal', async () => {
    const e = make();
    for (const m of ['cheque', 'transfer', 'convenio'] as const) {
      const c = e.createCart(B, 'physical');
      e.cartAdd(c.id, AGUA, 1);
      e.setCustomer(c.id, { clientId: 'cli_seed_1' }); // convenio exige un cliente autorizado
      const p = await payCart(e, fast(), { cartId: c.id, method: m });
      expect(p).toMatchObject({ status: 'approved', provider: 'manual' });
    }
  });
  it('pago rechazado mantiene el carrito y se puede reintentar con el mismo medio', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    const p1 = await payCart(e, new SimulatedGateway({ delayMs: 0, rejectWhen: () => true }), { cartId: c.id, method: 'credit' });
    expect(p1.status).toBe('rejected');
    expect(e.getCart(c.id).status).toBe('open');
    expect(e.available(B, COLA, 'physical')).toBe(39);
    const p2 = await payCart(e, fast(), { cartId: c.id, method: 'credit' });
    expect(p2.status).toBe('approved');
    expect(p2.id).not.toBe(p1.id);
  });
  it('cancelar libera el carrito y un resultado tardío no genera venta', () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    const { payment } = e.beginPayment(c.id, 'debit');
    e.cancelPayment(payment.id);
    e.resolvePayment(payment.id, { approved: true, authCode: 'LATE' });
    expect(e.snapshot().sales).toHaveLength(0);
    expect(e.getCart(c.id).status).toBe('open');
  });
  it('la tienda online exige cliente y solo acepta tarjeta', () => {
    const e = make({}, {}, false);
    const c = e.createCart(B, 'online');
    e.cartAdd(c.id, COLA, 1);
    expect(() => e.beginPayment(c.id, 'credit')).toThrow(/cliente/);
    e.setCustomer(c.id, { name: 'Ana', email: 'ana@mail.cl', rut: '11.111.111-1' });
    expect(() => e.beginPayment(c.id, 'cash')).toThrow(/tarjeta/);
    expect(e.beginPayment(c.id, 'credit').payment.provider).toBe('mercadopago');
  });
  it('rechaza RUT inválido', () => {
    const e = make();
    const c = e.createCart(B, 'online');
    expect(() => e.setCustomer(c.id, { rut: '12.345.678-9' })).toThrow(/RUT/);
  });
  it('emite eventos de pago reproducibles', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    const p = await payCart(e, fast(), { cartId: c.id, method: 'cash' });
    const seen: string[] = [];
    e.onPaymentEvent(p.id, (ev) => seen.push(ev.type));
    expect(seen).toEqual(['pending', 'terminal_waiting', 'approved']);
  });
});

describe('jornada (turno de caja)', () => {
  it('no se puede cobrar sin jornada abierta, pero sí en la tienda online', () => {
    const e = make({}, {}, false);
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    expect(() => e.beginPayment(c.id, 'cash')).toThrow(/jornada/);
  });
  it('valida PIN y no permite dos jornadas', () => {
    const e = make({}, {}, false);
    expect(() => e.openShift('cashier_1', '0000', 0)).toThrow(/PIN/);
    e.openShift('cashier_1', '1234', 5000);
    expect(() => e.openShift('cashier_1', '1234', 0)).toThrow(/abierta/);
  });
  it('el cierre calcula esperado y diferencia por forma de pago', async () => {
    let now = new Date('2026-10-19T12:00:00Z');
    const e = make({}, { now: () => now });
    const g = fast();
    now = new Date('2026-10-19T14:30:00Z');
    const a = e.createCart(B, 'physical'); e.cartAdd(a.id, COLA, 1);
    await payCart(e, g, { cartId: a.id, method: 'cash', receivedClp: 2000 });
    const b = e.createCart(B, 'physical'); e.cartAdd(b.id, AGUA, 1); e.setCustomer(b.id, { clientId: 'cli_seed_1' });
    await payCart(e, g, { cartId: b.id, method: 'convenio' });
    const info = e.shiftInfo()!;
    expect(info).toMatchObject({ salesCount: 2, salesTotalClp: 2980 });
    expect(info.elapsedMs).toBe(2.5 * 3600_000);
    expect(info.expected).toEqual({ cash: 10_000 + 1990, convenio: 990 });
    const closed = e.closeShift({ cash: 11_900, convenio: 990 }, '  falta un billete ');
    expect(closed).toMatchObject({ status: 'closed', notes: 'falta un billete', salesCount: 2 });
    expect(closed.difference).toEqual({ cash: -90, convenio: 0 });
    expect(e.currentShift()).toBeNull();
  });
});

describe('convenio (venta a crédito)', () => {
  const MARIA = 'cli_seed_1'; // autorizada
  const JUAN = 'cli_seed_2'; // sin convenio
  const sellOnCredit = async (e: PosEngine, clientId: string | undefined, productId = COLA) => {
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, productId, 1);
    if (clientId) e.setCustomer(c.id, { clientId });
    return payCart(e, fast(), { cartId: c.id, method: 'convenio' });
  };

  it('no permite convenio sin cliente, con cliente escrito a mano o no autorizado', async () => {
    const e = make();
    await expect(sellOnCredit(e, undefined)).rejects.toThrow(/cliente registrado/);
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    e.setCustomer(c.id, { name: 'Pedro', rut: '11.111.111-1' });
    expect(() => e.beginPayment(c.id, 'convenio')).toThrow(/cliente registrado/);
    await expect(sellOnCredit(e, JUAN)).rejects.toThrow(/no está autorizado/);
    expect(e.listSales()).toHaveLength(0);
  });

  it('exige RUT para autorizar convenio', () => {
    const e = make();
    expect(() => e.upsertClient({ name: 'Sin RUT', creditAuthorized: true })).toThrow(/RUT/);
    expect(e.upsertClient({ name: 'Con RUT', rut: '33.333.333-3', creditAuthorized: true }).creditAuthorized).toBe(true);
  });

  it('acumula la deuda y la muestra al buscar al cliente', async () => {
    const e = make();
    await sellOnCredit(e, MARIA, COLA);
    await sellOnCredit(e, MARIA, AGUA);
    expect(e.clientBalance(MARIA)).toMatchObject({ debtClp: 1990 + 990, creditSalesClp: 2980, paidClp: 0 });
    expect(e.searchClients('maria')[0]).toMatchObject({ id: MARIA, debtClp: 2980 });
    expect(e.searchClients('juan')[0]).toMatchObject({ id: JUAN, debtClp: 0 });
  });

  it('el balance trae el detalle de lo comprado para imprimir el estado de cuenta', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2); e.cartAdd(c.id, AGUA, 1);
    e.setCustomer(c.id, { clientId: MARIA });
    await payCart(e, fast(), { cartId: c.id, method: 'convenio' });
    await sellOnCredit(e, MARIA, AGUA);
    const b = e.clientBalance(MARIA);
    expect(b).toMatchObject({ clientName: 'María Pérez', clientRut: '12345678-5', debtClp: 2 * 1990 + 990 + 990 });
    expect(b.sales).toHaveLength(2);
    expect(b.sales[1]!.lines.map((l) => [l.quantity, l.name, l.unitPriceClp])).toEqual([[2, 'Bebida cola 1,5 L', 1990], [1, 'Agua mineral 1,5 L', 990]]);
    expect(b.sales[1]).toMatchObject({ subtotalClp: 4970, discountClp: 0, totalClp: 4970 });
  });

  it('permite abonar o pagar todo, y rechaza pasarse de la deuda', async () => {
    const e = make();
    await sellOnCredit(e, MARIA, COLA);
    expect(e.payClientDebt(MARIA, 500, 'cash').debtClp).toBe(1490);
    expect(() => e.payClientDebt(MARIA, 2000, 'cash')).toThrow(/supera la deuda/);
    expect(() => e.payClientDebt(MARIA, 100, 'convenio')).toThrow(PosError);
    expect(() => e.payClientDebt(MARIA, 0, 'cash')).toThrow(PosError);
    expect(e.payClientDebt(MARIA, 1490, 'transfer')).toMatchObject({ debtClp: 0, paidClp: 1990 });
    expect(() => e.payClientDebt(MARIA, 100, 'cash')).toThrow(/no tiene deuda/);
  });

  it('el abono necesita jornada abierta y entra al arqueo por su forma de pago', async () => {
    const e = make();
    await sellOnCredit(e, MARIA, COLA);
    e.payClientDebt(MARIA, 1000, 'cash');
    e.payClientDebt(MARIA, 500, 'transfer');
    expect(e.shiftInfo()!.expected).toEqual({ cash: 10_000 + 1000, convenio: 1990, transfer: 500 });
    e.closeShift({ cash: 11_000, convenio: 1990, transfer: 500 });
    expect(() => e.payClientDebt(MARIA, 100, 'cash')).toThrow(/jornada abierta/);
  });

  it('anular una venta a convenio baja la deuda, y no se borra a un cliente que debe', async () => {
    const e = make();
    const p = await sellOnCredit(e, MARIA, COLA);
    expect(() => e.deleteClient(MARIA)).toThrow(/deuda pendiente/);
    e.voidSale(p.saleId!);
    expect(e.clientBalance(MARIA).debtClp).toBe(0);
    e.deleteClient(MARIA);
  });

  it('una base guardada antes de esta función sigue funcionando', async () => {
    const old = seedState();
    delete (old as { creditPayments?: unknown }).creditPayments;
    const e = new PosEngine(old);
    e.openShift('cashier_1', '1234', 0);
    await sellOnCredit(e, MARIA);
    expect(e.payClientDebt(MARIA, 1990, 'cash').debtClp).toBe(0);
  });
});

describe('compras a proveedores', () => {
  const NOW = () => new Date('2026-10-20T15:00:00Z');
  const base = { branchId: B, supplierName: 'Distribuidora Sur', supplierRut: '11.111.111-1', docNumber: '4521', docDate: '2026-10-10' };
  const mk = (o: Parameters<typeof seedState>[0] = { physical: 10, online: 0 }) => make(o, { now: NOW });

  it('ingresa las unidades como compra, crea el producto nuevo y calcula neto, IVA y costo promedio', () => {
    const e = mk();
    const p = e.registerPurchase({
      ...base,
      lines: [
        { productId: COLA, quantity: 20, unitCostClp: 1000 },
        { newProduct: { name: 'Té en bolsas', category: 'Despensa', priceClp: 2500 }, quantity: 12, unitCostClp: 1500 },
      ],
    });
    expect(p).toMatchObject({ number: 1, docType: 'factura', supplierRut: '11111111-1', netClp: 38_000, ivaClp: 7_220, totalClp: 45_220, status: 'active' });
    expect(e.available(B, COLA, 'physical')).toBe(30);
    const te = e.listProducts().find((x) => x.name === 'Té en bolsas')!;
    expect(te).toMatchObject({ category: 'Despensa', priceClp: 2500, costClp: 1500 });
    expect(e.available(B, te.id, 'physical')).toBe(12);
    expect(e.available(B, te.id, 'online')).toBe(0);
    // (10 × 1.294 + 20 × 1.000) / 30 = 1.098
    expect(e.listProducts().find((x) => x.id === COLA)!.costClp).toBe(1098);
    expect(e.movements(COLA, 1)[0]).toMatchObject({ delta: 20, reason: 'purchase', refId: p.id });
  });

  it('la tarjeta de existencia muestra la compra con su documento, proveedor y la fecha de la factura', async () => {
    const e = mk();
    const s = e.createCart(B, 'physical'); e.cartAdd(s.id, COLA, 3);
    await payCart(e, fast(), { cartId: s.id, method: 'cash', receivedClp: 6000 });
    e.registerPurchase({ ...base, lines: [{ productId: COLA, quantity: 20, unitCostClp: 1000 }] });
    const card = e.stockCard(B, COLA, 'physical');
    expect(card.openingQty).toBe(10);
    // la compra tiene fecha anterior a la venta, así que va antes aunque se registró después
    expect(card.rows.map((r) => [r.detail, r.entry, r.exit, r.balance])).toEqual([
      ['Venta N° 1', 0, 3, 27],
      ['Compra · Factura N° 4521 · Distribuidora Sur', 20, 0, 30],
    ]);
    expect(card.rows[1]).toMatchObject({ at: '2026-10-10T15:00:00.000Z', dateOnly: true, type: 'purchase' });
    expect(card).toMatchObject({ closingQty: 27, currentQty: 27 });
    expect(e.stockCard(B, COLA, 'physical', '2026-10-10', '2026-10-10').rows).toHaveLength(1);
  });

  it('una compra con fecha de hoy usa la hora real', () => {
    const e = mk();
    e.registerPurchase({ ...base, docDate: '2026-10-20', lines: [{ productId: COLA, quantity: 1, unitCostClp: 1000 }] });
    expect(e.movements(COLA, 1)[0]!.at).toBe('2026-10-20T15:00:00.000Z');
    expect(e.stockCard(B, COLA, 'physical').rows[0]!.detail).toContain('Factura N° 4521');
  });

  it('con updateCost en falso no cambia el costo del producto', () => {
    const e = mk();
    e.registerPurchase({ ...base, updateCost: false, lines: [{ productId: COLA, quantity: 20, unitCostClp: 1000 }] });
    expect(e.listProducts().find((x) => x.id === COLA)!.costClp).toBe(Math.round(1990 * 0.65));
  });

  it('valida todo antes de modificar: un error en una línea no deja nada a medias', () => {
    const e = mk();
    const products = e.listProducts().length;
    const buy = (over: object) => () => e.registerPurchase({ ...base, lines: [{ productId: COLA, quantity: 5, unitCostClp: 1000 }], ...over });
    expect(buy({ supplierName: '  ' })).toThrow(/proveedor/);
    expect(buy({ supplierRut: '11.111.111-9' })).toThrow(/RUT/);
    expect(buy({ docNumber: ' ' })).toThrow(/número/);
    expect(buy({ docDate: '2026-13-45' })).toThrow(/Fecha/);
    expect(buy({ docDate: '2026-10-21' })).toThrow(/futura/);
    expect(buy({ lines: [] })).toThrow(/al menos un producto/);
    expect(buy({ lines: [{ productId: COLA, quantity: 0, unitCostClp: 1000 }] })).toThrow(/cantidad/);
    expect(buy({ lines: [{ productId: COLA, quantity: 1, unitCostClp: 10.5 }] })).toThrow(/costo/);
    expect(buy({ lines: [{ productId: 'nope', quantity: 1, unitCostClp: 1 }] })).toThrow(/no existe/);
    expect(buy({ lines: [{ productId: COLA, newProduct: { name: 'x', priceClp: 1 }, quantity: 1, unitCostClp: 1 }] })).toThrow(/existente o crea/);
    expect(buy({ lines: [{ productId: COLA, quantity: 5, unitCostClp: 1000 }, { newProduct: { name: ' ', priceClp: 1 }, quantity: 1, unitCostClp: 1 }] })).toThrow(/nombre/);
    expect(buy({ lines: [{ newProduct: { name: 'A', priceClp: 1, barcode: '999' }, quantity: 1, unitCostClp: 1 }, { newProduct: { name: 'B', priceClp: 1, barcode: '999' }, quantity: 1, unitCostClp: 1 }] })).toThrow(/código de barras/);
    expect(e.available(B, COLA, 'physical')).toBe(10);
    expect(e.listProducts()).toHaveLength(products);
    expect(e.listPurchases()).toHaveLength(0);
  });

  it('no deja registrar dos veces el mismo documento del mismo proveedor', () => {
    const e = mk();
    const lines = [{ productId: COLA, quantity: 1, unitCostClp: 1000 }];
    const first = e.registerPurchase({ ...base, lines });
    expect(() => e.registerPurchase({ ...base, supplierName: 'Otro nombre', lines })).toThrow(/Ya registraste factura N° 4521/);
    e.registerPurchase({ ...base, supplierRut: '22.222.222-2', supplierName: 'Otro proveedor', lines });
    e.registerPurchase({ ...base, docType: 'boleta', lines });
    e.voidPurchase(first.id);
    expect(e.registerPurchase({ ...base, lines }).number).toBe(4);
  });

  it('anular saca las unidades y queda en la tarjeta, pero no si ya salieron', async () => {
    const e = mk();
    const p = e.registerPurchase({ ...base, lines: [{ productId: COLA, quantity: 20, unitCostClp: 1000 }] });
    e.voidPurchase(p.id, '  factura equivocada ');
    expect(e.available(B, COLA, 'physical')).toBe(10);
    expect(e.listPurchases()[0]).toMatchObject({ status: 'voided', voidReason: 'factura equivocada' });
    expect(e.stockCard(B, COLA, 'physical').rows[0]).toMatchObject({ detail: 'Anulación de compra · Factura N° 4521', exit: 20, balance: 10 });
    expect(() => e.voidPurchase(p.id)).toThrow(/ya está anulada/);
    expect(() => e.voidPurchase('nope')).toThrow(PosError);

    const q = e.registerPurchase({ ...base, docNumber: '9', lines: [{ productId: COLA, quantity: 5, unitCostClp: 1000 }] });
    const s = e.createCart(B, 'physical'); e.cartAdd(s.id, COLA, 13);
    await payCart(e, fast(), { cartId: s.id, method: 'cash', receivedClp: 30_000 });
    expect(() => e.voidPurchase(q.id)).toThrow(/solo quedan 2/);
    expect(e.available(B, COLA, 'physical')).toBe(2);
  });

  it('lista por fecha del documento y recuerda los proveedores', () => {
    const e = mk();
    const lines = [{ productId: COLA, quantity: 1, unitCostClp: 1000 }];
    e.registerPurchase({ ...base, docNumber: '1', docDate: '2026-10-01', lines });
    e.registerPurchase({ ...base, docNumber: '2', docDate: '2026-10-15', lines });
    e.registerPurchase({ ...base, supplierName: 'Sin RUT Ltda', supplierRut: undefined, docNumber: '3', docDate: '2026-10-08', lines });
    expect(e.listPurchases().map((x) => x.docNumber)).toEqual(['2', '3', '1']);
    expect(e.listPurchases({ from: '2026-10-05', to: '2026-10-10' }).map((x) => x.docNumber)).toEqual(['3']);
    expect(e.listSuppliers()).toEqual([{ name: 'Sin RUT Ltda', rut: undefined }, { name: 'Distribuidora Sur', rut: '11111111-1' }]);
  });

  it('una base guardada antes de esta función sigue funcionando', () => {
    const old = seedState();
    delete (old as { purchases?: unknown }).purchases;
    const e = new PosEngine(old, { now: NOW });
    expect(e.listPurchases()).toEqual([]);
    expect(e.registerPurchase({ ...base, lines: [{ productId: COLA, quantity: 1, unitCostClp: 1 }] }).number).toBe(1);
  });
});

describe('precios y valores en la tarjeta de existencia', () => {
  const NOW = () => new Date('2026-10-20T15:00:00Z');
  const base = { branchId: B, supplierName: 'Distribuidora Sur', docDate: '2026-10-20' };
  const mk = () => make({ physical: 10, online: 0 }, { now: NOW });
  const sell = async (e: PosEngine, productId: string, qty: number, received: number) => {
    const c = e.createCart(B, 'physical'); e.cartAdd(c.id, productId, qty);
    return payCart(e, fast(), { cartId: c.id, method: 'cash', receivedClp: received });
  };

  it('addIva es el inverso de splitIva', () => {
    expect(addIva(1000)).toBe(1190);
    expect(addIva(1672)).toBe(1990);
    for (const net of [0, 1, 840, 1672, 99_999]) expect(splitIva(addIva(net)).netClp).toBe(net);
  });

  it('al comprar se digita el precio neto nuevo y el sistema calcula el valor con IVA', () => {
    const e = mk();
    e.registerPurchase({
      ...base, docNumber: '1',
      lines: [
        { productId: COLA, quantity: 5, unitCostClp: 1000, priceNetClp: 1800 },
        { productId: AGUA, quantity: 5, unitCostClp: 500 },
        { newProduct: { name: 'Té' }, quantity: 3, unitCostClp: 1500, priceNetClp: 2000 },
      ],
    });
    const price = (id: string) => e.listProducts().find((x) => x.id === id)!.priceClp;
    expect(price(COLA)).toBe(2142); // 1.800 + IVA
    expect(price(AGUA)).toBe(990); // sin precio nuevo, no cambia
    expect(e.listProducts().find((x) => x.name === 'Té')!.priceClp).toBe(2380);
    expect(e.listPurchases()[0]!.lines.map((l) => [l.priceNetClp, l.priceClp])).toEqual([[1800, 2142], [832, 990], [2000, 2380]]);
    const buy = (over: object) => () => e.registerPurchase({ ...base, docNumber: '2', lines: [{ productId: COLA, quantity: 1, unitCostClp: 1 }], ...over });
    expect(buy({ lines: [{ productId: COLA, quantity: 1, unitCostClp: 1, priceNetClp: -5 }] })).toThrow(/precio de venta neto/);
    expect(buy({ lines: [{ productId: COLA, quantity: 1, unitCostClp: 1, priceNetClp: 10.5 }] })).toThrow(/precio de venta neto/);
    expect(buy({ lines: [{ newProduct: { name: 'Sin precio' }, quantity: 1, unitCostClp: 1 }] })).toThrow(/precio de venta neto del producto nuevo/);
  });

  it('con la inflación, cada movimiento guarda su precio, y entradas y salidas se valoran al costo', async () => {
    const e = mk();
    await sell(e, COLA, 2, 6000); // precio $1.990 (neto $1.672), costo $1.294
    e.registerPurchase({ ...base, docNumber: '1', lines: [{ productId: COLA, quantity: 20, unitCostClp: 1000, priceNetClp: 1800 }] });
    await sell(e, COLA, 1, 3000); // ahora $2.142 (neto $1.800)
    const card = e.stockCard(B, COLA, 'physical');
    const pick = (r: (typeof card.rows)[number]) => [r.detail.split(' ')[0], r.unitCostClp, r.unitPriceNetClp, r.unitPriceClp, r.entryValueClp, r.exitValueClp];
    // el precio de venta de cada momento queda anotado (inflación), pero los valores son siempre al costo:
    // la 1.ª boleta saca 2 al costo de $1.294; la compra mete 20 a $1.000; la 2.ª saca 1 al promedio (10.352 + 20.000) ÷ 28 = $1.084
    expect(card.rows.map(pick)).toEqual([
      ['Venta', 1084, 1800, 2142, undefined, 1084],
      ['Compra', 1000, 1800, 2142, 20_000, undefined],
      ['Venta', 1294, 1672, 1990, undefined, 2588],
    ]);
    expect(card).toMatchObject({ entryValueClp: 20_000, exitValueClp: 3672, entries: 20, exits: 3 });
    expect(e.stockCard(B, COLA, 'all', '2999-01-01')).toMatchObject({ entryValueClp: 0, exitValueClp: 0 });
  });

  it('el saldo valorizado corre como el de unidades: inventario inicial al costo + entradas − salidas, todo al costo', async () => {
    const e = mk();
    await sell(e, COLA, 2, 6000); // 10 → 8 un.; salen 2 al costo de $1.294
    e.registerPurchase({ ...base, docNumber: '1', lines: [{ productId: COLA, quantity: 20, unitCostClp: 1000, priceNetClp: 1800 }] });
    await sell(e, COLA, 1, 3000); // sale 1 al promedio: 30.352 ÷ 28 = $1.084
    const card = e.stockCard(B, COLA, 'physical');
    // inventario inicial: 10 un. al costo que había antes de la compra ($1.294), aunque la compra fuera a $1.000
    expect(card).toMatchObject({ openingQty: 10, openingUnitCostClp: 1294, openingValueClp: 12_940, closingQty: 27 });
    expect(card.rows.map((r) => [r.balance, r.balanceValueClp]).reverse()).toEqual([
      [8, 12_940 - 2588], // 10.352
      [28, 12_940 - 2588 + 20_000], // 30.352
      [27, 12_940 - 2588 + 20_000 - 1084], // 29.268
    ]);
    expect(card.closingValueClp).toBe(29_268);
    // con un período, el inicial valorizado arrastra lo anterior
    const later = e.stockCard(B, COLA, 'physical', '2026-10-21');
    expect(later).toMatchObject({ openingQty: 27, openingValueClp: 29_268, closingValueClp: 29_268, rows: [] });
  });

  it('cuando las unidades llegan a 0, el saldo valorizado también queda en 0 (y se puede volver a empezar)', async () => {
    const e = mk();
    e.registerPurchase({ ...base, docNumber: '1', lines: [{ productId: COLA, quantity: 20, unitCostClp: 1001, priceNetClp: 1800 }] }); // costo con decimales al promediar
    await sell(e, COLA, 12, 40_000);
    const k = e.createCart(B, 'physical'); e.cartAdd(k.id, COLA, 10); e.registerConsumption(k.id);
    e.adjustStock(B, COLA, 'physical', -8); // 10 + 20 − 12 − 10 − 8 = 0
    let card = e.stockCard(B, COLA, 'physical');
    const last = card.rows[0]!; // la fila más nueva
    expect(last).toMatchObject({ balance: 0, balanceValueClp: 0 });
    expect(card).toMatchObject({ closingQty: 0, closingValueClp: 0, currentQty: 0 });
    // lo que salió suma exactamente lo que entró (inicial + compra): no queda ni sobra ningún peso
    expect(card.entryValueClp + card.openingValueClp).toBe(card.exitValueClp);
    // y al volver a comprar, el saldo parte de cero con el costo nuevo
    e.registerPurchase({ ...base, docNumber: '2', lines: [{ productId: COLA, quantity: 5, unitCostClp: 1100 }] });
    card = e.stockCard(B, COLA, 'physical');
    expect(card.rows[0]).toMatchObject({ balance: 5, balanceValueClp: 5500 });
  });

  it('consumos, ajustes y traspasos salen al costo promedio; la anulación de una compra devuelve lo que costó', () => {
    const e = mk();
    const k = e.createCart(B, 'physical'); e.cartAdd(k.id, COLA, 2);
    e.registerConsumption(k.id);
    e.adjustStock(B, COLA, 'physical', 3);
    e.adjustStock(B, COLA, 'physical', -1);
    e.moveStock(B, COLA, 'physical', 'online', 1);
    const p = e.registerPurchase({ ...base, docNumber: '9', lines: [{ productId: COLA, quantity: 5, unitCostClp: 1000, priceNetClp: 1800 }] });
    e.voidPurchase(p.id);
    const rows = e.stockCard(B, COLA, 'physical').rows.reverse();
    const v = (r: (typeof rows)[number]) => [r.type, r.entryValueClp, r.exitValueClp];
    expect(rows.map(v)).toEqual([
      ['consumption', undefined, 2 * 1294], // al costo
      ['adjustment', 3 * 1294, undefined], // entrada al costo
      ['adjustment', undefined, 1294], // salida al costo promedio, no al precio de venta
      ['transfer', undefined, 1294], // en la vista de un canal también se valora, para que el saldo cuadre
      ['purchase', 5000, undefined],
      ['return', undefined, 5000], // la anulación de la compra sale al costo de esa compra
    ]);
    expect(rows[5]).toMatchObject({ detail: 'Anulación de compra · Factura N° 9', unitCostClp: 1000 });
  });

  it('una base con movimientos sin precios anotados se valora con el costo y precio vigentes', () => {
    const e = mk();
    e.adjustStock(B, COLA, 'physical', 4);
    const snap = e.snapshot();
    snap.movements.forEach((m) => { delete m.unitCostClp; delete m.unitPriceClp; });
    const old = new PosEngine(snap, { now: NOW });
    expect(old.stockCard(B, COLA, 'physical').rows[0]).toMatchObject({ unitCostClp: 1294, unitPriceClp: 1990, unitPriceNetClp: 1672, entryValueClp: 4 * 1294 });
  });
});

describe('corrección del precio de venta', () => {
  const clock = () => {
    let t = Date.parse('2026-10-20T15:00:00Z');
    return { now: () => new Date(t), tick: () => { t += 60_000; } };
  };
  const mk = (c = clock()) => ({ c, e: make({ physical: 10, online: 0 }, { now: c.now }) });
  const sell = async (e: PosEngine, qty: number, received: number) => {
    const cart = e.createCart(B, 'physical'); e.cartAdd(cart.id, COLA, qty);
    return payCart(e, fast(), { cartId: cart.id, method: 'cash', receivedClp: received });
  };

  it('el precio nuevo rige desde ahora y las ventas ya hechas conservan el suyo', async () => {
    const { c, e } = mk();
    const s1 = await sell(e, 2, 6000); c.tick();
    const p = e.setProductPrice(COLA, 1000, '  error al digitar ');
    expect(p.priceClp).toBe(1190); // $1.000 neto + IVA
    c.tick();
    const s2 = await sell(e, 1, 2000);
    expect(e.getSale(s1.saleId!)).toMatchObject({ totalClp: 3980, netClp: 3345, lines: [expect.objectContaining({ unitPriceClp: 1990 })] });
    expect(e.getSale(s2.saleId!)).toMatchObject({ totalClp: 1190, lines: [expect.objectContaining({ unitPriceClp: 1190 })] });

    const card = e.stockCard(B, COLA, 'physical');
    expect(card.rows.map((r) => [r.type, r.entry, r.exit, r.balance, r.unitPriceClp, r.exitValueClp])).toEqual([
      ['sale', 0, 1, 7, 1190, 1294],
      ['price', 0, 0, 8, 1190, undefined],
      ['sale', 0, 2, 8, 1990, 2588], // la venta anterior conserva su precio ($1.990); los valores son al costo
    ]);
    expect(card.rows[1]).toMatchObject({
      channel: null, detail: 'Cambio de precio · $1.672 → $1.000 neto ($1.990 → $1.190 con IVA) · error al digitar', unitPriceNetClp: 1000,
    });
    expect(card).toMatchObject({ entries: 0, exits: 3, exitValueClp: 3882, closingQty: 7 });
    expect(e.stockCard(B, COLA, 'all').rows.map((r) => r.type)).toEqual(['sale', 'price', 'sale']);
  });

  it('actualiza los carritos abiertos, pero no los pedidos retenidos', () => {
    const { e } = mk();
    const open = e.createCart(B, 'physical'); e.cartAdd(open.id, COLA, 2);
    const held = e.createCart(B, 'physical'); e.cartAdd(held.id, COLA, 1);
    e.holdCart(held.id, { customerName: 'Pedro', channel: 'phone' });
    e.setProductPrice(COLA, 1000);
    expect(e.getCart(open.id)).toMatchObject({ subtotalClp: 2380, totalClp: 2380 });
    expect(e.getCart(open.id).lines[0]!.unitPriceClp).toBe(1190);
    expect(e.getCart(held.id)).toMatchObject({ status: 'held', totalClp: 1990 });
  });

  it('valida el precio y no acepta dejar el mismo', () => {
    const { e } = mk();
    expect(() => e.setProductPrice(COLA, -1)).toThrow(/entero/);
    expect(() => e.setProductPrice(COLA, 10.5)).toThrow(/entero/);
    expect(() => e.setProductPrice(COLA, 1672)).toThrow(/ya es ese/); // 1.672 neto = $1.990 actual
    expect(() => e.setProductPrice('nope', 1000)).toThrow(PosError);
    expect(e.stockCard(B, COLA).rows).toEqual([]);
  });

  it('editar el precio desde el producto también queda anotado; dejarlo igual no', () => {
    const { c, e } = mk();
    const same = { id: COLA, name: 'Bebida cola 1,5 L', priceClp: 1990, costClp: 1294 };
    e.upsertProduct(same);
    expect(e.stockCard(B, COLA).rows).toHaveLength(0);
    c.tick();
    e.upsertProduct({ ...same, priceClp: 2200 });
    expect(e.stockCard(B, COLA).rows[0]).toMatchObject({ type: 'price', unitPriceClp: 2200, detail: expect.stringContaining('Edición del producto') });
  });

  it('una compra con precio nuevo actualiza los carritos abiertos y no duplica el aviso en la tarjeta', () => {
    const { e } = mk();
    const open = e.createCart(B, 'physical'); e.cartAdd(open.id, COLA, 1);
    e.registerPurchase({ branchId: B, supplierName: 'Sur', docNumber: '1', docDate: '2026-10-20', lines: [{ productId: COLA, quantity: 5, unitCostClp: 1000, priceNetClp: 1800 }] });
    expect(e.getCart(open.id).totalClp).toBe(2142);
    expect(e.stockCard(B, COLA).rows.map((r) => r.type)).toEqual(['purchase']);
  });

  it('una base guardada antes de esta función sigue funcionando', () => {
    const old = seedState();
    delete (old as { priceChanges?: unknown }).priceChanges;
    const e = new PosEngine(old);
    expect(e.setProductPrice(COLA, 1000).priceClp).toBe(1190);
    expect(e.stockCard(B, COLA).rows).toHaveLength(1);
  });
});

describe('tarjeta de existencia', () => {
  it('lista entradas y salidas con su origen y el saldo después de cada movimiento', async () => {
    const e = make({ physical: 10, online: 4 });
    const s = e.createCart(B, 'physical'); e.cartAdd(s.id, COLA, 3);
    const sale = await payCart(e, fast(), { cartId: s.id, method: 'cash', receivedClp: 6000 });
    const k = e.createCart(B, 'physical'); e.cartAdd(k.id, COLA, 2);
    const cons = e.registerConsumption(k.id, 'degustación');
    e.adjustStock(B, COLA, 'physical', 5);
    e.moveStock(B, COLA, 'physical', 'online', 1);

    const card = e.stockCard(B, COLA, 'physical');
    expect(card.openingQty).toBe(10);
    expect(card.rows.map((r) => [r.detail, r.entry, r.exit, r.balance])).toEqual([
      ['Traspaso a Online', 0, 1, 9],
      ['Ajuste de inventario', 5, 0, 10],
      ['Consumo N° 1 · degustación', 0, 2, 5],
      [`Venta N° ${e.getSale(sale.saleId!).number}`, 0, 3, 7],
    ]);
    expect(card).toMatchObject({ closingQty: 9, currentQty: 9, entries: 5, exits: 6 });
    // solo las ventas apuntan a su comprobante; consumo, ajuste y traspaso no
    expect(card.rows.map((r) => r.saleId)).toEqual([undefined, undefined, undefined, sale.saleId]);
    expect(e.available(B, COLA, 'physical')).toBe(card.closingQty);
    expect(cons.id).toBeTruthy();
  });

  it('en la vista total los traspasos no aparecen y el saldo suma ambos canales', () => {
    const e = make({ physical: 10, online: 4 });
    e.moveStock(B, COLA, 'physical', 'online', 3);
    e.adjustStock(B, COLA, 'online', -1);
    const all = e.stockCard(B, COLA);
    expect(all).toMatchObject({ openingQty: 14, closingQty: 13, currentQty: 13 });
    expect(all.rows.map((r) => r.detail)).toEqual(['Ajuste de inventario']);
    const online = e.stockCard(B, COLA, 'online');
    expect(online.rows.map((r) => [r.detail, r.balance])).toEqual([['Ajuste de inventario', 6], ['Traspaso desde Caja', 7]]);
  });

  it('muestra las anulaciones y filtra por fecha con su saldo inicial', async () => {
    const e = make();
    const c = e.createCart(B, 'physical'); e.cartAdd(c.id, AGUA, 2);
    const p = await payCart(e, fast(), { cartId: c.id, method: 'cash', receivedClp: 2000 });
    const num = e.getSale(p.saleId!).number;
    e.voidSale(p.saleId!);
    const card = e.stockCard(B, AGUA, 'physical');
    expect(card.rows.map((r) => [r.detail, r.balance])).toEqual([[`Anulación de venta N° ${num}`, 40], [`Venta N° ${num}`, 38]]);
    expect(card.rows.map((r) => r.saleId)).toEqual([p.saleId, p.saleId]); // la anulación también abre el comprobante
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    expect(e.stockCard(B, AGUA, 'physical', hoy, hoy).rows).toHaveLength(2);
    const futuro = e.stockCard(B, AGUA, 'physical', '2999-01-01');
    expect(futuro).toMatchObject({ openingQty: 40, closingQty: 40, rows: [] });
    expect(e.stockCard(B, AGUA, 'physical', undefined, '2000-01-01')).toMatchObject({ openingQty: 40, closingQty: 40, rows: [] });
    expect(() => e.stockCard(B, 'nope')).toThrow(PosError);
  });
});

describe('consumo propio', () => {
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const COLA_COST = Math.round(1990 * 0.65);

  it('descuenta el stock al costo, sin venta, comprobante ni ganancia', () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2);
    e.setCustomer(c.id, { name: 'Dueño' });
    const k = e.registerConsumption(c.id, '  para el local  ');
    expect(k).toMatchObject({ number: 1, costClp: 2 * COLA_COST, who: 'Dueño', note: 'para el local' });
    expect(e.available(B, COLA, 'physical')).toBe(38);
    expect(e.inventory(B).find((r) => r.product.id === COLA)!.physical).toEqual({ qty: 38, reserved: 0 });
    expect(e.movements(COLA, 1)[0]).toMatchObject({ delta: -2, reason: 'consumption', refId: k.id });
    expect(e.listSales()).toHaveLength(0);
    expect(e.nextOrderNumber()).toBe(1); // un consumo no gasta número de venta
    expect(e.getCart(c.id).status).toBe('closed');
    expect(e.listConsumptions()).toHaveLength(1);
  });

  it('exige carrito con productos y jornada abierta, y no se repite sobre el mismo carrito', () => {
    const e = make();
    const empty = e.createCart(B, 'physical');
    expect(() => e.registerConsumption(empty.id)).toThrow(/vacío/);
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    e.registerConsumption(c.id);
    expect(() => e.registerConsumption(c.id)).toThrow(PosError);
    const sin = make({}, {}, false);
    const c2 = sin.createCart(B, 'physical');
    sin.cartAdd(c2.id, COLA, 1);
    expect(() => sin.registerConsumption(c2.id)).toThrow(/jornada abierta/);
  });

  it('el reporte muestra el consumo al costo y no altera ingresos ni utilidad', async () => {
    const e = make();
    const s = e.createCart(B, 'physical'); e.cartAdd(s.id, AGUA, 1);
    await payCart(e, fast(), { cartId: s.id, method: 'cash', receivedClp: 1000 });
    const before = e.salesReport(today(), today()).kpis;
    const c = e.createCart(B, 'physical'); e.cartAdd(c.id, COLA, 3);
    e.registerConsumption(c.id);
    const r = e.salesReport(today(), today());
    expect(r.kpis).toEqual(before);
    expect(r.kpis.profitClp).toBe(990 - Math.round(990 * 0.65));
    expect(r.consumption).toEqual({ count: 1, units: 3, costClp: 3 * COLA_COST });
  });

  it('anular un consumo devuelve el stock y deja de contar en el reporte', () => {
    const e = make();
    const c = e.createCart(B, 'physical'); e.cartAdd(c.id, COLA, 3);
    const k = e.registerConsumption(c.id);
    expect(e.available(B, COLA, 'physical')).toBe(37);
    const voided = e.voidConsumption(k.id, '  me equivoqué ');
    expect(voided).toMatchObject({ status: 'voided', voidReason: 'me equivoqué' });
    expect(e.available(B, COLA, 'physical')).toBe(40);
    expect(e.movements(COLA, 1)[0]).toMatchObject({ delta: 3, reason: 'return', refId: k.id });
    expect(e.salesReport(today(), today()).consumption).toEqual({ count: 0, units: 0, costClp: 0 });
    expect(e.listConsumptions()[0]!.status).toBe('voided');
    expect(() => e.voidConsumption(k.id)).toThrow(/ya está anulado/);
    expect(() => e.voidConsumption('nope')).toThrow(PosError);
  });

  it('filtra la lista de consumos por fecha', () => {
    const e = make();
    const c = e.createCart(B, 'physical'); e.cartAdd(c.id, COLA, 1);
    e.registerConsumption(c.id);
    expect(e.listConsumptions({ from: today(), to: today() })).toHaveLength(1);
    expect(e.listConsumptions({ to: '2000-01-01' })).toHaveLength(0);
  });

  it('una base guardada antes de esta función sigue funcionando', () => {
    const old = seedState();
    delete (old as { consumptions?: unknown }).consumptions;
    const e = new PosEngine(old);
    e.openShift('cashier_1', '1234', 0);
    const c = e.createCart(B, 'physical'); e.cartAdd(c.id, COLA, 1);
    expect(e.registerConsumption(c.id).number).toBe(1);
  });
});

describe('clientes y promociones', () => {
  it('busca clientes por nombre o RUT desde 2 caracteres, sin tildes', () => {
    const e = make();
    expect(e.searchClients('m')).toEqual([]);
    expect(e.searchClients('maria')[0]?.name).toBe('María Pérez');
    expect(e.searchClients('MARÍA')).toHaveLength(1);
    expect(e.searchClients('11.111.111')[0]?.name).toBe('Juan Soto');
    expect(e.searchClients('12345678')[0]?.isVip).toBe(true);
  });
  it('asocia un cliente registrado o deja uno escrito a mano', () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    const withClient = e.setCustomer(c.id, { clientId: 'cli_seed_1' });
    expect(withClient.customer).toMatchObject({ name: 'María Pérez', isVip: true, rut: '12345678-5' });
    expect(e.setCustomer(c.id, { name: 'Pedro' }).customer).toEqual({ name: 'Pedro' });
  });
  it('registra y valida clientes nuevos', () => {
    const e = make();
    expect(e.upsertClient({ name: 'Ana', rut: '5.126.663-3' }).rut).toBe('5126663-3');
    expect(() => e.upsertClient({ name: 'X', rut: '12.345.678-9' })).toThrow(/RUT/);
    expect(() => e.upsertClient({ name: 'Y', rut: '11111111-1' })).toThrow(/RUT|existe/);
  });
  it('aplica porcentaje y monto fijo, y la venta guarda el descuento', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2); // 3.980
    expect(e.applyPromo(c.id, 'nexus5')).toMatchObject({ subtotalClp: 3980, discountClp: 199, totalClp: 3781 });
    expect(e.applyPromo(c.id, 'MENOS500')).toMatchObject({ discountClp: 500, totalClp: 3480 });
    const p = await payCart(e, fast(), { cartId: c.id, method: 'debit' });
    const sale = e.getSale(p.saleId!);
    expect(sale).toMatchObject({ discountClp: 500, promotionCode: 'MENOS500', totalClp: 3480 });
    expect(sale.netClp + sale.ivaClp).toBe(3480);
  });
  it('rechaza códigos inválidos o vencidos y recalcula al quitar productos', () => {
    const e = make({}, { now: () => new Date('2028-02-01T12:00:00Z') });
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    expect(() => e.applyPromo(c.id, 'NEXUS5')).toThrow(/vencido/);
    expect(() => e.applyPromo(c.id, 'NOEXISTE')).toThrow(PosError);
    const e2 = make();
    const c2 = e2.createCart(B, 'physical');
    e2.cartAdd(c2.id, COLA, 1);
    e2.applyPromo(c2.id, 'VIP10');
    e2.cartSetQuantity(c2.id, 0, 0);
    expect(e2.getCart(c2.id)).toMatchObject({ totalClp: 0, discountClp: 0 });
    expect(e2.getCart(c2.id).promotion).toBeUndefined();
  });
  it('crea y valida promociones', () => {
    const e = make();
    const p = e.upsertPromotion({ name: 'Verano', type: 'percent', value: 15, code: 'verano15' });
    expect(p.code).toBe('VERANO15');
    expect(() => e.upsertPromotion({ name: 'X', type: 'percent', value: 150, code: 'X' })).toThrow(PosError);
    expect(() => e.upsertPromotion({ name: 'Dup', type: 'fixed', value: 100, code: 'VERANO15' })).toThrow(/código/);
    expect(e.activePromotions().some((x) => x.code === 'VERANO15')).toBe(true);
  });
});

describe('pedidos abiertos', () => {
  const data = { customerName: 'Rosa', phone: '912345678', channel: 'whatsapp' as const, note: 'Retira a las 18:00' };
  it('retiene el carrito y su stock hasta cobrarlo', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2);
    const t = e.holdCart(c.id, data);
    expect(t).toMatchObject({ number: 1, paid: false, totalClp: 3980, status: 'open' });
    expect(e.available(B, COLA, 'physical')).toBe(38);
    expect(() => e.cartAdd(c.id, COLA, 1)).toThrow(PosError);
    expect(e.listTickets()).toHaveLength(1);
    const cart = e.resumeTicket(t.id);
    expect(cart.status).toBe('open');
    expect(e.listTickets()).toHaveLength(0);
    const p = await payCart(e, fast(), { cartId: cart.id, method: 'cash' });
    expect(p.status).toBe('approved');
  });
  it('exige el nombre del cliente y cancelar libera el stock', () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    expect(() => e.holdCart(c.id, { ...data, customerName: ' ' })).toThrow(/nombre/);
    const t = e.holdCart(c.id, data);
    e.cancelTicket(t.id);
    expect(e.available(B, COLA, 'physical')).toBe(40);
  });
  it('un pedido que ya pagó queda para entregar', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, AGUA, 1);
    const p = await payCart(e, fast(), { cartId: c.id, method: 'debit' });
    const t = e.createPaidTicket(p.saleId!, data);
    expect(t).toMatchObject({ paid: true, saleId: p.saleId, cartId: null });
    expect(() => e.resumeTicket(t.id)).toThrow(/pagado/);
    e.completeTicket(t.id);
    expect(e.listTickets()).toHaveLength(0);
  });
  it('arma enlaces de WhatsApp con +56 y plantillas', () => {
    expect(normalizePhone('9 1234 5678')).toBe('56912345678');
    expect(normalizePhone('+56 9 1234 5678')).toBe('56912345678');
    expect(normalizePhone('+1 415 555 0100')).toBe('14155550100');
    expect(normalizePhone('12345')).toBeNull();
    const t = { number: 7, customerName: 'Rosa', paid: false, totalClp: 1990, lines: [{ productId: 'x', name: 'Cola', unitPriceClp: 1990, costClp: 0, quantity: 1 }] };
    expect(whatsappMessage(t, 'ready')).toContain('#7');
    expect(whatsappMessage(t, 'detail')).toContain('1 × Cola');
    expect(whatsappUrl('912345678', 'Hola')).toBe('https://wa.me/56912345678?text=Hola');
    expect(whatsappUrl('abc', 'Hola')).toBeNull();
  });
});

describe('anulaciones', () => {
  it('anular devuelve el stock y excluye la venta de los totales', async () => {
    const e = make({}, { now: () => new Date('2026-10-19T15:00:00Z') });
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2);
    const p = await payCart(e, fast(), { cartId: c.id, method: 'cash' });
    expect(e.available(B, COLA, 'physical')).toBe(38);
    e.voidSale(p.saleId!, 'cliente se arrepintió');
    expect(e.available(B, COLA, 'physical')).toBe(40);
    expect(() => e.voidSale(p.saleId!)).toThrow(/anulada/);
    const r = e.salesReport('2026-10-19', '2026-10-19');
    expect(r.kpis).toMatchObject({ count: 0, revenueClp: 0, voidedCount: 1, voidedClp: 3980 });
    expect(e.shiftInfo()?.salesCount).toBe(0);
  });
});

describe('reportes', () => {
  it('reporte por rango: KPI, comparación, series y rankings', async () => {
    let now = new Date('2026-10-10T15:00:00Z'); // período anterior
    const e = make({}, { now: () => now });
    const g = fast();
    const sell = async (code: string, qty: number, method: 'cash' | 'credit', promo?: string) => {
      const c = e.createCart(B, 'physical');
      e.cartAdd(c.id, code, qty);
      if (promo) e.applyPromo(c.id, promo);
      await payCart(e, g, { cartId: c.id, method });
    };
    await sell(COLA, 1, 'cash'); // 1.990 el 10/10
    now = new Date('2026-10-19T15:00:00Z'); // 12:00 en Chile
    await sell(COLA, 2, 'cash', 'NEXUS5'); // 3.780 aprox.
    await sell(AGUA, 3, 'credit'); // 2.970
    const r = e.salesReport('2026-10-15', '2026-10-19');
    expect(r.kpis.count).toBe(2);
    expect(r.kpis.items).toBe(5);
    expect(r.kpis.revenueClp).toBe(3781 + 2970);
    expect(r.kpis.discountsClp).toBe(199);
    expect(r.kpis.avgTicketClp).toBe(Math.round((3781 + 2970) / 2));
    expect(r.kpis.profitClp).toBe(r.kpis.revenueClp - r.kpis.costClp);
    // El período anterior (10-10 → 10-14) contiene la venta del 10/10 de $1.990.
    expect(r.prev).toMatchObject({ count: 1, revenueClp: 1990 });
    expect(r.deltas).toMatchObject({ count: 100, revenueClp: 239 });
    expect(r.byDay).toHaveLength(5);
    expect(r.byDay.at(-1)).toMatchObject({ date: '2026-10-19', count: 2 });
    expect(r.byMethod.map((m) => m.method).sort()).toEqual(['cash', 'credit']);
    expect(r.byHour[12]!.count).toBe(2);
    expect(r.byWeekday[1]!.count).toBe(2); // lunes
    expect(r.byCategory.map((c) => c.category).sort()).toEqual(['Bebidas']);
    expect(r.topProducts[0]).toMatchObject({ name: 'Agua mineral 1,5 L', units: 3 });
    expect(r.promotions).toEqual([{ code: 'NEXUS5', name: 'NEXUS5', uses: 1, discountClp: 199 }]);
    const wide = e.salesReport('2026-10-10', '2026-10-19');
    expect(wide.kpis.count).toBe(3);
    const compare = e.salesReport('2026-10-20', '2026-10-24');
    expect(compare.prev.count).toBe(2);
    expect(compare.deltas.count).toBe(-100);
    expect(e.salesReport('2026-10-01', '2026-10-05').deltas.count).toBeNull(); // sin base de comparación
  });

  it('lista ventas y filtra por jornada y fechas', async () => {
    const e = make({}, { now: () => new Date('2026-10-19T15:00:00Z') });
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    await payCart(e, fast(), { cartId: c.id, method: 'cash' });
    const shiftId = e.currentShift()!.id;
    expect(e.listSales({ shiftId })[0]).toMatchObject({ number: 1 });
    expect(e.listSales({ from: '2026-10-20' })).toHaveLength(0);
    expect(e.listSales({ from: '2026-10-19', to: '2026-10-19' })).toHaveLength(1);
  });
});

describe('negocio nuevo y ingreso por escaneo', () => {
  const fresh = () => new PosEngine(emptyState({ name: 'Almacén Don Pepe' }));

  it('un negocio nuevo parte en cero: sin productos, stock, clientes, promociones ni cajeros', () => {
    const e = fresh();
    expect(e.catalog(B, 'physical')).toEqual([]);
    expect(e.listProducts()).toEqual([]);
    expect(e.listClients()).toEqual([]);
    expect(e.listPromotions()).toEqual([]);
    expect(e.listCashiers()).toEqual([]);
    expect(e.listSales()).toEqual([]);
    expect(e.currentShift()).toBeNull();
    expect(e.getBusiness().name).toBe('Almacén Don Pepe');
  });

  it('guarda los datos del negocio y valida el RUT', () => {
    const e = fresh();
    expect(e.updateBusiness({ name: ' Don Pepe ', rut: '12.345.678-5', giro: 'Abarrotes' })).toMatchObject({ name: 'Don Pepe', rut: '12345678-5', giro: 'Abarrotes' });
    expect(() => e.updateBusiness({ name: 'X', rut: '12.345.678-9' })).toThrow(/RUT/);
    expect(() => e.updateBusiness({ name: '  ' })).toThrow(/nombre/);
  });

  it('el primer cajero se crea y puede abrir jornada', () => {
    const e = fresh();
    const c = e.upsertCashier({ name: 'Pepe', pin: '4321' });
    expect(e.openShift(c.id, '4321', 0).status).toBe('open');
  });

  it('escanear un código nuevo crea el producto con costo y precio neto, y suma el stock', () => {
    const e = fresh();
    const r = e.receiveStock(B, { barcode: '7801234567890', name: 'Coca Cola 1,5 L', category: 'Bebidas', costClp: 1000, priceNetClp: 1500, quantity: 12 });
    expect(r).toMatchObject({ created: true, qty: 12 });
    expect(r.product).toMatchObject({ name: 'Coca Cola 1,5 L', costClp: 1000, priceClp: addIva(1500) });
    expect(e.available(B, r.product.id, 'physical')).toBe(12);
    expect(e.findProduct('7801234567890')?.id).toBe(r.product.id);
    expect(e.findProduct('no-existe')).toBeNull();
  });

  it('escanear uno existente suma stock, promedia el costo y registra el cambio de precio', () => {
    const e = fresh();
    const a = e.receiveStock(B, { barcode: '111', name: 'Arroz', costClp: 1000, priceNetClp: 1500, quantity: 10 });
    const b = e.receiveStock(B, { barcode: '111', quantity: 10, costClp: 1200, priceNetClp: 1600 });
    expect(b).toMatchObject({ created: false, qty: 20 });
    expect(b.product.costClp).toBe(1100); // (10×1000 + 10×1200) / 20
    expect(b.product.priceClp).toBe(addIva(1600));
    const card = e.stockCard(B, a.product.id);
    expect(card.rows.map((r) => r.detail)).toEqual(expect.arrayContaining(['Ingreso de inventario']));
    expect(card.currentQty).toBe(20);
  });

  it('sumar de a uno sin datos no cambia costo ni precio', () => {
    const e = fresh();
    e.receiveStock(B, { barcode: '222', name: 'Fideos', costClp: 800, priceNetClp: 1200, quantity: 5 });
    const r = e.receiveStock(B, { barcode: '222' });
    expect(r.qty).toBe(6);
    expect(r.product).toMatchObject({ costClp: 800, priceClp: addIva(1200) });
  });

  it('valida los datos del ingreso', () => {
    const e = fresh();
    expect(() => e.receiveStock(B, { barcode: '  ' })).toThrow(/código/);
    expect(() => e.receiveStock(B, { barcode: '333' })).toThrow(/nombre/);
    expect(() => e.receiveStock(B, { barcode: '333', name: 'X' })).toThrow(/precio/);
    expect(() => e.receiveStock(B, { barcode: '333', name: 'X', priceNetClp: 100, quantity: 0 })).toThrow(/cantidad/i);
    expect(() => e.receiveStock(B, { barcode: '333', name: 'X', priceNetClp: -1 })).toThrow(/precio/);
    expect(() => e.receiveStock('otra', { barcode: '333', name: 'X', priceNetClp: 100 })).toThrow(/Sucursal/);
  });

  it('lo ingresado se puede vender y el stock baja', async () => {
    const e = fresh();
    const cashier = e.upsertCashier({ name: 'Pepe', pin: '1234' });
    e.openShift(cashier.id, '1234', 0);
    const { product } = e.receiveStock(B, { barcode: '444', name: 'Pan', costClp: 500, priceNetClp: 840, quantity: 3 });
    const cart = e.createCart(B, 'physical');
    e.cartAdd(cart.id, '444', 2);
    const p = await payCart(e, fast(), { cartId: cart.id, method: 'cash' });
    expect(p.status).toBe('approved');
    expect(e.available(B, product.id, 'physical')).toBe(1);
  });
});

describe('API remota (RPC)', () => {
  it('todos los métodos publicados existen en el motor', () => {
    const e = make();
    for (const m of RPC_METHODS) expect(typeof (e as unknown as Record<string, unknown>)[m], m).toBe('function');
  });
});
