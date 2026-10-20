import { useCallback, useEffect, useState } from 'react';
import { PAY_METHOD_LABEL, formatClp, type Sale } from '@nexus/core';
import type { PosApi } from '../api';
import { Modal, Receipt, printReceipt } from '../components';
import { download, fmtDate, fmtTime, toCsv } from '../format';
import { msg, type SaleDetail } from '../hooks';

type Row = Sale & { folio: number | null };

export function HistoryView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [scope, setScope] = useState<'all' | 'shift'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [showXml, setShowXml] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const shift = scope === 'shift' ? await api.rpc.currentShift() : null;
    setRows(await api.rpc.listSales({ branchId: branchId ?? undefined, from: from || undefined, to: to || undefined, shiftId: shift?.id ?? (scope === 'shift' ? 'none' : undefined), limit: 100 }));
  }, [api, branchId, scope, from, to]);
  useEffect(() => { load().catch((e) => setError(msg(e))); }, [load]);

  const done = rows.filter((r) => r.status === 'completed');
  const total = done.reduce((s, r) => s + r.totalClp, 0);

  const open = async (id: string) => { setShowXml(false); setDetail(await api.rpc.getSale(id)); };
  const voidSale = async (s: SaleDetail) => {
    const reason = prompt('Motivo de la anulación (opcional):');
    if (reason === null) return;
    try { await api.rpc.voidSale(s.id, reason); setDetail(null); await load(); } catch (e) { setError(msg(e)); }
  };

  return (
    <div className="page wide-page">
      <div className="page-head">
        <h1>🧾 Historial de ventas</h1>
        <div className="head-actions">
          <button className="btn ghost sm" onClick={() => download('historial.csv', toCsv([
            ['N°', 'Folio', 'Fecha', 'Hora', 'Cajero', 'Canal', 'Medio', 'Total', 'Estado'],
            ...rows.map((r) => [r.number, r.folio, fmtDate(r.paidAt), fmtTime(r.paidAt), r.cashierName ?? '', r.channel === 'online' ? 'Online' : 'Caja', PAY_METHOD_LABEL[r.method], r.totalClp, r.status === 'voided' ? 'Anulada' : 'Completada']),
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
        <thead><tr><th>Fecha</th><th>Hora</th><th>Folio</th><th>Canal</th><th>Medio</th><th>Total</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status === 'voided' ? 'voided' : ''}>
              <td>{fmtDate(r.paidAt)}</td><td>{fmtTime(r.paidAt)}</td><td>#{r.folio ?? r.number}</td><td>{r.channel === 'online' ? 'Online' : r.cashierName ?? 'Caja'}</td>
              <td>{PAY_METHOD_LABEL[r.method]}</td><td>{formatClp(r.totalClp)}</td>
              <td><span className={'pill ' + (r.status === 'completed' ? 'ok' : 'bad')}>{r.status === 'completed' ? 'completada' : 'anulada'}</span></td>
              <td><button className="btn ghost sm" onClick={() => open(r.id)}>Ver boleta</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="empty">Sin ventas</td></tr>}
        </tbody>
      </table></div>

      {detail && (
        <Modal title={`Boleta N° ${detail.document?.folio ?? '—'}`} wide onClose={() => setDetail(null)}>
          <Receipt sale={detail} />
          <ul className="items">{detail.lines.map((l) => <li key={l.productId}>{l.quantity} × {l.name} <b>{formatClp(l.unitPriceClp * l.quantity)}</b></li>)}</ul>
          {detail.status === 'voided' && <div className="alert">Venta anulada{detail.voidReason ? `: ${detail.voidReason}` : ''}. Para el SII corresponde emitir una nota de crédito electrónica.</div>}
          {showXml && detail.document && <pre className="xml">{detail.document.xml.replace(/></g, '>\n<')}</pre>}
          <div className="row-btns">
            {detail.document && <button className="btn ghost" onClick={() => setShowXml(!showXml)}>{showXml ? 'Ocultar XML' : 'Ver XML (DTE 39)'}</button>}
            <button className="btn ghost" onClick={() => printReceipt(detail)}>🖨 Imprimir</button>
            {detail.status === 'completed' && <button className="btn danger" onClick={() => voidSale(detail)}>Anular venta</button>}
            <button className="btn primary" onClick={() => setDetail(null)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
