import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatClp } from '@nexus/core';
import { Modal } from '../components';
import { StoreNotice } from '../legal/Legal';
import { API_URL, ApiError, publicStore, type PublicOrderResult, type PublicStore } from '../api';

const MISSING = 'Esta tienda no existe o no está disponible';

/** Tienda web pública de un negocio (/t/<slug>): sin sesión. El pedido se paga al retirar en el local. */
export function PublicStoreView({ slug }: { slug: string }) {
  const [data, setData] = useState<PublicStore | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '' });
  const [privacy, setPrivacy] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<PublicOrderResult | null>(null);
  const [showCart, setShowCart] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await publicStore.get(slug);
      setData(s);
      // Ajusta el carrito a lo que realmente hay.
      setCart((c) => {
        const next: Record<string, number> = {};
        for (const p of s.products) if (c[p.id]) { const q = Math.min(c[p.id], p.available); if (q > 0) next[p.id] = q; }
        return next;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setFatal(MISSING);
      else if (e instanceof ApiError && e.status === 429) setError('Hay muchas visitas en este momento. Espera un minuto e intenta de nuevo.');
      else setError(e instanceof Error ? e.message : 'No se pudo cargar la tienda.');
    }
  }, [slug]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data) document.title = `${data.business.name} · Tienda`; }, [data]);

  const products = data?.products ?? [];
  const categories = useMemo(() => ['Todos', ...Array.from(new Set(products.map((p) => p.category))).sort()], [products]);
  const shown = products.filter((p) => (category === 'Todos' || p.category === category) && p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const items = Object.entries(cart).flatMap(([id, quantity]) => { const p = byId.get(id); return p ? [{ p, quantity }] : []; });
  const total = items.reduce((s, i) => s + i.p.priceClp * i.quantity, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  const setQty = (id: string, q: number) => {
    const p = byId.get(id);
    if (!p) return;
    const qty = Math.max(0, Math.min(q, p.available));
    setCart((c) => { const n = { ...c }; if (qty > 0) n[id] = qty; else delete n[id]; return n; });
  };

  const send = async () => {
    if (!items.length) return;
    if (!form.name.trim() || form.phone.replace(/\D/g, '').length < 8) return setError('Ingresa tu nombre y un teléfono válido.');
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) return setError('El correo no parece válido.');
    if (!privacy) return setError('Para enviar el pedido, marca que leíste el aviso de privacidad.');
    setError(null);
    setSending(true);
    try {
      const r = await publicStore.order(slug, {
        items: items.map((i) => ({ productId: i.p.id, quantity: i.quantity })),
        customerName: form.name.trim(), phone: form.phone.trim(),
        email: form.email.trim() || undefined, note: form.note.trim() || undefined, privacyAccepted: true,
      });
      setDone(r);
      setCart({});
      setShowCart(false);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) setFatal(MISSING);
      else if (err.status === 429) setError('Enviaste muchos pedidos seguidos. Espera un momento e intenta de nuevo.');
      else if (err.status === 409) { setError(`${err.message} Actualizamos el catálogo: revisa tu carrito.`); await load(); }
      else setError(err.message || 'No se pudo enviar el pedido.');
    } finally {
      setSending(false);
    }
  };

  if (fatal) {
    return <div className="gate"><div className="gate-card"><h2>{fatal}</h2><p className="hint">Revisa que la dirección esté bien escrita o consulta directamente al negocio.</p></div></div>;
  }
  if (!data) {
    return <div className="page">{error ? <div className="alert" role="alert">{error} <button className="btn ghost sm" onClick={load}>Reintentar</button></div> : <p className="hint">Cargando tienda…</p>}</div>;
  }

  const b = data.business;
  const where = [b.direccion, b.comuna].filter(Boolean).join(', ');

  if (done) {
    return (
      <div className="page" style={{ maxWidth: 560 }}>
        <div className="panel created">
          <h2>✅ ¡Pedido recibido!</h2>
          <p>Tu número de pedido es <b>#{done.number}</b>. <b>Pagas al retirar en el local.</b></p>
          <ul style={{ paddingLeft: 18 }}>
            {done.lines.map((l, i) => <li key={i}>{l.quantity} × {l.name} — {formatClp(l.unitPriceClp * l.quantity)}</li>)}
          </ul>
          <p><b>Total a pagar al retirar: {formatClp(done.totalClp)}</b></p>
          <p className="hint">{b.name}{where && ` · ${where}`}{b.phone && ` · ${b.phone}`}. Menciona tu número de pedido al llegar.</p>
          <button className="btn primary" onClick={() => { setDone(null); load(); }}>Hacer otro pedido</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: 90 }}>
      <div className="hero">
        <h1>{b.name}</h1>
        <p>{where || 'Haz tu pedido y retíralo en el local.'}{b.phone && ` · 📞 ${b.phone}`}</p>
        <p style={{ marginTop: 6 }}><b>Pagas al retirar en el local.</b> No se cobra nada por internet.</p>
      </div>

      {error && <div className="alert" role="alert">{error}</div>}

      <div className="inline" style={{ margin: '14px 0 8px', gap: 8, flexWrap: 'wrap' }}>
        <input className="search" placeholder="Buscar producto" aria-label="Buscar producto" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Categoría" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="products">
        {shown.map((p) => (
          <article key={p.id} className="card">
            {p.imageVersion
              ? <img className="card-photo" loading="lazy" alt={p.name} src={`${API_URL.replace(/\/$/, '')}/api/public/${encodeURIComponent(slug)}/img/${p.id}?v=${p.imageVersion}`} />
              : <div className="card-img" aria-hidden>{p.name.charAt(0)}</div>}
            <span className="cat">{p.category}</span>
            <h3>{p.name}</h3>
            {p.description && <p className="card-desc">{p.description}</p>}
            <div className="card-row">
              <strong>{formatClp(p.priceClp)}</strong>
              <button className="btn primary sm" disabled={p.available <= 0 || (cart[p.id] ?? 0) >= p.available} onClick={() => setQty(p.id, (cart[p.id] ?? 0) + 1)}>
                {p.available > 0 ? 'Agregar' : 'Agotado'}
              </button>
            </div>
            {p.available > 0 && p.available <= 5 && <span className="low">Quedan {p.available}</span>}
          </article>
        ))}
        {!shown.length && <p className="hint">No hay productos que coincidan.</p>}
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'center' }}>
        <button className="btn primary" style={{ width: 'min(520px, 100%)' }} disabled={!count} onClick={() => setShowCart(true)}>
          🛒 Ver pedido ({count}) · {formatClp(total)}
        </button>
      </div>

      {showCart && (
        <div role="dialog" aria-modal="true" aria-label="Tu pedido" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }} onClick={() => setShowCart(false)}>
          <div className="panel" style={{ width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', background: 'var(--surface)' }} onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h2>Tu pedido</h2><button className="btn ghost sm" onClick={() => setShowCart(false)}>Cerrar</button></div>
            {items.map(({ p, quantity }) => (
              <div key={p.id} className="card-row" style={{ padding: '6px 0' }}>
                <span>{p.name}<br /><small className="hint">{formatClp(p.priceClp)} c/u</small></span>
                <span className="inline">
                  <button className="btn ghost sm" aria-label={`Quitar uno de ${p.name}`} onClick={() => setQty(p.id, quantity - 1)}>−</button>
                  <b>{quantity}</b>
                  <button className="btn ghost sm" aria-label={`Agregar uno de ${p.name}`} disabled={quantity >= p.available} onClick={() => setQty(p.id, quantity + 1)}>+</button>
                </span>
              </div>
            ))}
            <div className="card-row" style={{ padding: '10px 0' }}><b>Total</b><b>{formatClp(total)}</b></div>
            <div className="checkout">
              <input placeholder="Tu nombre *" aria-label="Tu nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Teléfono *" aria-label="Teléfono" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input placeholder="Correo (opcional)" aria-label="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input placeholder="Nota para el local (opcional)" aria-label="Nota" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <p className="hint"><b>Pagas al retirar en el local.</b> Te guardamos los productos hasta que pases.</p>
              <label className="check">
                <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
                <span>Leí el <a href="#aviso" onClick={(e) => { e.preventDefault(); setShowNotice(true); }}>aviso de privacidad y condiciones</a> de esta tienda</span>
              </label>
              {error && <div className="alert" role="alert">{error}</div>}
              <button className="btn primary" disabled={sending || !items.length} onClick={send}>{sending ? 'Enviando…' : 'Enviar pedido'}</button>
            </div>
          </div>
        </div>
      )}
      {showNotice && (
        <Modal title="Aviso de privacidad y condiciones" wide onClose={() => setShowNotice(false)}>
          <StoreNotice business={b} />
          <div className="row-btns"><button className="btn primary" onClick={() => setShowNotice(false)}>Cerrar</button></div>
        </Modal>
      )}
    </div>
  );
}
