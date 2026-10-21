import { useEffect, useState } from 'react';
import { formatClp, type Channel, type Product, type StockCard } from '@nexus/core';
import type { PosApi } from '../api';
import { Modal } from '../components';
import { fmtDate, fmtTime, printHtml, stockCardHtml } from '../format';
import { msg } from '../hooks';

type View = Channel | 'all';
const VIEWS: [View, string][] = [['all', 'Total'], ['physical', 'Caja'], ['online', 'Online']];

/** Tarjeta de existencia (kardex) de un producto: entradas, salidas y saldo después de cada movimiento. */
export function StockCardModal({ api, branchId, product, onClose }: { api: PosApi; branchId: string; product: Product; onClose: () => void }) {
  const [view, setView] = useState<View>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [card, setCard] = useState<StockCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.rpc.stockCard(branchId, product.id, view, from || null, to || null).then(setCard).catch((e) => setError(msg(e)));
  }, [api, branchId, product.id, view, from, to]);

  const showChannel = view === 'all';
  return (
    <Modal title={`📇 Tarjeta de existencia · ${product.name}`} wide onClose={onClose}>
      <p className="hint">SKU {product.sku} · Código {product.barcode}</p>
      <div className="filters">
        <div className="seg">{VIEWS.map(([v, label]) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>)}</div>
        <label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn ghost sm" onClick={() => { setFrom(''); setTo(''); }}>Limpiar</button>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {card && (
        <>
          <div className="kpis">
            <div className="kpi"><span>Existencia actual</span><strong>{card.currentQty}</strong>{card.reservedQty > 0 && <small>{card.reservedQty} reservada(s)</small>}</div>
            <div className="kpi"><span>Costo unitario</span><strong>{formatClp(card.product.costClp)}</strong></div>
            <div className="kpi"><span>Valor al costo</span><strong>{formatClp(card.currentQty * card.product.costClp)}</strong></div>
          </div>
          <div className="table-wrap stock-card"><table>
            <thead><tr><th>Fecha</th><th>Detalle</th>{showChannel && <th>Canal</th>}<th className="num">Entrada</th><th className="num">Salida</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              {card.rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.at)} {fmtTime(r.at)}</td><td>{r.detail}</td>{showChannel && <td>{r.channel === 'physical' ? 'Caja' : 'Online'}</td>}
                  <td className="num up">{r.entry ? `+${r.entry}` : ''}</td><td className="num down">{r.exit ? `−${r.exit}` : ''}</td><td className="num"><b>{r.balance}</b></td>
                </tr>
              ))}
              {!card.rows.length && <tr><td colSpan={showChannel ? 6 : 5} className="empty">Sin movimientos en este período</td></tr>}
              <tr className="opening"><td colSpan={showChannel ? 5 : 4}><i>Saldo inicial</i></td><td className="num"><b>{card.openingQty}</b></td></tr>
            </tbody>
            <tfoot>
              <tr><td colSpan={showChannel ? 3 : 2}><b>Totales del período</b></td><td className="num up"><b>{card.entries}</b></td><td className="num down"><b>{card.exits}</b></td><td className="num"><b>{card.closingQty}</b></td></tr>
            </tfoot>
          </table></div>
          {showChannel && <p className="hint">En la vista Total no aparecen los traspasos entre caja y online, porque no cambian la existencia total.</p>}
        </>
      )}
      <div className="row-btns">
        <button className="btn ghost" disabled={!card} onClick={() => card && printHtml(stockCardHtml(card, { from: from || undefined, to: to || undefined }), 'sheet')}>🖨 Imprimir</button>
        <button className="btn primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}
