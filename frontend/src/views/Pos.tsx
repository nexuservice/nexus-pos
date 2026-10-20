import { useMemo, useState } from 'react';
import { formatClp } from '@nexus/core';
import type { PosApi } from '../api';
import { useCart, usePayment } from '../hooks';
import { CartPanel, PaymentModal } from '../components';

export function PosView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const c = useCart(api, branchId, 'physical');
  const pay = usePayment(api);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');

  const categories = useMemo(() => ['Todos', ...new Set(c.catalog.map((p) => p.category))], [c.catalog]);
  const shown = c.catalog.filter(
    (p) =>
      (category === 'Todos' || p.category === category) &&
      (!query || p.name.toLowerCase().includes(query.toLowerCase()) || p.barcode.includes(query)),
  );

  const scan = async () => {
    const q = query.trim();
    if (!q) return;
    const exact = c.catalog.find((p) => p.barcode === q || p.sku.toLowerCase() === q.toLowerCase());
    if (exact) {
      await c.add(exact.barcode);
      setQuery('');
    }
  };

  const disabled = !c.cart?.lines.length;
  const charge = (m: 'cash' | 'debit' | 'credit') => c.cart && pay.start(c.cart.id, m, undefined, c.refreshCatalog);

  return (
    <div className="pos">
      <section className="pos-main">
        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar producto o escanear código de barras…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && scan()}
            aria-label="Buscar producto o código de barras"
          />
        </div>
        <div className="chips" role="tablist">
          {categories.map((cat) => (
            <button key={cat} className={'chip' + (cat === category ? ' on' : '')} onClick={() => setCategory(cat)}>{cat}</button>
          ))}
        </div>
        {c.error && <div className="alert" role="alert">{c.error}</div>}
        <div className="grid">
          {shown.map((p) => (
            <button key={p.id} className="tile" disabled={p.available <= 0} onClick={() => c.add(p.barcode)}>
              <span className="tile-name">{p.name}</span>
              <span className="tile-price">{formatClp(p.priceClp)}</span>
              <span className={'tile-stock' + (p.available <= 5 ? ' low' : '')}>
                {p.available > 0 ? `${p.available} en caja` : 'Sin stock'}
              </span>
            </button>
          ))}
        </div>
      </section>

      <CartPanel
        cart={c.cart}
        title="Pedido en caja"
        onQty={(i, q) => c.setQty(i, q)}
        onClear={() => c.clear()}
        footer={
          <div className="pay-row">
            <button className="btn cash" disabled={disabled} onClick={() => charge('cash')}>💵 Efectivo</button>
            <button className="btn debit" disabled={disabled} onClick={() => charge('debit')}>💳 Débito</button>
            <button className="btn credit" disabled={disabled} onClick={() => charge('credit')}>💳 Crédito</button>
          </div>
        }
      />

      <PaymentModal
        {...pay}
        onCancel={pay.cancel}
        onClose={pay.close}
        onNew={async () => { pay.close(); await c.newCart(); }}
      />
    </div>
  );
}
