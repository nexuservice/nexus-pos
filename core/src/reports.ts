import type { Consumption, Kpis, PayMethod, Sale, SalesReport } from './types';

const TZ = 'America/Santiago';

/** Fecha local de Chile (YYYY-MM-DD) de un instante ISO. */
export function santiagoDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

function santiagoHour(iso: string): number {
  return Number(new Date(iso).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).slice(0, 2)) % 24;
}

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
const pct = (cur: number, prev: number): number | null => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 100));
const margin = (revenue: number, profit: number): number => (revenue === 0 ? 0 : Math.round((profit / revenue) * 1000) / 10);

function kpis(all: Sale[], folioOf: (documentId: string | null) => number | null): Kpis {
  const done = all.filter((s) => s.status === 'completed');
  const voided = all.filter((s) => s.status === 'voided');
  const revenue = done.reduce((s, x) => s + x.totalClp, 0);
  // Utilidad bruta = ingreso (IVA incluido, tal como se publica el precio) − costo de los productos.
  const cost = done.reduce((s, x) => s + x.lines.reduce((c, l) => c + l.costClp * l.quantity, 0), 0);
  const folios = done.map((s) => folioOf(s.documentId)).filter((f): f is number => f !== null);
  return {
    count: done.length,
    revenueClp: revenue,
    avgTicketClp: done.length ? Math.round(revenue / done.length) : 0,
    items: done.reduce((s, x) => s + x.lines.reduce((c, l) => c + l.quantity, 0), 0),
    discountsClp: done.reduce((s, x) => s + x.discountClp, 0),
    costClp: cost,
    profitClp: revenue - cost,
    marginPct: margin(revenue, revenue - cost),
    voidedCount: voided.length,
    voidedClp: voided.reduce((s, x) => s + x.totalClp, 0),
    folioFrom: folios.length ? Math.min(...folios) : null,
    folioTo: folios.length ? Math.max(...folios) : null,
  };
}

/** Reporte por rango [from, to] (fechas locales, inclusivas) con comparación contra el período anterior. */
export function buildSalesReport(
  sales: Sale[], folioOf: (documentId: string | null) => number | null, from: string, to: string, consumptions: Consumption[] = [],
): SalesReport {
  const inRange = (s: Sale, a: string, b: string) => {
    const d = santiagoDay(s.paidAt);
    return d >= a && d <= b;
  };
  const span = Math.max(1, daysBetween(from, to) + 1);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(span - 1));
  const cur = sales.filter((s) => inRange(s, from, to));
  const prev = sales.filter((s) => inRange(s, prevFrom, prevTo));
  const k = kpis(cur, folioOf);
  const p = kpis(prev, folioOf);
  const done = cur.filter((s) => s.status === 'completed');

  const dayMap = new Map<string, { count: number; revenueClp: number }>();
  for (let i = 0; i < Math.min(span, 400); i++) dayMap.set(addDays(from, i), { count: 0, revenueClp: 0 });
  const methodMap = new Map<PayMethod, { count: number; revenueClp: number }>();
  const weekday = Array.from({ length: 7 }, (_, day) => ({ day, count: 0, revenueClp: 0 }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const prod = new Map<string, { name: string; units: number; revenueClp: number; profitClp: number }>();
  const cat = new Map<string, { units: number; revenueClp: number; profitClp: number }>();
  const promos = new Map<string, { code: string; name: string; uses: number; discountClp: number }>();

  for (const s of done) {
    const day = santiagoDay(s.paidAt);
    const d = dayMap.get(day);
    if (d) { d.count++; d.revenueClp += s.totalClp; }
    const m = methodMap.get(s.method) ?? { count: 0, revenueClp: 0 };
    m.count++; m.revenueClp += s.totalClp;
    methodMap.set(s.method, m);
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
    weekday[wd]!.count++; weekday[wd]!.revenueClp += s.totalClp;
    hours[santiagoHour(s.paidAt)]!.count++;
    // El descuento se reparte proporcional entre las líneas para que la suma por producto cuadre con el ingreso.
    const ratio = s.subtotalClp > 0 ? s.totalClp / s.subtotalClp : 1;
    for (const l of s.lines) {
      const revenue = Math.round(l.unitPriceClp * l.quantity * ratio);
      const profit = revenue - l.costClp * l.quantity;
      const pr = prod.get(l.productId) ?? { name: l.name, units: 0, revenueClp: 0, profitClp: 0 };
      pr.units += l.quantity; pr.revenueClp += revenue; pr.profitClp += profit;
      prod.set(l.productId, pr);
      const c = l.category ?? 'General';
      const ct = cat.get(c) ?? { units: 0, revenueClp: 0, profitClp: 0 };
      ct.units += l.quantity; ct.revenueClp += revenue; ct.profitClp += profit;
      cat.set(c, ct);
    }
    if (s.promotionCode) {
      const pm = promos.get(s.promotionCode) ?? { code: s.promotionCode, name: s.promotionCode, uses: 0, discountClp: 0 };
      pm.uses++; pm.discountClp += s.discountClp;
      promos.set(s.promotionCode, pm);
    }
  }

  return {
    from, to, kpis: k, prev: p,
    deltas: {
      count: pct(k.count, p.count), revenueClp: pct(k.revenueClp, p.revenueClp),
      avgTicketClp: pct(k.avgTicketClp, p.avgTicketClp), items: pct(k.items, p.items),
    },
    byDay: [...dayMap].map(([date, v]) => ({ date, ...v })),
    byMethod: [...methodMap].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.revenueClp - a.revenueClp),
    byCategory: [...cat].map(([category, v]) => ({ category, ...v, marginPct: margin(v.revenueClp, v.profitClp) })).sort((a, b) => b.revenueClp - a.revenueClp),
    byWeekday: weekday,
    byHour: hours,
    topProducts: [...prod.values()].map((v) => ({ ...v, marginPct: margin(v.revenueClp, v.profitClp) })).sort((a, b) => b.units - a.units).slice(0, 10),
    promotions: [...promos.values()].sort((a, b) => b.uses - a.uses),
    consumption: (() => {
      const mine = consumptions.filter((c) => { const d = santiagoDay(c.createdAt); return d >= from && d <= to; });
      return {
        count: mine.length,
        units: mine.reduce((n, c) => n + c.lines.reduce((u, l) => u + l.quantity, 0), 0),
        costClp: mine.reduce((n, c) => n + c.costClp, 0),
      };
    })(),
  };
}
