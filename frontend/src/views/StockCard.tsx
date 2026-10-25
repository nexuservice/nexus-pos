import { useEffect, useState } from 'react';
import { addIva, formatClp, splitIva, type Channel, type Product, type StockCard } from '@nexus/core';
import type { PosApi } from '../api';
import { Modal, Receipt, printReceipt } from '../components';
import { fmtDate, fmtTime, printHtml, stockCardHtml } from '../format';
import { msg, type SaleDetail } from '../hooks';

type View = Channel | 'all';
const VIEWS: [View, string][] = [['all', 'Total'], ['physical', 'Caja'], ['online', 'Online']];

/**
 * Corrige o sube el precio de venta de un producto digitando el neto. Rige desde ahora: las ventas ya hechas
 * conservan el precio al que se vendieron.
 */
export function PriceModal({ api, product, onClose, onSaved }: { api: PosApi; product: Product; onClose: () => void; onSaved: () => void }) {
  const currentNet = splitIva(product.priceClp).netClp;
  const [net, setNet] = useState(String(currentNet));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Number(net.replace(/\D/g, '')) || 0;
  const gross = addIva(value);

  const save = async () => {
    try {
      setBusy(true); setError(null);
      await api.rpc.setProductPrice(product.id, value, reason);
      onSaved();
      onClose();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`✏️ Editar precio · ${product.name}`} onClose={onClose}>
      <p className="hint">Rige desde ahora. Las ventas ya hechas <b>no cambian</b>: conservan el precio al que se vendieron.</p>
      <div className="receipt">
        <div><span>Precio actual neto</span><strong>{formatClp(currentNet)}</strong></div>
        <div><span>Con IVA</span><span>{formatClp(product.priceClp)}</span></div>
        <div><span>Costo unitario</span><span>{formatClp(product.costClp)}</span></div>
      </div>
      <label className="field">Nuevo precio de venta neto unitario
        <input inputMode="numeric" autoFocus value={net} onChange={(e) => setNet(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && save()} />
      </label>
      <div className="receipt"><div className="big"><span>Nuevo precio con IVA</span><strong>{formatClp(gross)}</strong></div></div>
      {value < product.costClp && <div className="alert" role="alert">El precio neto queda bajo el costo ({formatClp(product.costClp)}): venderías con pérdida.</div>}
      <label className="field">Motivo (opcional)
        <input placeholder="Ej: error al digitar la compra" value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && save()} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="row-btns">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || gross === product.priceClp} onClick={save}>Guardar precio</button>
      </div>
    </Modal>
  );
}

/** Libro de existencias: fecha, detalle, unidades (entrada, salida, saldo) y valores (entrada, salida, saldo), de arriba hacia abajo. */
function Ledger({ card, from, showChannel, onOpenSale }: { card: StockCard; from: string; showChannel: boolean; onOpenSale: (saleId: string) => void }) {
  // Sin fecha de inicio, el inventario inicial cuenta como una entrada; con ella, es solo el saldo que se arrastra.
  const openingIsEntry = !from;
  const showOpening = card.openingQty !== 0 || !!from;
  const rows = [...card.rows].reverse();
  const perUnit = (value: number, qty: number) => `${qty} × ${formatClp(value / qty)}`;
  const totalEntries = card.entries + (openingIsEntry ? card.openingQty : 0);
  const totalEntryValue = card.entryValueClp + (openingIsEntry ? card.openingValueClp : 0);
  return (
    <div className="table-wrap stock-card">
      <table className="ledger">
        <thead>
          <tr><th rowSpan={2}>Fecha</th><th rowSpan={2}>Detalle</th><th colSpan={3} className="grp">Unidades</th><th colSpan={3} className="grp sep">Valores</th></tr>
          <tr>
            <th className="num">Entrada</th><th className="num">Salida</th><th className="num">Saldo</th>
            <th className="num sep" title="Entradas al costo">Entrada</th><th className="num" title="Salidas al costo promedio">Salida</th><th className="num" title="Unidades × costo: queda en $0 cuando las unidades llegan a 0">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {showOpening && (
            <tr className="opening">
              <td>{from ? fmtDate(`${from}T15:00:00Z`) : '—'}</td>
              <td>{from ? 'Saldo inicial del período' : 'Inventario inicial'}</td>
              <td className="num up">{openingIsEntry && card.openingQty ? `+${card.openingQty}` : ''}</td><td className="num" /><td className="num"><b>{card.openingQty}</b></td>
              <td className="num up sep">{openingIsEntry && card.openingQty ? <>{formatClp(card.openingValueClp)}<small>{perUnit(card.openingValueClp, card.openingQty)}</small></> : ''}</td>
              <td className="num" /><td className="num"><b>{formatClp(card.openingValueClp)}</b></td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className={r.type === 'price' ? 'price-row' : ''}>
              <td>{fmtDate(r.at)}</td>
              <td>
                {r.saleId ? <button className="link-btn" title="Ver y reimprimir el comprobante" onClick={() => onOpenSale(r.saleId!)}>{r.detail}</button> : r.detail}
                {(r.type === 'sale' || r.type === 'purchase') && <small>Precio de venta {formatClp(r.unitPriceNetClp)} neto · {formatClp(r.unitPriceClp)} c/IVA</small>}
                {showChannel && r.channel === 'online' && <small>Online</small>}
              </td>
              <td className="num up">{r.entry ? `+${r.entry}` : ''}</td><td className="num down">{r.exit ? `−${r.exit}` : ''}</td><td className="num"><b>{r.balance}</b></td>
              <td className="num up sep">{r.entryValueClp !== undefined ? <>{formatClp(r.entryValueClp)}<small>{perUnit(r.entryValueClp, r.entry)}</small></> : ''}</td>
              <td className="num down">{r.exitValueClp !== undefined ? <>{formatClp(r.exitValueClp)}<small>{perUnit(r.exitValueClp, r.exit)}</small></> : ''}</td>
              <td className="num"><b>{formatClp(r.balanceValueClp)}</b></td>
            </tr>
          ))}
          {!rows.length && !showOpening && <tr><td colSpan={8} className="empty">Sin movimientos en este período</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}><b>Totales</b></td>
            <td className="num up"><b>{totalEntries}</b></td><td className="num down"><b>{card.exits}</b></td><td className="num"><b>{card.closingQty}</b></td>
            <td className="num up sep"><b>{formatClp(totalEntryValue)}</b></td><td className="num down"><b>{formatClp(card.exitValueClp)}</b></td><td className="num"><b>{formatClp(card.closingValueClp)}</b></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Tarjeta de existencia (kardex) de un producto: entradas, salidas y saldo después de cada movimiento. */
export function StockCardModal({ api, branchId, product, onClose, onChanged }: { api: PosApi; branchId: string; product: Product; onClose: () => void; onChanged?: () => void }) {
  const [view, setView] = useState<View>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [card, setCard] = useState<StockCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [version, setVersion] = useState(0);

  const openSale = async (id: string) => {
    try { setError(null); setSale(await api.rpc.getSale(id)); } catch (e) { setError(msg(e)); }
  };

  useEffect(() => {
    setError(null);
    api.rpc.stockCard(branchId, product.id, view, from || null, to || null).then(setCard).catch((e) => setError(msg(e)));
  }, [api, branchId, product.id, view, from, to, version]);

  const showChannel = view === 'all';

  // El editor de precio se muestra en lugar de la tarjeta; al cerrarlo se vuelve a la tarjeta con sus filtros.
  if (editingPrice && card) {
    return <PriceModal api={api} product={card.product} onClose={() => setEditingPrice(false)} onSaved={() => { setVersion((v) => v + 1); onChanged?.(); }} />;
  }

  // El comprobante se muestra en lugar de la tarjeta; al cerrarlo se vuelve a la tarjeta con sus filtros.
  if (sale) {
    return (
      <Modal title={`Comprobante de venta interno · Pedido #${sale.number}`} wide onClose={() => setSale(null)}>
        <Receipt sale={sale} />
        <ul className="items">{sale.lines.map((l) => <li key={l.productId}>{l.quantity} × {l.name} <b>{formatClp(l.unitPriceClp * l.quantity)}</b></li>)}</ul>
        {sale.status === 'voided' && <div className="alert">Venta anulada{sale.voidReason ? `: ${sale.voidReason}` : ''}.</div>}
        <div className="row-btns">
          <button className="btn ghost" onClick={() => printReceipt(sale)}>🖨 Reimprimir comprobante</button>
          <button className="btn primary" onClick={() => setSale(null)}>Volver a la tarjeta</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Tarjeta de existencia · ${product.name}`} xwide className="stock-modal" onClose={onClose}
      header={(
        <div className="stock-head">
          <h3 className="modal-title">📇 {product.name}</h3>
          <span className="sku">Tarjeta de existencia · SKU {product.sku} · Código {product.barcode}</span>
          <span className="spacer" />
          <button className="btn ghost sm" disabled={!card} onClick={() => card && printHtml(stockCardHtml(card, { from: from || undefined, to: to || undefined }), 'sheet')}>🖨 Imprimir</button>
          <button className="btn primary sm" onClick={onClose}>Cerrar</button>
        </div>
      )}
    >
      <div className="stock-top">
        <div className="stock-filters">
          <div className="seg">{VIEWS.map(([v, label]) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>)}</div>
          <label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn ghost sm" onClick={() => { setFrom(''); setTo(''); }}>Limpiar</button>
        </div>
        {card && (
          <div className="stock-stats">
            <div className="stock-stat"><span>Existencia actual</span><strong>{card.currentQty}</strong>{card.reservedQty > 0 && <small>{card.reservedQty} reservada(s)</small>}</div>
            <div className="stock-stat"><span>Costo unitario</span><strong>{formatClp(card.product.costClp)}</strong></div>
            <div className="stock-stat"><span>Precio neto de venta</span><strong>{formatClp(splitIva(card.product.priceClp).netClp)}</strong><small>{formatClp(card.product.priceClp)} con IVA</small></div>
            <button className="btn ghost sm" onClick={() => setEditingPrice(true)}>✏️ Editar precio</button>
          </div>
        )}
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {card && (
        <>
          <Ledger card={card} from={from} showChannel={showChannel} onOpenSale={openSale} />
          <details className="stock-help">
            <summary>ℹ️ Cómo se calcula</summary>
            <p>
              En orden cronológico: el saldo corre hacia abajo. Los valores van todos al costo: las entradas, al costo de esa entrada (el inventario inicial, al costo que había antes del primer movimiento), y las salidas, al costo promedio del saldo en ese momento. Por eso el saldo en valores es lo que queda en bodega y llega a $0 cuando las unidades llegan a 0. El precio de venta de cada venta se muestra debajo del detalle.
              {showChannel && ' En la vista Total no aparecen los traspasos entre caja y online, porque no cambian la existencia total.'}
            </p>
          </details>
        </>
      )}
    </Modal>
  );
}
