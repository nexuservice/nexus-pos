import { describe, expect, it } from 'vitest';
import {
  PosEngine, PosError, SimulatedGateway, payCart, seedState, splitIva, isValidRut, normalizeRut,
  buildBoletaXml, parseBoletaXml, DEFAULT_EMISOR,
} from '../src';

const B = 'branch_1';
const fast = () => new SimulatedGateway({ delayMs: 0 });
const make = (o: Parameters<typeof seedState>[0] = {}) => new PosEngine(seedState(o));
const COLA = 'prod_1';

describe('IVA y RUT', () => {
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
  it('la tienda online no vende productos no publicados', () => {
    const e = make();
    const c = e.createCart(B, 'online');
    expect(() => e.cartAdd(c.id, 'prod_24', 1)).toThrow(PosError);
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
    const folios = snap.documents.map((d) => d.folio).sort((a, b) => a - b);
    expect(folios).toEqual([1, 2, 3, 4, 5]);
  });

  it('online y caja venden la última unidad a la vez: solo una venta', async () => {
    const e = make({ physical: 1, online: 1 });
    e.moveStock(B, COLA, 'online', 'physical', 1); // todo el stock queda en caja
    const g = fast();
    const caja = e.createCart(B, 'physical');
    const web = e.createCart(B, 'online', { name: 'Ana', email: 'a@b.cl' });
    e.cartAdd(caja.id, COLA, 2);
    expect(() => e.cartAdd(web.id, COLA, 1)).toThrow(PosError);
    const p = await payCart(e, g, { cartId: caja.id, method: 'cash' });
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
    expect(sale.totalClp).toBe(3980);
    expect(sale.netClp + sale.ivaClp).toBe(3980);
    expect(sale.document?.folio).toBe(1);
    expect(e.available(B, COLA, 'physical')).toBe(38);
  });
  it('pago rechazado mantiene el carrito y la reserva', async () => {
    const e = make();
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    const g = new SimulatedGateway({ delayMs: 0, rejectWhen: () => true });
    const p = await payCart(e, g, { cartId: c.id, method: 'credit' });
    expect(p.status).toBe('rejected');
    expect(e.getCart(c.id).status).toBe('open');
    expect(e.available(B, COLA, 'physical')).toBe(39);
    expect(e.snapshot().sales).toHaveLength(0);
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
  it('la tienda online exige cliente y no acepta efectivo', () => {
    const e = make();
    const c = e.createCart(B, 'online');
    e.cartAdd(c.id, COLA, 1);
    expect(() => e.beginPayment(c.id, 'credit')).toThrow(/cliente/);
    e.setCustomer(c.id, { name: 'Ana', email: 'ana@mail.cl', rut: '11.111.111-1' });
    expect(() => e.beginPayment(c.id, 'cash')).toThrow(/efectivo/);
    expect(e.beginPayment(c.id, 'credit').payment.provider).toBe('mercadopago');
  });
  it('rechaza RUT inválido', () => {
    const e = make();
    const c = e.createCart(B, 'online');
    expect(() => e.setCustomer(c.id, { rut: '12.345.678-9' })).toThrow(/RUT/);
  });
  it('sin folios no se puede iniciar un cobro', () => {
    const e = make({ folioFrom: 1, folioTo: 0 });
    const c = e.createCart(B, 'physical');
    e.cartAdd(c.id, COLA, 1);
    expect(() => e.beginPayment(c.id, 'cash')).toThrow(/folios/);
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

describe('boleta electrónica y reportes', () => {
  it('genera XML de boleta 39 y se puede parsear de vuelta', () => {
    const xml = buildBoletaXml({
      folio: 7, date: '2026-10-19', emisor: DEFAULT_EMISOR, receptor: { rut: '11111111-1', name: 'Ana & Cía' },
      lines: [{ productId: 'x', name: 'Té <verde>', unitPriceClp: 1190, quantity: 2 }], totalClp: 2380,
    });
    const b = parseBoletaXml(xml);
    expect(b).toMatchObject({ tipoDte: 39, folio: 7, mntTotal: 2380, mntNeto: 2000, iva: 380 });
    expect(b.items[0]).toMatchObject({ name: 'Té <verde>', quantity: 2, amountClp: 2380 });
  });
  it('reporte diario por canal y método', async () => {
    const e = new PosEngine(seedState(), { now: () => new Date('2026-10-19T15:00:00Z') });
    const g = fast();
    const a = e.createCart(B, 'physical');
    e.cartAdd(a.id, COLA, 1);
    await payCart(e, g, { cartId: a.id, method: 'cash' });
    const w = e.createCart(B, 'online', { name: 'Ana', email: 'a@b.cl' });
    e.cartAdd(w.id, 'prod_2', 2);
    await payCart(e, g, { cartId: w.id, method: 'credit' });
    const r = e.dailyReport('2026-10-19', B);
    expect(r.count).toBe(2);
    expect(r.totalClp).toBe(1990 + 1980);
    expect(r.byChannel.online.count).toBe(1);
    expect(r.byMethod.cash.count).toBe(1);
    expect(r.avgTicketClp).toBe(Math.round(3970 / 2));
  });
});
