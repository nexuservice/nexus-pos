import { useCallback, useEffect, useState } from 'react';
import {
  PAY_METHODS, PAY_METHOD_LABEL, addIva, formatClp, splitIva,
  type Cashier, type ClientWithDebt, type InventoryRow, type Product, type Promotion, type Shift,
} from '@nexus/core';
import type { PosApi } from '../api';
import { DebtModal } from '../components';
import { BusinessSection } from './Business';
import { ReceiveSection } from './Receive';
import { PurchasesSection } from './Purchases';
import { PriceModal, StockCardModal } from './StockCard';
import { fmtDateTime } from '../format';
import { resizeToJpeg } from '../image';
import { PhotoCapture } from '../PhotoCapture';
import { ProductPhoto } from '../ProductPhoto';
import { msg } from '../hooks';
import { PromoForm } from './PosModals';

type Section = 'inventory' | 'receive' | 'clients' | 'cashiers' | 'promos' | 'shifts' | 'business';
const SECTIONS: [Section, string][] = [
  ['inventory', '📦 Inventario'], ['receive', '📥 Ingresar mercadería'], ['clients', '👥 Clientes'], ['cashiers', '👤 Cajeros'],
  ['promos', '🎫 Descuentos y promociones'], ['shifts', '🕐 Jornadas'], ['business', '🏪 Mi negocio'],
];

const Err = ({ text }: { text: string | null }) => (text ? <div className="alert" role="alert">{text}</div> : null);

export function AdminView({ api, branchId, storeSlug }: { api: PosApi; branchId: string | null; storeSlug?: string | null }) {
  const [section, setSection] = useState<Section>('inventory');
  return (
    <div className="admin">
      <nav className="side" aria-label="Administración">
        {SECTIONS.map(([id, label]) => <button key={id} className={id === section ? 'on' : ''} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      <div className="admin-body">
        {section === 'receive' && <ReceiveHub api={api} branchId={branchId} />}
        {section === 'business' && <BusinessSection api={api} storeSlug={storeSlug} />}
        {section === 'clients' && <Clients api={api} />}
        {section === 'cashiers' && <Cashiers api={api} />}
        {section === 'promos' && <Promos api={api} />}
        {section === 'inventory' && <Inventory api={api} branchId={branchId} storeSlug={storeSlug} />}
        {section === 'shifts' && <Shifts api={api} />}
      </div>
    </div>
  );
}

function useList<T>(load: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  const reload = useCallback(async () => setRows(await load()), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload().catch(() => undefined); }, [reload]);
  return [rows, reload] as const;
}

/** Ingresar mercadería: escanear es lo normal y lo más rápido; «con factura» queda para guardar los datos del documento del proveedor. */
function ReceiveHub({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [mode, setMode] = useState<'scan' | 'invoice'>('scan');
  return (
    <>
      <div className="chips" role="tablist" aria-label="Cómo ingresar mercadería">
        <button className={'chip' + (mode === 'scan' ? ' on' : '')} onClick={() => setMode('scan')}>📥 Escanear (lo más rápido)</button>
        <button className={'chip' + (mode === 'invoice' ? ' on' : '')} onClick={() => setMode('invoice')}>🧾 Con factura del proveedor</button>
      </div>
      {mode === 'scan' ? <ReceiveSection api={api} branchId={branchId} /> : <PurchasesSection api={api} branchId={branchId} />}
    </>
  );
}

function Clients({ api }: { api: PosApi }) {
  const [rows, reload] = useList(() => api.rpc.listClients());
  const blank = { name: '', rut: '', email: '', phone: '', isVip: false, creditAuthorized: false, creditLimit: '' };
  const [f, setF] = useState<typeof blank & { id?: string }>(blank);
  const [open, setOpen] = useState(false);
  const [debtOf, setDebtOf] = useState<ClientWithDebt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      setError(null);
      const { creditLimit, ...rest } = f;
      const digits = creditLimit.replace(/\D/g, '');
      await api.rpc.upsertClient({ ...rest, creditLimitClp: f.creditAuthorized && digits ? Number(digits) : null });
      setOpen(false); setF(blank); await reload(); } catch (e) { setError(msg(e)); }
  };
  return (
    <>
      <div className="page-head"><h2>Clientes</h2><button className="btn primary sm" onClick={() => { setF(blank); setOpen(true); }}>➕ Nuevo cliente</button></div>
      <p className="hint">Los clientes registrados aparecen en la búsqueda inteligente de la caja (nombre o RUT).</p>
      {open && (
        <div className="inline-form">
          <div className="two-col">
            <label className="field">Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">RUT<input value={f.rut} onChange={(e) => setF({ ...f, rut: e.target.value })} /></label>
            <label className="field">Correo<input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label className="field">Teléfono<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={f.isVip} onChange={(e) => setF({ ...f, isVip: e.target.checked })} /> Cliente VIP</label>
            <label className="check"><input type="checkbox" checked={f.creditAuthorized} onChange={(e) => setF({ ...f, creditAuthorized: e.target.checked })} /> Autorizado para convenio (crédito) — requiere RUT</label>
            {f.creditAuthorized && (
              <label className="field">Tope de convenio (CLP, vacío = sin tope)
                <input inputMode="numeric" placeholder="Ej: 50000" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value.replace(/[^\d]/g, '') })} />
                <small>Lo máximo que puede deber. Al llegar al tope, la caja no deja vender a crédito hasta que abone.</small>
              </label>
            )}
          </div>
          <Err text={error} />
          <div className="row-btns"><button className="btn primary" onClick={save}>Guardar</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button></div>
        </div>
      )}
      <div className="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>RUT</th><th>Correo</th><th>Teléfono</th><th>Convenio</th><th>Cupo</th><th>Debe</th><th /></tr></thead>
        <tbody>{rows.map((c: ClientWithDebt) => (
          <tr key={c.id}><td>{c.name} {c.isVip && <span className="vip">VIP</span>}</td><td>{c.rut}</td><td>{c.email}</td><td>{c.phone}</td>
            <td><span className={'pill ' + (c.creditAuthorized ? 'ok' : 'bad')}>{c.creditAuthorized ? 'autorizado' : 'no'}</span></td>
            <td>{!c.creditAuthorized ? '—' : c.availableCreditClp === null ? 'Sin tope' : c.availableCreditClp === 0 ? <span className="pill bad">Sin cupo</span> : <>{formatClp(c.availableCreditClp)} <small>de {formatClp(c.creditLimitClp ?? 0)}</small></>}</td>
            <td className={c.debtClp > 0 ? 'debt' : ''}>{formatClp(c.debtClp)}</td>
            <td><button className="btn ghost sm" onClick={() => { setError(null); setF({ id: c.id, name: c.name, rut: c.rut ?? '', email: c.email ?? '', phone: c.phone ?? '', isVip: c.isVip, creditAuthorized: !!c.creditAuthorized, creditLimit: c.creditLimitClp != null ? String(c.creditLimitClp) : '' }); setOpen(true); }}>Editar</button>{' '}
              {c.debtClp > 0 && <><button className="btn primary sm" onClick={() => setDebtOf(c)}>Cobrar deuda</button>{' '}</>}
              <button className="btn ghost sm" onClick={async () => { if (confirm(`¿Eliminar a ${c.name}?`)) { try { await api.rpc.deleteClient(c.id); await reload(); } catch (e) { alert(msg(e)); } } }}>Eliminar</button></td></tr>))}</tbody>
      </table></div>
      {debtOf && <DebtModal api={api} client={debtOf} onClose={() => { setDebtOf(null); reload(); }} />}
    </>
  );
}

function Cashiers({ api }: { api: PosApi }) {
  const [rows, reload] = useList(() => api.rpc.listCashiers());
  const [f, setF] = useState({ name: '', pin: '' });
  const [error, setError] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<{ id: string; name: string } | null>(null);
  const [newPin, setNewPin] = useState('');
  const [pinDone, setPinDone] = useState<string | null>(null);
  const changePin = async () => {
    if (!pinFor) return;
    try {
      setError(null);
      await api.rpc.upsertCashier({ id: pinFor.id, name: pinFor.name, pin: newPin });
      setPinDone(pinFor.name); setPinFor(null); setNewPin('');
    } catch (e) { setError(msg(e)); }
  };
  const add = async () => {
    try { setError(null); await api.rpc.upsertCashier({ name: f.name, pin: f.pin }); setF({ name: '', pin: '' }); await reload(); } catch (e) { setError(msg(e)); }
  };
  return (
    <>
      <div className="page-head"><h2>Cajeros</h2></div>
      <p className="hint">
        Los cajeros entran a la app con el RUT del negocio, su <b>nombre</b> y su <b>PIN</b> (opción «Cajero» en la pantalla de ingreso). Solo pueden vender, ingresar mercadería y ver el historial.
        Si alguien olvida su PIN, <b>no se puede ver</b> (por seguridad no se muestra): usa <b>Cambiar PIN</b> y dale el nuevo.
      </p>
      {pinDone && <div className="alert" role="status" style={{ background: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' }}>PIN de {pinDone} cambiado. El anterior ya no sirve.</div>}
      {pinFor && (
        <div className="inline-form">
          <h4>Cambiar PIN de {pinFor.name}</h4>
          <label className="field">Nuevo PIN (4 a 8 dígitos)
            <input type="password" inputMode="numeric" autoFocus value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && changePin()} />
          </label>
          <Err text={error} />
          <div className="row-btns"><button className="btn ghost" onClick={() => { setPinFor(null); setNewPin(''); setError(null); }}>Cancelar</button><button className="btn primary" disabled={newPin.length < 4} onClick={changePin}>Guardar PIN</button></div>
        </div>
      )}
      <div className="inline-form">
        <div className="two-col">
          <label className="field">Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">PIN (4 a 8 dígitos)<input type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></label>
        </div>
        <Err text={error} />
        <button className="btn primary" onClick={add}>➕ Agregar cajero</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Estado</th><th /></tr></thead>
        <tbody>{rows.map((c: Omit<Cashier, 'pin'>) => (
          <tr key={c.id}><td>{c.name}</td><td><span className={'pill ' + (c.active ? 'ok' : 'bad')}>{c.active ? 'activo' : 'inactivo'}</span></td>
            <td><button className="btn ghost sm" onClick={() => { setPinDone(null); setError(null); setPinFor({ id: c.id, name: c.name }); }}>Cambiar PIN</button>{' '}
              <button className="btn ghost sm" onClick={async () => { await api.rpc.upsertCashier({ id: c.id, name: c.name, active: !c.active }); await reload(); }}>{c.active ? 'Desactivar' : 'Activar'}</button></td></tr>))}</tbody>
      </table></div>
    </>
  );
}

function Promos({ api }: { api: PosApi }) {
  const [rows, reload] = useList(() => api.rpc.listPromotions());
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  return (
    <>
      <div className="page-head"><h2>Descuentos y promociones</h2><button className="btn primary sm" onClick={() => setEditing('new')}>➕ Nueva promoción</button></div>
      <p className="hint">Se aplican en la caja con el botón Promociones, por código o desde la lista de activas.</p>
      {editing && <PromoForm api={api} initial={editing === 'new' ? undefined : editing} onSaved={async () => { setEditing(null); await reload(); }} onCancel={() => setEditing(null)} />}
      <div className="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Tipo</th><th>Valor</th><th>Código</th><th>Válida hasta</th><th>Estado</th><th /></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}><td>{p.name}</td><td>{p.type === 'percent' ? '% Porcentaje' : '$ Monto fijo'}</td><td>{p.type === 'percent' ? `${p.value}%` : formatClp(p.value)}</td>
            <td><code>{p.code}</code></td><td>{p.validUntil ?? '—'}</td><td><span className={'pill ' + (p.active ? 'ok' : 'bad')}>{p.active ? 'activa' : 'inactiva'}</span></td>
            <td><button className="btn ghost sm" onClick={() => setEditing(p)}>Editar</button>{' '}
              <button className="btn ghost sm" onClick={async () => { if (confirm('¿Eliminar la promoción?')) { await api.rpc.deletePromotion(p.id); await reload(); } }}>Eliminar</button></td></tr>))}</tbody>
      </table></div>
    </>
  );
}

const blankProduct = { name: '', sku: '', barcode: '', category: '', price: '', cost: '', published: true, active: true, description: '' };

/** Inventario: lo que hay en la caja y lo que se ofrece en la web, precios y datos de cada producto. */
function Inventory({ api, branchId, storeSlug }: { api: PosApi; branchId: string | null; storeSlug?: string | null }) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adj, setAdj] = useState<Record<string, string>>({});
  const [reserve, setReserve] = useState<Record<string, string>>({});
  const [cardFor, setCardFor] = useState<Product | null>(null);
  const [priceFor, setPriceFor] = useState<Product | null>(null);
  const [f, setF] = useState<typeof blankProduct & { id?: string }>(blankProduct);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Foto del producto que se está editando: la que ya tiene, la nueva elegida (aún sin subir) o quitarla.
  const [photo, setPhoto] = useState<{ current?: number; file?: Blob; preview?: string; remove?: boolean }>({});
  const [capturing, setCapturing] = useState(false);
  /** Deja la foto elegida (o recién sacada) lista para guardarse con el producto. */
  const useJpeg = (jpeg: Blob) => {
    if (photo.preview) URL.revokeObjectURL(photo.preview);
    setPhoto({ ...photo, file: jpeg, preview: URL.createObjectURL(jpeg), remove: false });
  };
  const load = useCallback(async () => { if (branchId) setRows(await api.rpc.inventory(branchId)); }, [api, branchId]);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { setError(null); await fn(); await load(); } catch (e) { setError(msg(e)); } };

  const edit = (p: Product) => {
    setError(null);
    setF({ id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, category: p.category, price: String(p.priceClp), cost: String(addIva(p.costClp)), published: p.published, active: p.active, description: p.description ?? '' });
    setPhoto({ current: p.imageVersion });
    setOpen(true);
  };
  const saveProduct = async () => {
    try {
      setError(null);
      const cost = Number(f.cost.replace(/\D/g, '')) || 0;
      const saved = await api.rpc.upsertProduct({
        id: f.id, name: f.name, sku: f.sku, barcode: f.barcode, category: f.category, priceClp: Number(f.price.replace(/\D/g, '')),
        costClp: splitIva(cost).netClp, published: f.published, active: f.active, description: f.description,
      });
      if (photo.file) await api.uploadProductImage(saved.id, photo.file);
      else if (photo.remove && photo.current) await api.deleteProductImage(saved.id);
      if (photo.preview) URL.revokeObjectURL(photo.preview);
      setOpen(false); setF(blankProduct); setPhoto({}); await load();
    } catch (e) { setError(msg(e)); }
  };
  const setVisible = (p: Product, published: boolean) =>
    run(() => api.rpc.upsertProduct({ id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, category: p.category, priceClp: p.priceClp, costClp: p.costClp, published, active: p.active }));
  const legacyWeb = rows.reduce((n, r) => n + r.online.qty, 0);
  const shown = rows.filter(({ product }) => !query.trim() || product.name.toLowerCase().includes(query.trim().toLowerCase()) || product.barcode.includes(query.trim()));

  return (
    <>
      <div className="page-head">
        <h2>Inventario</h2>
        <div className="head-actions"><button className="btn primary sm" onClick={() => { setError(null); setF(blankProduct); setPhoto({}); setOpen(true); }}>➕ Nuevo producto</button></div>
      </div>
      <p className="hint">
        Tu tienda web muestra <b>todo el stock que tienes en la caja</b>, y lo que se pide por la web se reserva solo. Si quieres guardar unidades para vender en el local,
        escribe cuántas en <b>Dejar en el local</b> y la web ofrecerá el resto. Toca el nombre de un producto para ver su tarjeta de existencia.
        Un producto nuevo parte sin unidades: ingrésalas en <b>Ingresar mercadería</b>.
      </p>
      {open && (
        <div className="inline-form">
          <h4>{f.id ? 'Editar producto' : 'Producto nuevo'}</h4>
          <div className="two-col">
            <label className="field">Nombre<input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">Categoría<input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></label>
            <label className="field">Código de barras
              <span className="inline">
                <input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} placeholder="Escanéalo o déjalo vacío" />
                <button type="button" className="btn ghost sm" onClick={async () => { try { setF({ ...f, barcode: await api.rpc.nextInternalCode() }); } catch (e) { setError(msg(e)); } }}>Sin código: asignar uno</button>
              </span>
            </label>
            <label className="field">Precio de venta (con IVA)
              <input inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
              <small>Neto {formatClp(splitIva(Number(f.price.replace(/\D/g, '')) || 0).netClp)}</small>
            </label>
            <label className="field">Costo unitario (con IVA)
              <input inputMode="numeric" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
              <small>Neto {formatClp(splitIva(Number(f.cost.replace(/\D/g, '')) || 0).netClp)}</small>
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>Descripción para la tienda web (opcional)
              <textarea rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej: Botella de 1,5 litros, bien helada" />
              <small>{f.description.length}/300</small>
            </label>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <span>Foto del producto (opcional)</span>
              <div className="photo-row">
                {photo.preview
                  ? <img className="photo-thumb" alt="Foto del producto" src={photo.preview} />
                  : photo.current && !photo.remove
                    ? <ProductPhoto api={api} productId={f.id} version={photo.current} className="photo-thumb" alt="Foto del producto" />
                    : <span className="photo-thumb empty" aria-hidden>📷</span>}
                <button type="button" className="btn ghost sm" onClick={() => setCapturing(true)}>📷 Sacar foto</button>
                <label className="btn ghost sm">
                  🖼️ Elegir de la galería
                  <input type="file" accept="image/*" hidden onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    try {
                      setError(null);
                      useJpeg(await resizeToJpeg(file));
                    } catch (err) { setError(msg(err)); }
                  }} />
                </label>
                {(photo.preview || (photo.current && !photo.remove)) && (
                  <button type="button" className="btn ghost sm" onClick={() => { if (photo.preview) URL.revokeObjectURL(photo.preview); setPhoto({ current: photo.current, remove: true }); }}>Quitar foto</button>
                )}
              </div>
              <small>Se reduce sola para que la tienda cargue rápido. En la tienda web solo se muestra si el producto está visible.</small>
            </div>
            <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Visible en la tienda web</label>
            <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo (se puede vender)</label>
          </div>
          <Err text={error} />
          <div className="row-btns"><button className="btn primary" onClick={saveProduct}>Guardar</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button></div>
        </div>
      )}
      {!open && <Err text={error} />}
      {capturing && <PhotoCapture onClose={() => setCapturing(false)} onPhoto={(jpeg) => { useJpeg(jpeg); setCapturing(false); }} />}
      {legacyWeb > 0 && (
        <div className="alert" role="status">
          Hay {legacyWeb} unidad(es) separadas para la web desde el sistema anterior, que ya no se ofrecen. Pásalas a la caja para que se vendan.{' '}
          <button className="btn primary sm" onClick={() => run(() => api.rpc.moveAllWebToShop(branchId!))}>Pasar todo a la caja</button>
        </div>
      )}
      <div className="toolbar"><input className="search" placeholder="Buscar por nombre o código…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar en el inventario" /></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Producto</th><th>En la caja</th><th>En la web</th><th>Precio de venta</th><th>Ajustar caja</th><th /></tr></thead>
        <tbody>{shown.map(({ product, physical, online }) => {
          const target = reserve[product.id];
          const saved = product.webReserveQty ?? 0;
          const changed = target !== undefined && target !== '' && Number(target) !== saved;
          const shownOnWeb = Math.max(0, physical.qty - physical.reserved - saved);
          const saveReserve = () => run(async () => { await api.rpc.setWebReserve(product.id, Number(target)); setReserve((r) => { const { [product.id]: _x, ...rest } = r; return rest; }); });
          return (
            <tr key={product.id}>
              <td>
                <button className="link-btn" title="Ver tarjeta de existencia" onClick={() => setCardFor(product)}>{product.name}</button>
                {!product.active && <span className="tag">inactivo</span>}
                <br /><small>{product.barcode}</small>
              </td>
              <td>{physical.qty}{physical.reserved > 0 && <small> ({physical.reserved} res.)</small>}</td>
              <td>
                <label className="check" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={product.published} onChange={(e) => setVisible(product, e.target.checked)} /> Visible en la web
                </label>
                {product.published ? (
                  <>
                    <div><b>{shownOnWeb}</b> <small>se ofrecen en la web</small></div>
                    <span className="inline">
                      <small>Dejar en el local:</small>
                      <input className="num" inputMode="numeric" aria-label={`Unidades que dejas en el local de ${product.name}`} value={target ?? String(saved)}
                        onChange={(e) => setReserve({ ...reserve, [product.id]: e.target.value.replace(/\D/g, '') })}
                        onKeyDown={(e) => { if (e.key === 'Enter' && changed) saveReserve(); }} />
                      <button className="btn ghost sm" disabled={!changed} onClick={saveReserve}>Guardar</button>
                    </span>
                  </>
                ) : <small>Oculto en la web</small>}
              </td>
              <td>
                <span className="inline">
                  <span>{formatClp(product.priceClp)}<small> con IVA</small></span>
                  <button className="btn ghost sm" title="Editar el precio de venta" onClick={() => setPriceFor(product)}>✏️ Precio</button>
                </span>
              </td>
              <td><span className="inline"><input className="num" inputMode="numeric" placeholder="±n" value={adj[product.id] ?? ''} onChange={(e) => setAdj({ ...adj, [product.id]: e.target.value })} />
                <button className="btn ghost sm" disabled={!Number(adj[product.id])} onClick={() => run(async () => { await api.rpc.adjustStock(branchId!, product.id, 'physical', Number(adj[product.id])); setAdj({ ...adj, [product.id]: '' }); })}>OK</button></span></td>
              <td><button className="btn ghost sm" onClick={() => edit(product)}>Editar datos</button></td>
            </tr>
          );
        })}
          {!shown.length && <tr><td colSpan={6} className="empty">{rows.length ? 'Ningún producto coincide con la búsqueda' : 'Aún no hay productos: ingresa mercadería para empezar'}</td></tr>}</tbody>
      </table></div>
      {cardFor && branchId && <StockCardModal api={api} branchId={branchId} product={cardFor} onClose={() => setCardFor(null)} onChanged={() => { load().catch(() => undefined); }} />}
      {priceFor && <PriceModal api={api} product={priceFor} onClose={() => setPriceFor(null)} onSaved={() => { load().catch(() => undefined); }} />}
    </>
  );
}

function Shifts({ api }: { api: PosApi }) {
  const [rows] = useList(() => api.rpc.listShifts());
  return (
    <>
      <div className="page-head"><h2>Jornadas</h2></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Estado</th><th>Cajero</th><th>Apertura</th><th>Cierre</th><th>Fondo</th><th>Ventas</th><th>Cierre por medio (contado / dif.)</th></tr></thead>
        <tbody>{rows.map((s: Shift) => (
          <tr key={s.id}><td><span className={'pill ' + (s.status === 'open' ? 'ok' : '')}>{s.status === 'open' ? 'abierta' : 'cerrada'}</span></td><td>{s.cashierName}</td>
            <td>{fmtDateTime(s.openedAt)}</td><td>{s.closedAt ? fmtDateTime(s.closedAt) : '—'}</td><td>{formatClp(s.initialCashClp)}</td>
            <td>{s.salesCount !== undefined ? `${s.salesCount} (${formatClp(s.salesTotalClp ?? 0)})` : '—'}</td>
            <td>{PAY_METHODS.filter((m) => s.counted?.[m] !== undefined).map((m) => (
              <div key={m}><small>{PAY_METHOD_LABEL[m]}: {formatClp(s.counted?.[m] ?? 0)} / <b className={(s.difference?.[m] ?? 0) === 0 ? '' : 'bad-txt'}>{formatClp(s.difference?.[m] ?? 0)}</b></small></div>))}</td></tr>))}
          {!rows.length && <tr><td colSpan={7} className="empty">Aún no hay jornadas</td></tr>}</tbody>
      </table></div>
    </>
  );
}
