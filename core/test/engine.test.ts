import { describe, expect, it } from 'vitest';
import {
  PosEngine, PosError, SimulatedGateway, payCart, seedState, splitIva, isValidRut, normalizeRut,
  buildBoletaXml, parseBoletaXml, DEFAULT_EMISOR, RPC_METHODS, normalizePhone, whatsappUrl, whatsappMessage, formatClp,
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

  it('pagos simultáneos: stock nunca negativo, folios únicos y consecutivos', async () => {
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
    expect(snap.documents.map((d) => d.folio).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
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
  it('pago aprobado descuenta stock, emite boleta y registra la venta', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2);
    const p = await payCart(e, fast(), { cartId: c.id, method: 'debit' });
    expect(p.status).toBe('approved');
    expect(p.provider).toBe('transbank');
    const sale = e.getSale(p.saleId!);
    expect(sale).toMatchObject({ totalClp: 3980, number: 1, status: 'completed', cashierName: 'Cajero 1' });
    expect(sale.netClp + sale.ivaClp).toBe(3980);
    expect(sale.document?.folio).toBe(1);
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
  it('rechaza RUT inválido y sin folios no se cobra', () => {
    const e = make();
    const c = e.createCart(B, 'online');
    expect(() => e.setCustomer(c.id, { rut: '12.345.678-9' })).toThrow(/RUT/);
    const sinFolios = make({ folioFrom: 1, folioTo: 0 });
    const c2 = sinFolios.createCart(B, 'physical');
    sinFolios.cartAdd(c2.id, COLA, 1);
    expect(() => sinFolios.beginPayment(c2.id, 'cash')).toThrow(/folios/);
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

describe('consumo propio', () => {
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const COLA_COST = Math.round(1990 * 0.65);

  it('descuenta el stock al costo, sin venta, boleta, folio ni ganancia', () => {
    const e = make();
    const folio = e.currentFolio();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2);
    e.setCustomer(c.id, { name: 'Dueño' });
    const k = e.registerConsumption(c.id, '  para el local  ');
    expect(k).toMatchObject({ number: 1, costClp: 2 * COLA_COST, who: 'Dueño', note: 'para el local' });
    expect(e.available(B, COLA, 'physical')).toBe(38);
    expect(e.inventory(B).find((r) => r.product.id === COLA)!.physical).toEqual({ qty: 38, reserved: 0 });
    expect(e.movements(COLA, 1)[0]).toMatchObject({ delta: -2, reason: 'consumption', refId: k.id });
    expect(e.listSales()).toHaveLength(0);
    expect(e.currentFolio()).toBe(folio);
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
  it('aplica porcentaje y monto fijo, y la boleta lleva el descuento', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 2); // 3.980
    expect(e.applyPromo(c.id, 'nexus5')).toMatchObject({ subtotalClp: 3980, discountClp: 199, totalClp: 3781 });
    expect(e.applyPromo(c.id, 'MENOS500')).toMatchObject({ discountClp: 500, totalClp: 3480 });
    const p = await payCart(e, fast(), { cartId: c.id, method: 'debit' });
    const sale = e.getSale(p.saleId!);
    expect(sale).toMatchObject({ discountClp: 500, promotionCode: 'MENOS500', totalClp: 3480 });
    const parsed = parseBoletaXml(sale.document!.xml);
    expect(parsed).toMatchObject({ mntTotal: 3480, discountClp: 500 });
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

describe('boleta electrónica y reportes', () => {
  it('genera XML de boleta 39 y se puede parsear de vuelta', () => {
    const xml = buildBoletaXml({
      folio: 7, date: '2026-10-19', emisor: DEFAULT_EMISOR, receptor: { rut: '11111111-1', name: 'Ana & Cía' },
      lines: [{ productId: 'x', name: 'Té <verde>', unitPriceClp: 1190, costClp: 0, quantity: 2 }], totalClp: 2380,
    });
    const b = parseBoletaXml(xml);
    expect(b).toMatchObject({ tipoDte: 39, folio: 7, mntTotal: 2380, mntNeto: 2000, iva: 380, discountClp: 0 });
    expect(b.items[0]).toMatchObject({ name: 'Té <verde>', quantity: 2, amountClp: 2380 });
  });

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
    expect(r.kpis.folioFrom).toBe(2);
    expect(r.kpis.folioTo).toBe(3);
    const wide = e.salesReport('2026-10-10', '2026-10-19');
    expect(wide.kpis.count).toBe(3);
    const compare = e.salesReport('2026-10-20', '2026-10-24');
    expect(compare.prev.count).toBe(2);
    expect(compare.deltas.count).toBe(-100);
    expect(e.salesReport('2026-10-01', '2026-10-05').deltas.count).toBeNull(); // sin base de comparación
  });

  it('lista ventas con folio y filtra por jornada y fechas', async () => {
    const e = make({}, { now: () => new Date('2026-10-19T15:00:00Z') });
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    await payCart(e, fast(), { cartId: c.id, method: 'cash' });
    const shiftId = e.currentShift()!.id;
    expect(e.listSales({ shiftId })[0]).toMatchObject({ number: 1, folio: 1 });
    expect(e.listSales({ from: '2026-10-20' })).toHaveLength(0);
    expect(e.listSales({ from: '2026-10-19', to: '2026-10-19' })).toHaveLength(1);
  });
});

describe('API remota (RPC)', () => {
  it('todos los métodos publicados existen en el motor', () => {
    const e = make();
    for (const m of RPC_METHODS) expect(typeof (e as unknown as Record<string, unknown>)[m], m).toBe('function');
  });
});
