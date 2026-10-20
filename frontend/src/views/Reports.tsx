import { useEffect, useState } from 'react';
import { formatClp, type DailyReport } from '@nexus/core';
import type { PosApi } from '../api';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const METHOD: Record<string, string> = { cash: 'Efectivo', debit: 'Débito', credit: 'Crédito' };

export function ReportsView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [date, setDate] = useState(today());
  const [r, setR] = useState<DailyReport | null>(null);

  useEffect(() => {
    if (branchId) api.report(date, branchId).then(setR).catch(() => setR(null));
  }, [api, branchId, date]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reporte diario</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" />
      </div>
      {r && (
        <>
          <div className="kpis">
            <div className="kpi"><span>Ventas</span><strong>{r.count}</strong></div>
            <div className="kpi"><span>Total</span><strong>{formatClp(r.totalClp)}</strong></div>
            <div className="kpi"><span>Ticket promedio</span><strong>{formatClp(r.avgTicketClp)}</strong></div>
            <div className="kpi"><span>Caja / Online</span><strong>{r.byChannel.physical.count} / {r.byChannel.online.count}</strong></div>
          </div>
          <div className="two">
            <section className="panel">
              <h2>Por medio de pago</h2>
              {Object.keys(r.byMethod).length === 0 && <p className="empty">Sin ventas este día</p>}
              {Object.entries(r.byMethod).map(([m, v]) => (
                <div className="row" key={m}><span>{METHOD[m] ?? m} ({v.count})</span><strong>{formatClp(v.totalClp)}</strong></div>
              ))}
            </section>
            <section className="panel">
              <h2>Más vendidos</h2>
              {r.topProducts.length === 0 && <p className="empty">Sin ventas este día</p>}
              {r.topProducts.map((t) => (
                <div className="row" key={t.name}><span>{t.name} ×{t.quantity}</span><strong>{formatClp(t.totalClp)}</strong></div>
              ))}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
