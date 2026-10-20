import { useEffect, useState } from 'react';
import { PAY_METHOD_LABEL, formatClp, type SalesReport } from '@nexus/core';
import type { PosApi } from '../api';
import { Donut, HBars, TrendChart, VBars } from '../charts';
import { addDays, download, toCsv, todayLocal } from '../format';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function Kpi(props: { icon: string; label: string; value: string; sub?: string; delta?: number | null; tone?: string }) {
  return (
    <div className={'kpi ' + (props.tone ?? '')}>
      <span>{props.icon} {props.label}</span>
      <strong>{props.value}</strong>
      {props.delta !== undefined && props.delta !== null
        ? <small className={props.delta >= 0 ? 'up' : 'down'}>{props.delta >= 0 ? '▲' : '▼'} {Math.abs(props.delta)}% <em>{props.sub}</em></small>
        : <small><em>{props.sub}</em></small>}
    </div>
  );
}

export function PanelView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [from, setFrom] = useState(addDays(todayLocal(), -30));
  const [to, setTo] = useState(todayLocal());
  const [r, setR] = useState<SalesReport | null>(null);

  useEffect(() => {
    if (from && to && from <= to) api.rpc.salesReport(from, to, branchId).then(setR).catch(() => setR(null));
  }, [api, branchId, from, to]);

  const preset = (days: number) => { setTo(todayLocal()); setFrom(addDays(todayLocal(), -days)); };

  const exportCsv = async () => {
    const sales = await api.rpc.listSales({ from, to, limit: 10_000 });
    download(`ventas_${from}_${to}.csv`, toCsv([
      ['N°', 'Folio', 'Fecha', 'Cajero', 'Canal', 'Medio de pago', 'Subtotal', 'Descuento', 'Total', 'Estado'],
      ...sales.map((s) => [s.number, s.folio, s.paidAt, s.cashierName ?? '', s.channel === 'online' ? 'Online' : 'Caja', PAY_METHOD_LABEL[s.method], s.subtotalClp, s.discountClp, s.totalClp, s.status === 'voided' ? 'Anulada' : 'Completada']),
    ]), 'text/csv;charset=utf-8');
  };

  const k = r?.kpis;
  return (
    <div className="page wide-page">
      <div className="page-head">
        <h1>📊 Panel de ventas</h1>
        <div className="head-actions">
          <button className="btn ghost sm" onClick={exportCsv}>📗 Excel (CSV)</button>
          <button className="btn ghost sm" disabled={!r} onClick={() => r && download(`panel_${from}_${to}.json`, JSON.stringify(r, null, 2), 'application/json')}>🧾 JSON</button>
        </div>
      </div>
      <div className="filters">
        <label>Desde<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="chips">
          <button className="chip" onClick={() => preset(0)}>Hoy</button>
          <button className="chip" onClick={() => preset(7)}>Semana</button>
          <button className="chip" onClick={() => preset(30)}>Mes</button>
          <button className="chip" onClick={() => preset(365)}>Año</button>
        </div>
      </div>

      {r && k && (
        <>
          <div className="kpis">
            <Kpi icon="🧾" label="Ventas / boletas" tone="blue" value={String(k.count)} delta={r.deltas.count} sub={k.folioFrom ? `folios ${k.folioFrom}–${k.folioTo}` : 'sin folios'} />
            <Kpi icon="💰" label="Ingresos" tone="green" value={formatClp(k.revenueClp)} delta={r.deltas.revenueClp} sub="total facturado" />
            <Kpi icon="🎫" label="Ticket promedio" tone="amber" value={formatClp(k.avgTicketClp)} delta={r.deltas.avgTicketClp} sub="por transacción" />
            <Kpi icon="📈" label="Utilidad bruta" tone="violet" value={formatClp(k.profitClp)} sub={`margen ${k.marginPct}%`} />
            <Kpi icon="📦" label="Ítems vendidos" value={String(k.items)} delta={r.deltas.items} sub="unidades" />
            <Kpi icon="🏷️" label="Descuentos" value={formatClp(k.discountsClp)} sub="total otorgado" />
            <Kpi icon="🚫" label="Anuladas" tone="red" value={String(k.voidedCount)} sub={`${formatClp(k.voidedClp)} anulados`} />
            <Kpi icon="🧮" label="Costo estimado" value={formatClp(k.costClp)} sub="costo de venta" />
          </div>

          <section className="panel"><h2>📈 Tendencia diaria de ventas e ingresos</h2>
            <TrendChart data={r.byDay.map((d) => ({ label: d.date, revenue: d.revenueClp, count: d.count }))} /></section>

          <div className="two">
            <section className="panel"><h2>💳 Medios de pago</h2>
              <Donut data={r.byMethod.map((m) => ({ label: PAY_METHOD_LABEL[m.method], value: m.revenueClp }))} /></section>
            <section className="panel"><h2>🗂️ Ingresos por categoría</h2>
              {r.byCategory.length ? <HBars data={r.byCategory.map((c) => ({ label: c.category, value: c.revenueClp }))} /> : <p className="empty">Sin ventas en el período</p>}</section>
            <section className="panel"><h2>📅 Ventas por día de la semana</h2>
              <VBars data={r.byWeekday.map((d) => ({ label: DAYS[d.day]!, value: d.count }))} color="#3B82F6" /></section>
            <section className="panel"><h2>⏰ Ventas por hora</h2>
              <VBars data={r.byHour.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, value: h.count }))} color="#F59E0B" /></section>
          </div>

          <section className="panel"><h2>🏆 Top productos</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>#</th><th>Producto</th><th>Unidades</th><th>Ingresos</th><th>Utilidad</th><th>Margen</th></tr></thead>
              <tbody>{r.topProducts.map((p, i) => (
                <tr key={p.name}><td>{i + 1}</td><td>{p.name}</td><td>{p.units}</td><td>{formatClp(p.revenueClp)}</td><td>{formatClp(p.profitClp)}</td><td>{p.marginPct}%</td></tr>))}
                {!r.topProducts.length && <tr><td colSpan={6} className="empty">Sin ventas en el período</td></tr>}</tbody>
            </table></div></section>

          <div className="two">
            <section className="panel"><h2>🗂️ Rendimiento por categoría</h2>
              <div className="table-wrap"><table>
                <thead><tr><th>Categoría</th><th>Unid.</th><th>Ingresos</th><th>Margen</th></tr></thead>
                <tbody>{r.byCategory.map((c) => (<tr key={c.category}><td>{c.category}</td><td>{c.units}</td><td>{formatClp(c.revenueClp)}</td><td>{c.marginPct}%</td></tr>))}</tbody>
              </table></div></section>
            <section className="panel"><h2>🏷️ Promociones aplicadas</h2>
              {r.promotions.length === 0 ? <p className="empty">Sin promociones aplicadas en este período</p> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Código</th><th>Usos</th><th>Descuento</th></tr></thead>
                  <tbody>{r.promotions.map((p) => (<tr key={p.code}><td><code>{p.code}</code></td><td>{p.uses}</td><td>{formatClp(p.discountClp)}</td></tr>))}</tbody>
                </table></div>)}</section>
          </div>
        </>
      )}
    </div>
  );
}
