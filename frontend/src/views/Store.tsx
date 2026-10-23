import { useState } from 'react';
import { formatClp, isValidRut } from '@nexus/core';
import type { PosApi } from '../api';
import { msg, useCart, usePayment } from '../hooks';
import { CartPanel, PaymentModal } from '../components';

export function StoreView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const c = useCart(api, branchId, 'online');
  const pay = usePayment(api);
  const [form, setForm] = useState({ name: '', email: '', rut: '', promo: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const checkout = async (provider: 'mercadopago' | 'transbank') => {
    if (!c.cart) return;
    if (!form.name.trim() || !/^\S+@\S+\.\S+$/.test(form.email)) return setFormError('Ingresa tu nombre y un correo válido.');
    if (form.rut && !isValidRut(form.rut)) return setFormError('El RUT no es válido.');
    setFormError(null);
    try {
      await api.rpc.setCustomer(c.cart.id, { name: form.name.trim(), email: form.email.trim(), rut: form.rut || undefined });
      await pay.start(c.cart.id, 'credit', { provider }, { onDone: c.refreshCatalog });
    } catch (e) {
      setFormError(msg(e));
    }
  };

  const empty = !c.cart?.lines.length;

  return (
    <div className="store">
      <section className="store-main">
        <div className="hero">
          <h1>Tu tienda, siempre abierta</h1>
          <p>Compra online con el mismo stock del local. Lo que ves aquí es lo que hay disponible.</p>
        </div>
        {c.error && <div className="alert" role="alert">{c.error}</div>}
        <div className="products">
          {c.catalog.map((p) => (
            <article key={p.id} className="card">
              <div className="card-img" aria-hidden>{p.name.charAt(0)}</div>
              <span className="cat">{p.category}</span>
              <h3>{p.name}</h3>
              <div className="card-row">
                <strong>{formatClp(p.priceClp)}</strong>
                <button className="btn primary sm" disabled={p.available <= 0} onClick={() => c.add(p.barcode)}>
                  {p.available > 0 ? 'Agregar' : 'Agotado'}
                </button>
              </div>
              {p.available > 0 && p.available <= 5 && <span className="low">¡Quedan {p.available}!</span>}
            </article>
          ))}
        </div>
      </section>

      <CartPanel
        cart={c.cart}
        orderNo={c.orderNo}
        title="Tu carrito"
        onQty={(i, q) => c.setQty(i, q)}
        onClear={() => c.clear()}
        onRemovePromo={() => c.removePromo()}
        footer={
          <div className="checkout">
            <span className="inline">
              <input placeholder="Código de descuento" value={form.promo} onChange={(e) => setForm({ ...form, promo: e.target.value.toUpperCase() })} aria-label="Código de descuento" />
              <button className="btn ghost sm" disabled={!form.promo || empty} onClick={() => { c.applyPromo(form.promo); setForm({ ...form, promo: '' }); }}>Aplicar</button>
            </span>
            <input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="RUT (opcional)" value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} />
            {formError && <div className="alert" role="alert">{formError}</div>}
            <button className="btn primary" disabled={empty} onClick={() => checkout('mercadopago')}>Pagar con Mercado Pago</button>
            <button className="btn ghost" disabled={empty} onClick={() => checkout('transbank')}>Pagar con Webpay</button>
          </div>
        }
      />

      <PaymentModal {...pay} onCancel={pay.cancel} onClose={pay.close} onNew={async () => { pay.close(); await c.newCart(); }} />
    </div>
  );
}
