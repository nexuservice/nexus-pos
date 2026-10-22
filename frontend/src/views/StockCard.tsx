import { useEffect, useState } from 'react';
import { formatClp, splitIva, type Channel, type Product, type StockCard } from '@nexus/core';
import type { PosApi } from '../api';
import { Modal, Receipt, printReceipt } from '../components';
import { fmtDate, fmtTime, printHtml, stockCardHtml } from '../format';
import { msg, type SaleDetail } from '../hooks';

type View = Channel | 'all';
const VIEWS: [View, string][] = [['all', 'Total'], ['physical', 'Caja'], ['online', 'Online']];

/** Tarjeta de existencia (kardex) de un producto: entradas, salidas y saldo después de cada movimiento. */
export function StockCardModal({ api, branchId, product, onClose }: { api: PosApi; branchId: string; product: Product; onClose: () => void }) {
  const [view, setView] = useState<View>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [card, setCard] = useState<StockCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sale, setSale] = useState<SaleDetail | null>(null);

  const openSale = async (id: string) => {
    try { setError(null); setSale(await api.rpc.getSale(id)); } catch (e) { setError(msg(e)); }
  };

  useEffect(() => {
    setError(null);
    api.rpc.stockCard(branchId, product.id, view, from || null, to || null).then(setCard).catch((e) => setError(msg(e)));
  }, [api, branchId, product.id, view, from, to]);

  const showChannel = view === 'all';

  // La boleta se muestra en lugar de la tarjeta; al cerrarla se vuelve a la tarjeta con sus filtros.
  if (sale) {
    return (
      <Modal title={`Boleta N° ${sale.document?.folio ?? '—'} · Venta #${sale.number}`} wide onClose={() => setSale(null)}>
        <Receipt sale={sale} />
        <ul className="items">{sale.lines.map((l) => <li key={l.productId}>{l.quantity} × {l.name} <b>{formatClp(l.unitPriceClp * l.quantity)}</b></li>)}</ul>
        {sale.status === 'voided' && <div className="alert">Venta anulada{sale.voidReason ? `: ${sale.voidReason}` : ''}.</div>}
        <div className="row-btns">
          <button className="btn ghost" onClick={() => printReceipt(sale)}>🖨 Reimprimir boleta</button>
          <button className="btn primary" onClick={() => setSale(null)}>Volver a la tarjeta</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`📇 Tarjeta de existencia · ${product.name}`} xwide onClose={onClose}>
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
            <div className="kpi"><span>Precio neto de venta (unitario)</span><strong>{formatClp(splitIva(card.product.priceClp).netClp)}</strong><small>{formatClp(card.product.priceClp)} con IVA</small></div>
          </div>
          <div className="table-wrap stock-card"><table>
            <thead><tr>
              <th>Fecha</th><th>Detalle</th>{showChannel && <th>Canal</th>}
              <th className="num">Entrada</th><th className="num">Salida</th><th className="num">Saldo</th>
              <th className="num" title="Costo neto unitario vigente en ese movimiento">Costo unit.</th>
              <th className="num" title="Precio de venta neto unitario vigente en ese movimiento (con IVA debajo)">Precio venta neto unit.</th>
              <th className="num" title="Cantidad de entrada × costo">Valor entrada</th>
              <th className="num" title="Cantidad de salida × precio de venta neto (consumos y anulaciones de compra, al costo)">Valor salida</th>
            </tr></thead>
            <tbody>
              {card.rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.at)}{r.dateOnly ? '' : ` ${fmtTime(r.at)}`}</td>
                  <td>{r.saleId ? <button className="link-btn" title="Ver y reimprimir la boleta" onClick={() => openSale(r.saleId!)}>{r.detail}</button> : r.detail}</td>{showChannel && <td>{r.channel === 'physical' ? 'Caja' : 'Online'}</td>}
                  <td className="num up">{r.entry ? `+${r.entry}` : ''}</td><td className="num down">{r.exit ? `−${r.exit}` : ''}</td><td className="num"><b>{r.balance}</b></td>
                  <td className="num">{formatClp(r.unitCostClp)}</td>
                  <td className="num">{formatClp(r.unitPriceNetClp)}<small>{formatClp(r.unitPriceClp)} c/IVA</small></td>
                  <td className="num up">{r.entryValueClp !== undefined ? formatClp(r.entryValueClp) : ''}</td>
                  <td className="num down">{r.exitValueClp !== undefined ? formatClp(r.exitValueClp) : ''}</td>
                </tr>
              ))}
              {!card.rows.length && <tr><td colSpan={showChannel ? 10 : 9} className="empty">Sin movimientos en este período</td></tr>}
              <tr className="opening"><td colSpan={showChannel ? 5 : 4}><i>Saldo inicial</i></td><td className="num"><b>{card.openingQty}</b></td><td colSpan={4} /></tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showChannel ? 3 : 2}><b>Totales del período</b></td>
                <td className="num up"><b>{card.entries}</b></td><td className="num down"><b>{card.exits}</b></td><td className="num"><b>{card.closingQty}</b></td><td colSpan={2} />
                <td className="num up"><b>{formatClp(card.entryValueClp)}</b></td><td className="num down"><b>{formatClp(card.exitValueClp)}</b></td>
              </tr>
            </tfoot>
          </table></div>
          <p className="hint">
            Las entradas se valoran al costo y las salidas por venta al precio de venta neto de ese día; los consumos y las anulaciones de compra, al costo. Los traspasos no se valoran.
            {showChannel && ' En la vista Total no aparecen los traspasos entre caja y online, porque no cambian la existencia total.'}
          </p>
        </>
      )}
      <div className="row-btns">
        <button className="btn ghost" disabled={!card} onClick={() => card && printHtml(stockCardHtml(card, { from: from || undefined, to: to || undefined }), 'sheet')}>🖨 Imprimir</button>
        <button className="btn primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}
