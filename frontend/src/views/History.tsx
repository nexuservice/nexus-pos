import { useCallback, useEffect, useState } from 'react';
import { INTERNAL_RECEIPT_NOTICE, PAY_METHOD_LABEL, formatClp, type Consumption, type Sale } from '@nexus/core';
import type { PosApi } from '../api';
import { Modal, Receipt, printReceipt } from '../components';
import { download, fmtDate, fmtTime, toCsv } from '../format';
import { msg, type SaleDetail } from '../hooks';

type Row = Sale;

export function HistoryView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [consumptions, setConsumptions] = useState<Consumption[]>([]);
  const [scope, setScope] = useState<'all' | 'shift'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const shift = scope === 'shift' ? await api.rpc.currentShift() : null;
    setRows(await api.rpc.listSales({ branchId: branchId ?? undefined, from: from || undefined, to: to || undefined, shiftId: shift?.id ?? (scope === 'shift' ? 'none' : undefined), limit: 100 }));
    setConsumptions((await api.rpc.listConsumptions({ branchId: branchId ?? undefined, from: from || undefined, to: to || undefined, limit: 100 }))
      .filter((c) => scope === 'all' || (shift && c.shiftId === shift.id)));
  }, [api, branchId, scope, from, to]);
  useEffect(() => { load().catch((e) => setError(msg(e))); }, [load]);

  const done = rows.filter((r) => r.status === 'completed');
  const total = done.reduce((s, r) => s + r.totalClp, 0);

  const open = async (id: string) => { setDetail(await api.rpc.getSale(id)); };
  const voidSale = async (s: SaleDetail) => {
    const reason = prompt('Motivo de la anulación (opcional):');
    if (reason === null) return;
    try { await api.rpc.voidSale(s.id, reason); setDetail(null); await load(); } catch (e) { setError(msg(e)); }
  };

  const voidConsumption = async (c: Consumption) => {
    const reason = prompt(`Anular el consumo #${c.number} (${formatClp(c.costClp)}). Las unidades vuelven al inventario.\nMotivo (opcional):`);
    if (reason === null) return;
    try { await api.rpc.voidConsumption(c.id, reason); await load(); } catch (e) { setError(msg(e)); }
  };
  const activeConsumptions = consumptions.filter((c) => c.status !== 'voided');

  return (
    <div className="page wide-page">
      <div className="page-head">
        <h1>🧾 Historial de ventas</h1>
        <div className="head-actions">
          <button className="btn ghost sm" onClick={() => download('historial.csv', toCsv([
            ['Pedido N°', 'Fecha', 'Hora', 'Cajero', 'Canal', 'Medio', 'Total', 'Estado'],
            ...rows.map((r) => [r.number, fmtDate(r.paidAt), fmtTime(r.paidAt), r.cashierName ?? '', r.channel === 'online' ? 'Online' : 'Caja', PAY_METHOD_LABEL[r.method], r.totalClp, r.status === 'voided' ? 'Anulada' : 'Completada']),
          ]), 'text/csv;charset=utf-8')}>📗 Excel (CSV)</button>
          <button className="btn ghost sm" onClick={() => download('historial.json', JSON.stringify(rows, null, 2), 'application/json')}>🧾 JSON</button>
        </div>
      </div>
      <p className="hint">Últimas 100 ventas registradas.</p>
      <div className="filters">
        <div className="seg"><button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Todas</button><button className={scope === 'shift' ? 'on' : ''} onClick={() => setScope('shift')}>Jornada actual</button></div>
        <label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn ghost sm" onClick={() => { setFrom(''); setTo(''); }}>Limpiar</button>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Ventas</span><strong>{done.length}</strong></div>
        <div className="kpi"><span>Total vendido</span><strong>{formatClp(total)}</strong></div>
        <div className="kpi"><span>Anuladas</span><strong>{rows.length - done.length}</strong></div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Hora</th><th>Pedido</th><th>Canal</th><th>Medio</th><th>Total</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status === 'voided' ? 'voided' : ''}>
              <td>{fmtDate(r.paidAt)}</td><td>{fmtTime(r.paidAt)}</td><td>#{r.number}</td><td>{r.channel === 'online' ? 'Online' : r.cashierName ?? 'Caja'}</td>
              <td>{PAY_METHOD_LABEL[r.method]}</td><td>{formatClp(r.totalClp)}</td>
              <td><span className={'pill ' + (r.status === 'completed' ? 'ok' : 'bad')}>{r.status === 'completed' ? 'completada' : 'anulada'}</span></td>
              <td><button className="btn ghost sm" onClick={() => open(r.id)}>Ver comprobante</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="empty">Sin ventas</td></tr>}
        </tbody>
      </table></div>

      <div className="page-head"><h2>🍽️ Consumos propios</h2></div>
      <p className="hint">
        Salidas de inventario al costo, sin venta ni ganancia. {activeConsumptions.length} activo(s) por {formatClp(activeConsumptions.reduce((s, c) => s + c.costClp, 0))} al costo. Al anular uno, las unidades vuelven al inventario.
      </p>
      <div className="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Hora</th><th>N°</th><th>Productos</th><th>Quién / motivo</th><th>Costo</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {consumptions.map((c) => (
            <tr key={c.id} className={c.status === 'voided' ? 'voided' : ''}>
              <td>{fmtDate(c.createdAt)}</td><td>{fmtTime(c.createdAt)}</td><td>#{c.number}</td>
              <td>{c.lines.map((l) => `${l.quantity} × ${l.name}`).join(', ')}</td>
              <td>{[c.who, c.note].filter(Boolean).join(' · ') || '—'}{c.status === 'voided' && c.voidReason ? <small> (anulado: {c.voidReason})</small> : null}</td>
              <td>{formatClp(c.costClp)}</td>
              <td><span className={'pill ' + (c.status === 'voided' ? 'bad' : 'ok')}>{c.status === 'voided' ? 'anulado' : 'activo'}</span></td>
              <td>{c.status !== 'voided' && <button className="btn ghost sm" onClick={() => voidConsumption(c)}>Anular</button>}</td>
            </tr>
          ))}
          {!consumptions.length && <tr><td colSpan={8} className="empty">Sin consumos</td></tr>}
        </tbody>
      </table></div>

      {detail && (
        <Modal title={`Comprobante de venta interno · Pedido #${detail.number}`} wide onClose={() => setDetail(null)}>
          <Receipt sale={detail} />
          <ul className="items">{detail.lines.map((l) => <li key={l.productId}>{l.quantity} × {l.name} <b>{formatClp(l.unitPriceClp * l.quantity)}</b></li>)}</ul>
          {detail.status === 'voided' && <div className="alert">Venta anulada{detail.voidReason ? `: ${detail.voidReason}` : ''}.</div>}
          <p className="hint">{INTERNAL_RECEIPT_NOTICE}</p>
          <div className="row-btns">
            <button className="btn ghost" onClick={() => printReceipt(detail)}>🖨 Imprimir</button>
            {detail.status === 'completed' && <button className="btn danger" onClick={() => voidSale(detail)}>Anular venta</button>}
            <button className="btn primary" onClick={() => setDetail(null)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
