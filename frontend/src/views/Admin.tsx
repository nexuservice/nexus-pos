import { useCallback, useEffect, useState } from 'react';
import {
  PAY_METHODS, PAY_METHOD_LABEL, formatClp,
  type Cashier, type ClientWithDebt, type InventoryRow, type Product, type Promotion, type Shift,
} from '@nexus/core';
import type { PosApi } from '../api';
import { DebtModal } from '../components';
import { StockCardModal } from './StockCard';
import { fmtDateTime } from '../format';
import { msg } from '../hooks';
import { PromoForm } from './PosModals';

type Section = 'products' | 'clients' | 'cashiers' | 'promos' | 'inventory' | 'shifts';
const SECTIONS: [Section, string][] = [
  ['products', '📦 Productos'], ['clients', '👥 Clientes'], ['cashiers', '👤 Cajeros'], ['promos', '🎫 Descuentos y promociones'],
  ['inventory', '📊 Inventario'], ['shifts', '🕐 Jornadas'],
];

const Err = ({ text }: { text: string | null }) => (text ? <div className="alert" role="alert">{text}</div> : null);

export function AdminView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [section, setSection] = useState<Section>('products');
  return (
    <div className="admin">
      <nav className="side" aria-label="Administración">
        {SECTIONS.map(([id, label]) => <button key={id} className={id === section ? 'on' : ''} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      <div className="admin-body">
        {section === 'products' && <Products api={api} branchId={branchId} />}
        {section === 'clients' && <Clients api={api} />}
        {section === 'cashiers' && <Cashiers api={api} />}
        {section === 'promos' && <Promos api={api} />}
        {section === 'inventory' && <Inventory api={api} branchId={branchId} />}
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

function Products({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [rows, reload] = useList(() => api.rpc.listProducts());
  const blank = { name: '', sku: '', barcode: '', category: '', price: '', cost: '', stock: '', published: true, active: true };
  const [f, setF] = useState<typeof blank & { id?: string }>(blank);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edit = (p: Product) => { setF({ id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, category: p.category, price: String(p.priceClp), cost: String(p.costClp), stock: '', published: p.published, active: p.active }); setOpen(true); };
  const save = async () => {
    try {
      setError(null);
      const qty = f.id ? 0 : Number(f.stock) || 0;
      if (!Number.isInteger(qty) || qty < 0) throw new Error('La cantidad inicial debe ser un número entero, 0 o mayor');
      const saved = await api.rpc.upsertProduct({ id: f.id, name: f.name, sku: f.sku, barcode: f.barcode, category: f.category, priceClp: Number(f.price), costClp: Number(f.cost) || 0, published: f.published, active: f.active });
      if (qty > 0 && branchId) await api.rpc.adjustStock(branchId, saved.id, 'physical', qty);
      setOpen(false); setF(blank); await reload();
    } catch (e) { setError(msg(e)); }
  };
  return (
    <>
      <div className="page-head"><h2>Productos</h2><button className="btn primary sm" onClick={() => { setF(blank); setOpen(true); }}>➕ Nuevo producto</button></div>
      {open && (
        <div className="inline-form">
          <div className="two-col">
            <label className="field">Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">Categoría<input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></label>
            <label className="field">SKU<input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></label>
            <label className="field">Código de barras<input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></label>
            <label className="field">Precio (CLP, IVA incl.)<input inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
            <label className="field">Costo (CLP)<input inputMode="numeric" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
            {!f.id && <label className="field">Cantidad inicial en local<input inputMode="numeric" placeholder="0" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></label>}
            <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Visible en tienda online</label>
            <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo</label>
          </div>
          <Err text={error} />
          <div className="row-btns"><button className="btn primary" onClick={save}>Guardar</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button></div>
        </div>
      )}
      <div className="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Costo</th><th>Online</th><th>Estado</th><th /></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}><td>{p.name}<br /><small>{p.sku} · {p.barcode}</small></td><td>{p.category}</td><td>{formatClp(p.priceClp)}</td><td>{formatClp(p.costClp)}</td>
            <td>{p.published ? 'Sí' : 'No'}</td><td><span className={'pill ' + (p.active ? 'ok' : 'bad')}>{p.active ? 'activo' : 'inactivo'}</span></td>
            <td><button className="btn ghost sm" onClick={() => edit(p)}>Editar</button></td></tr>))}</tbody>
      </table></div>
    </>
  );
}

function Clients({ api }: { api: PosApi }) {
  const [rows, reload] = useList(() => api.rpc.listClients());
  const blank = { name: '', rut: '', email: '', phone: '', isVip: false, creditAuthorized: false };
  const [f, setF] = useState<typeof blank & { id?: string }>(blank);
  const [open, setOpen] = useState(false);
  const [debtOf, setDebtOf] = useState<ClientWithDebt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try { setError(null); await api.rpc.upsertClient(f); setOpen(false); setF(blank); await reload(); } catch (e) { setError(msg(e)); }
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
          </div>
          <Err text={error} />
          <div className="row-btns"><button className="btn primary" onClick={save}>Guardar</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button></div>
        </div>
      )}
      <div className="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>RUT</th><th>Correo</th><th>Teléfono</th><th>Convenio</th><th>Debe</th><th /></tr></thead>
        <tbody>{rows.map((c: ClientWithDebt) => (
          <tr key={c.id}><td>{c.name} {c.isVip && <span className="vip">VIP</span>}</td><td>{c.rut}</td><td>{c.email}</td><td>{c.phone}</td>
            <td><span className={'pill ' + (c.creditAuthorized ? 'ok' : 'bad')}>{c.creditAuthorized ? 'autorizado' : 'no'}</span></td>
            <td className={c.debtClp > 0 ? 'debt' : ''}>{formatClp(c.debtClp)}</td>
            <td><button className="btn ghost sm" onClick={() => { setError(null); setF({ id: c.id, name: c.name, rut: c.rut ?? '', email: c.email ?? '', phone: c.phone ?? '', isVip: c.isVip, creditAuthorized: !!c.creditAuthorized }); setOpen(true); }}>Editar</button>{' '}
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
  const add = async () => {
    try { setError(null); await api.rpc.upsertCashier({ name: f.name, pin: f.pin }); setF({ name: '', pin: '' }); await reload(); } catch (e) { setError(msg(e)); }
  };
  return (
    <>
      <div className="page-head"><h2>Cajeros</h2></div>
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
            <td><button className="btn ghost sm" onClick={async () => { await api.rpc.upsertCashier({ id: c.id, name: c.name, active: !c.active }); await reload(); }}>{c.active ? 'Desactivar' : 'Activar'}</button></td></tr>))}</tbody>
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

function Inventory({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adj, setAdj] = useState<Record<string, string>>({});
  const [cardFor, setCardFor] = useState<Product | null>(null);
  const load = useCallback(async () => { if (branchId) setRows(await api.rpc.inventory(branchId)); }, [api, branchId]);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { setError(null); await fn(); await load(); } catch (e) { setError(msg(e)); } };
  return (
    <>
      <div className="page-head"><h2>Inventario por canal</h2></div>
      <p className="hint">Mueve unidades entre caja y tienda online o ajusta el stock de la caja (positivo suma, negativo resta). «res.» = reservado en carritos y pedidos abiertos. Toca un producto para ver su tarjeta de existencia.</p>
      <Err text={error} />
      <div className="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Caja</th><th>Online</th><th>Mover 5</th><th>Ajustar caja</th></tr></thead>
        <tbody>{rows.map(({ product, physical, online }) => (
          <tr key={product.id}>
            <td><button className="link-btn" title="Ver tarjeta de existencia" onClick={() => setCardFor(product)}>{product.name}</button>{!product.published && <span className="tag">solo local</span>}</td>
            <td>{physical.qty}{physical.reserved > 0 && <small> ({physical.reserved} res.)</small>}</td>
            <td>{online.qty}{online.reserved > 0 && <small> ({online.reserved} res.)</small>}</td>
            <td>
              <button className="btn ghost sm" disabled={!product.published} onClick={() => run(() => api.rpc.moveStock(branchId!, product.id, 'physical', 'online', 5))}>→ Online</button>{' '}
              <button className="btn ghost sm" onClick={() => run(() => api.rpc.moveStock(branchId!, product.id, 'online', 'physical', 5))}>→ Caja</button>
            </td>
            <td><span className="inline"><input className="num" inputMode="numeric" placeholder="±n" value={adj[product.id] ?? ''} onChange={(e) => setAdj({ ...adj, [product.id]: e.target.value })} />
              <button className="btn ghost sm" disabled={!Number(adj[product.id])} onClick={() => run(async () => { await api.rpc.adjustStock(branchId!, product.id, 'physical', Number(adj[product.id])); setAdj({ ...adj, [product.id]: '' }); })}>OK</button></span></td>
          </tr>))}</tbody>
      </table></div>
      {cardFor && branchId && <StockCardModal api={api} branchId={branchId} product={cardFor} onClose={() => setCardFor(null)} />}
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
