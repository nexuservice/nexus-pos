import { useCallback, useEffect, useRef, useState } from 'react';
import { addIva, formatClp, splitIva, type Product } from '@nexus/core';
import type { PosApi } from '../api';
import { fmtTime } from '../format';
import { msg } from '../hooks';

interface Draft {
  barcode: string;
  existing: Product | null;
  name: string;
  category: string;
  cost: string;
  priceNet: string;
  qty: string;
  published: boolean;
}
interface LogRow { at: string; name: string; qty: number; stock: number; created: boolean }

const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/\D/g, '')));

/**
 * Ingreso de inventario "pistoleando": se escanea el código de barras y el producto se crea (si no existe)
 * o suma stock (si existe). Pensado para cargar el inventario inicial de un negocio nuevo.
 */
export function ReceiveSection({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [code, setCode] = useState('');
  const [quick, setQuick] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadCategories = useCallback(async () => {
    setCategories([...new Set((await api.rpc.listProducts()).map((p) => p.category))].sort());
  }, [api]);
  useEffect(() => { loadCategories().catch(() => undefined); }, [loadCategories]);
  useEffect(() => { if (!draft) inputRef.current?.focus(); }, [draft]);

  const record = (name: string, qty: number, stock: number, created: boolean) =>
    setLog((l) => [{ at: new Date().toISOString(), name, qty, stock, created }, ...l].slice(0, 20));

  const scan = async () => {
    const barcode = code.trim();
    if (!barcode || !branchId) return;
    setError(null);
    setCode('');
    try {
      const existing = await api.rpc.findProduct(barcode);
      if (existing && quick) {
        const r = await api.rpc.receiveStock(branchId, { barcode, quantity: 1 });
        record(r.product.name, 1, r.qty, false);
        return;
      }
      setDraft({
        barcode, existing, name: existing?.name ?? '', category: existing?.category ?? '',
        cost: existing ? String(existing.costClp) : '', priceNet: existing ? String(splitIva(existing.priceClp).netClp) : '',
        qty: '1', published: existing?.published ?? true,
      });
    } catch (e) {
      setError(msg(e));
    }
  };

  const save = async () => {
    if (!draft || !branchId) return;
    try {
      setBusy(true);
      setError(null);
      const r = await api.rpc.receiveStock(branchId, {
        barcode: draft.barcode, quantity: num(draft.qty) ?? 1, name: draft.name, category: draft.category,
        costClp: num(draft.cost), priceNetClp: num(draft.priceNet), published: draft.published,
      });
      record(r.product.name, num(draft.qty) ?? 1, r.qty, r.created);
      setDraft(null);
      await loadCategories();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const netBelowCost = draft && num(draft.priceNet) !== undefined && num(draft.cost) !== undefined && num(draft.priceNet)! < num(draft.cost)!;

  return (
    <>
      <div className="page-head"><h2>Ingreso por escaneo</h2></div>
      <p className="hint">Escanea o escribe el código de barras y presiona Enter. Si el producto no existe, lo creas con su costo y precio; si ya existe, suma stock.</p>

      <div className="scan-bar">
        <input ref={inputRef} className="search barcode" placeholder="Escanea el código de barras…" inputMode="numeric" value={code} disabled={!!draft}
          onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan()} aria-label="Código de barras" />
        <label className="check"><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> Sumar 1 unidad al escanear un producto que ya existe</label>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}

      {draft && (
        <div className="inline-form">
          <h4>{draft.existing ? `Ingreso de ${draft.existing.name}` : 'Producto nuevo'} <code>{draft.barcode}</code></h4>
          {!draft.existing && <p className="hint">Este código no está en tu inventario. Completa los datos para crearlo.</p>}
          <div className="two-col">
            {!draft.existing && <label className="field">Nombre *<input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>}
            {!draft.existing && (
              <label className="field">Categoría
                <input list="categorias" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Ej: Bebidas" />
                <datalist id="categorias">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
            )}
            <label className="field">Cantidad *<input inputMode="numeric" autoFocus={!!draft.existing} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></label>
            <label className="field">Costo neto unitario<input inputMode="numeric" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /></label>
            <label className="field">Precio de venta neto{!draft.existing && ' *'}
              <input inputMode="numeric" value={draft.priceNet} onChange={(e) => setDraft({ ...draft, priceNet: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && save()} />
              {num(draft.priceNet) !== undefined && <small>Con IVA: <b>{formatClp(addIva(num(draft.priceNet)!))}</b></small>}
            </label>
            {!draft.existing && <label className="check"><input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} /> Visible en la tienda online</label>}
          </div>
          {netBelowCost && <div className="alert" role="alert">El precio neto queda bajo el costo: venderías con pérdida.</div>}
          <div className="row-btns">
            <button className="btn ghost" onClick={() => { setDraft(null); setError(null); }}>Cancelar</button>
            <button className="btn primary" disabled={busy} onClick={save}>{draft.existing ? 'Agregar al inventario' : 'Crear y agregar'}</button>
          </div>
        </div>
      )}

      <h3 className="section-title">Ingresos de esta sesión</h3>
      {log.length === 0 ? <p className="empty">Todavía no escaneas nada.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Hora</th><th>Producto</th><th>Ingresó</th><th>Stock en caja</th></tr></thead>
          <tbody>{log.map((r, i) => (
            <tr key={i}><td>{fmtTime(r.at)}</td><td>{r.name} {r.created && <span className="pill ok">nuevo</span>}</td><td>+{r.qty}</td><td>{r.stock}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
