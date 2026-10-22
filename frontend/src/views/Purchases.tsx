import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PURCHASE_DOC_LABEL, PURCHASE_DOC_TYPES, addIva, formatClp, splitIva,
  type InventoryRow, type Product, type Purchase, type PurchaseDocType, type PurchaseInput,
} from '@nexus/core';
import type { PosApi } from '../api';
import { Modal } from '../components';
import { fmtDate, fmtDateTime, todayLocal } from '../format';
import { msg } from '../hooks';

const Err = ({ text }: { text: string | null }) => (text ? <div className="alert" role="alert">{text}</div> : null);
const num = (s: string) => Number(s.replace(/\D/g, '')) || 0;
const NEW = '__new__';

interface Line {
  key: number;
  /** Id del producto existente, o NEW para crear uno con la compra. */
  productId: string;
  qty: string;
  cost: string;
  name: string;
  category: string;
  /** Precio de venta NETO unitario nuevo; el valor con IVA se calcula. Vacío = no cambia el precio de un producto existente. */
  price: string;
  barcode: string;
}
const blankLine = (key: number): Line => ({ key, productId: '', qty: '', cost: '', name: '', category: '', price: '', barcode: '' });

/** Registro de una compra a un proveedor, con los datos del documento: las unidades entran al inventario como «compra». */
export function PurchaseModal({ api, branchId, onClose, onSaved }: { api: PosApi; branchId: string; onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [suppliers, setSuppliers] = useState<{ name: string; rut?: string }[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [supplierRut, setSupplierRut] = useState('');
  const [docType, setDocType] = useState<PurchaseDocType>('factura');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [lines, setLines] = useState<Line[]>([blankLine(1)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Purchase | null>(null);

  useEffect(() => {
    api.rpc.listProducts().then((p) => setProducts([...p].sort((a, b) => a.name.localeCompare(b.name, 'es'))));
    api.rpc.inventory(branchId).then((rows: InventoryRow[]) => setStock(Object.fromEntries(rows.map((r) => [r.product.id, r.physical.qty + r.online.qty]))));
    api.rpc.listSuppliers().then(setSuppliers);
  }, [api, branchId]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine(Math.max(0, ...ls.map((l) => l.key)) + 1)]);
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const net = useMemo(() => lines.reduce((n, l) => n + num(l.qty) * num(l.cost), 0), [lines]);
  const iva = Math.round(net * 0.19);
  const units = lines.reduce((n, l) => n + num(l.qty), 0);

  const pickSupplier = (name: string) => {
    setSupplierName(name);
    const known = suppliers.find((s) => s.name === name);
    if (known?.rut) setSupplierRut(known.rut);
  };

  const save = async () => {
    try {
      setBusy(true); setError(null);
      const input: PurchaseInput = {
        branchId, supplierName, supplierRut: supplierRut.trim() || undefined, docType, docNumber, docDate, note: note.trim() || undefined, updateCost,
        lines: lines.map((l) => {
          const priceNetClp = l.price.trim() ? num(l.price) : undefined;
          return l.productId === NEW
            ? { newProduct: { name: l.name, category: l.category || undefined, barcode: l.barcode.trim() || undefined }, quantity: num(l.qty), unitCostClp: num(l.cost), priceNetClp }
            : { productId: l.productId || undefined, quantity: num(l.qty), unitCostClp: num(l.cost), priceNetClp };
        }),
      };
      const missing = lines.findIndex((l) => !l.productId);
      if (missing >= 0) throw new Error(`Línea ${missing + 1}: elige un producto o crea uno nuevo`);
      const noPrice = lines.findIndex((l) => l.productId === NEW && !l.price.trim());
      if (noPrice >= 0) throw new Error(`Línea ${noPrice + 1}: indica el precio de venta neto del producto nuevo`);
      setDone(await api.rpc.registerPurchase(input));
      onSaved();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Modal title="✓ Compra registrada" onClose={onClose}>
        <div className="receipt">
          <div><span>{PURCHASE_DOC_LABEL[done.docType]} N° {done.docNumber}</span><strong>{fmtDate(`${done.docDate}T15:00:00Z`)}</strong></div>
          <div><span>Proveedor</span><span>{done.supplierName}</span></div>
          <div><span>Unidades ingresadas</span><span>{done.lines.reduce((n, l) => n + l.quantity, 0)}</span></div>
          <div><span>Neto</span><span>{formatClp(done.netClp)}</span></div>
          <div><span>IVA 19%</span><span>{formatClp(done.ivaClp)}</span></div>
          <div className="big"><span>Total</span><strong>{formatClp(done.totalClp)}</strong></div>
        </div>
        <p className="hint">Las unidades entraron al inventario de la caja como compra. Ya aparecen en la tarjeta de existencia de cada producto.</p>
        <button className="btn primary" onClick={onClose}>Cerrar</button>
      </Modal>
    );
  }

  return (
    <Modal title="🧾 Nueva compra" wide onClose={onClose}>
      <p className="hint">Registra lo que compraste con los datos del documento. Las unidades entran al inventario como <b>compra</b> (no como ajuste) y quedan en la tarjeta de existencia con su fecha.</p>
      <div className="two-col">
        <label className="field">Proveedor *
          <input list="suppliers-list" autoFocus placeholder="Razón social o nombre" value={supplierName} onChange={(e) => pickSupplier(e.target.value)} />
          <datalist id="suppliers-list">{suppliers.map((s) => <option key={s.rut ?? s.name} value={s.name} />)}</datalist>
        </label>
        <label className="field">RUT del proveedor<input placeholder="76.123.456-7 (opcional)" value={supplierRut} onChange={(e) => setSupplierRut(e.target.value)} /></label>
        <label className="field">Documento
          <select value={docType} onChange={(e) => setDocType(e.target.value as PurchaseDocType)}>
            {PURCHASE_DOC_TYPES.map((t) => <option key={t} value={t}>{PURCHASE_DOC_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="field">N° del documento *<input inputMode="numeric" placeholder="Ej: 4521" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} /></label>
        <label className="field">Fecha del documento *<input type="date" max={todayLocal()} value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>
        <label className="field">Observación<input placeholder="Opcional" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>

      <h4>Productos comprados</h4>
      <div className="purchase-lines">
        {lines.map((l, i) => {
          const existing = products.find((p) => p.id === l.productId);
          return (
            <div className="purchase-line" key={l.key}>
              <div className="row">
                <label className="field">Producto
                  <select value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value })}>
                    <option value="">Elige un producto…</option>
                    <option value={NEW}>➕ Producto nuevo</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="field">Cantidad<input inputMode="numeric" placeholder="0" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></label>
                <label className="field">Costo unit. neto<input inputMode="numeric" placeholder="$0" value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} /></label>
                <div className="line-total-box">{formatClp(num(l.qty) * num(l.cost))}</div>
                <button className="x" aria-label={`Quitar línea ${i + 1}`} disabled={lines.length === 1} onClick={() => removeLine(l.key)}>✕</button>
              </div>
              {existing && <small className="hint">Costo actual {formatClp(existing.costClp)} · precio actual {formatClp(splitIva(existing.priceClp).netClp)} neto ({formatClp(existing.priceClp)} con IVA) · existencia {stock[existing.id] ?? 0}</small>}
              {l.productId === NEW && (
                <div className="row new">
                  <label className="field">Nombre *<input placeholder="Nombre del producto" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} /></label>
                  <label className="field">Categoría<input placeholder="General" value={l.category} onChange={(e) => setLine(l.key, { category: e.target.value })} /></label>
                  <label className="field">Código de barras<input placeholder="Opcional" value={l.barcode} onChange={(e) => setLine(l.key, { barcode: e.target.value })} /></label>
                </div>
              )}
              {l.productId && (
                <div className="row price">
                  <label className="field">Precio venta neto unitario{l.productId === NEW ? ' *' : ' (nuevo)'}
                    <input inputMode="numeric" placeholder={existing ? String(splitIva(existing.priceClp).netClp) : '$0'} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                  </label>
                  <div className="price-iva">
                    {l.price.trim()
                      ? <><b>{formatClp(addIva(num(l.price)))}</b> con IVA</>
                      : existing ? <><b>{formatClp(existing.priceClp)}</b> con IVA (sin cambio)</> : <span className="hint">Se calcula con IVA</span>}
                  </div>
                  <small className="hint">{l.productId === NEW ? 'Este será el precio de venta del producto.' : 'Déjalo vacío para mantener el precio. Si lo cambias, rige desde esta compra.'}</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div><button className="btn ghost sm" onClick={addLine}>➕ Agregar otro producto</button></div>

      <label className="check"><input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} /> Actualizar el costo de los productos (promedio ponderado con lo que ya hay)</label>
      <div className="purchase-totals">
        <span>{units} unidad(es)</span><span>Neto <b>{formatClp(net)}</b></span><span>IVA 19% <b>{formatClp(iva)}</b></span><span>Total <b>{formatClp(net + iva)}</b></span>
      </div>
      <Err text={error} />
      <div className="row-btns">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={save}>Registrar compra</button>
      </div>
    </Modal>
  );
}

/** Lista de compras (por fecha del documento) con su detalle y la opción de anular. */
export function PurchasesSection({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [rows, setRows] = useState<Purchase[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await api.rpc.listPurchases({ branchId: branchId ?? undefined, from: from || undefined, to: to || undefined }));
  }, [api, branchId, from, to]);
  useEffect(() => { load().catch((e) => setError(msg(e))); }, [load]);

  const voidIt = async (p: Purchase) => {
    const reason = prompt(`Anular ${PURCHASE_DOC_LABEL[p.docType].toLowerCase()} N° ${p.docNumber}. Las unidades salen del inventario.\nMotivo (opcional):`);
    if (reason === null) return;
    try { setError(null); await api.rpc.voidPurchase(p.id, reason); setDetail(null); await load(); } catch (e) { setError(msg(e)); setDetail(null); }
  };
  const active = rows.filter((r) => r.status === 'active');

  return (
    <>
      <div className="page-head"><h2>Compras</h2>{branchId && <button className="btn primary sm" onClick={() => setOpen(true)}>🧾 Nueva compra</button>}</div>
      <p className="hint">Compras a proveedores por fecha del documento. {active.length} activa(s) por {formatClp(active.reduce((n, r) => n + r.totalClp, 0))} con IVA.</p>
      <div className="filters">
        <label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn ghost sm" onClick={() => { setFrom(''); setTo(''); }}>Limpiar</button>
      </div>
      <Err text={error} />
      <div className="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Unidades</th><th>Neto</th><th>IVA</th><th>Total</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={p.status === 'voided' ? 'voided' : ''}>
              <td>{fmtDate(`${p.docDate}T15:00:00Z`)}</td><td>{p.supplierName}{p.supplierRut && <><br /><small>{p.supplierRut}</small></>}</td>
              <td>{PURCHASE_DOC_LABEL[p.docType]} N° {p.docNumber}</td><td>{p.lines.reduce((n, l) => n + l.quantity, 0)}</td>
              <td>{formatClp(p.netClp)}</td><td>{formatClp(p.ivaClp)}</td><td>{formatClp(p.totalClp)}</td>
              <td><span className={'pill ' + (p.status === 'voided' ? 'bad' : 'ok')}>{p.status === 'voided' ? 'anulada' : 'activa'}</span></td>
              <td><button className="btn ghost sm" onClick={() => setDetail(p)}>Detalle</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={9} className="empty">Sin compras registradas</td></tr>}
        </tbody>
      </table></div>

      {open && branchId && <PurchaseModal api={api} branchId={branchId} onClose={() => setOpen(false)} onSaved={() => { load().catch(() => undefined); }} />}
      {detail && (
        <Modal title={`${PURCHASE_DOC_LABEL[detail.docType]} N° ${detail.docNumber}`} wide onClose={() => setDetail(null)}>
          <dl className="kv">
            <div><dt>Proveedor</dt><dd>{detail.supplierName}{detail.supplierRut ? ` · ${detail.supplierRut}` : ''}</dd></div>
            <div><dt>Fecha del documento</dt><dd>{fmtDate(`${detail.docDate}T15:00:00Z`)}</dd></div>
            <div><dt>Registrada</dt><dd>{fmtDateTime(detail.createdAt)}</dd></div>
            {detail.note && <div><dt>Observación</dt><dd>{detail.note}</dd></div>}
          </dl>
          <div className="table-wrap"><table>
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unit. neto</th><th>Precio venta neto unit.</th><th>Total</th></tr></thead>
            <tbody>{detail.lines.map((l, i) => (
              <tr key={i}><td>{l.name}</td><td>{l.quantity}</td><td>{formatClp(l.unitCostClp)}</td>
                <td>{l.priceNetClp !== undefined ? <>{formatClp(l.priceNetClp)}<br /><small>{formatClp(l.priceClp ?? 0)} con IVA</small></> : '—'}</td><td>{formatClp(l.totalClp)}</td></tr>
            ))}</tbody>
            <tfoot>
              <tr><td colSpan={4}>Neto</td><td>{formatClp(detail.netClp)}</td></tr>
              <tr><td colSpan={4}>IVA 19%</td><td>{formatClp(detail.ivaClp)}</td></tr>
              <tr><td colSpan={4}><b>Total</b></td><td><b>{formatClp(detail.totalClp)}</b></td></tr>
            </tfoot>
          </table></div>
          {detail.status === 'voided' && <div className="alert">Compra anulada{detail.voidReason ? `: ${detail.voidReason}` : ''}. Las unidades salieron del inventario.</div>}
          <div className="row-btns">
            {detail.status === 'active' && <button className="btn danger" onClick={() => voidIt(detail)}>Anular compra</button>}
            <button className="btn primary" onClick={() => setDetail(null)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </>
  );
}
