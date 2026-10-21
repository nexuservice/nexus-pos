import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAY_METHODS, PAY_METHOD_LABEL, formatClp, type PayMethod, type Shift, type Ticket } from '@nexus/core';
import type { PosApi } from '../api';
import { useCart, usePayment, useShift } from '../hooks';
import { CartPanel, CashModal, CustomerBar, Dropdown, PaymentModal } from '../components';
import { useSettings } from '../settings';
import { comandaHtml, download, fmtTime, printHtml } from '../format';
import {
  HoldModal, OpenShiftCard, PromosModal, ShiftCloseModal, ShiftInfoModal, ShiftSummaryModal, TicketsModal, type HoldData,
} from './PosModals';

type ModalKind = null | 'cash' | 'hold' | 'tickets' | 'promos' | 'shift-info' | 'shift-close';
const ICON: Record<PayMethod, string> = { cash: '💵', debit: '💳', credit: '💳', cheque: '💼', transfer: '🏦', convenio: '🤝' };

function Clock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const t = setInterval(() => setNow(new Date().toISOString()), 1000); return () => clearInterval(t); }, []);
  return <span className="clock">{fmtTime(now)}</span>;
}

export function PosView({ api, branchId, go }: { api: PosApi; branchId: string | null; go: (tab: string) => void }) {
  const { prefs } = useSettings();
  const c = useCart(api, branchId, 'physical');
  const pay = usePayment(api);
  const shift = useShift(api);
  const [modal, setModal] = useState<ModalKind>(null);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);
  const [tickets, setTickets] = useState(0);
  const [folio, setFolio] = useState({ current: 0, remaining: 0 });
  const [branchName, setBranchName] = useState('');
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [category, setCategory] = useState('Todos');
  const [payOpen, setPayOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const refreshMeta = useCallback(async () => {
    setTickets((await api.rpc.listTickets()).length);
    setFolio({ current: await api.rpc.currentFolio(), remaining: await api.rpc.foliosRemaining() });
    await shift.refresh();
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshMeta().catch(() => undefined); }, [refreshMeta]);
  useEffect(() => { api.rpc.branches().then((b) => setBranchName(b[0]?.name ?? '')); }, [api]);
  useEffect(() => { if (prefs.showBarcode) barcodeRef.current?.focus(); }, [prefs.showBarcode, shift.info]);

  const categories = useMemo(() => [...(prefs.showAll ? ['Todos'] : []), ...new Set(c.catalog.map((p) => p.category))], [c.catalog, prefs.showAll]);
  const activeCat = categories.includes(category) ? category : categories[0];
  const shown = c.catalog.filter(
    (p) => (activeCat === 'Todos' || p.category === activeCat) && (!query || p.name.toLowerCase().includes(query.toLowerCase()) || p.barcode.includes(query)),
  );

  const scan = async () => {
    const v = code.trim();
    if (!v) return;
    await c.add(v);
    setCode('');
    barcodeRef.current?.focus();
  };

  const afterPayment = async () => { await c.refreshCatalog(); await refreshMeta(); };
  const charge = (m: PayMethod, receivedClp?: number) => c.cart && pay.start(c.cart.id, m, { receivedClp }, { onDone: afterPayment });
  const onPayClick = (m: PayMethod) => (m === 'cash' ? setModal('cash') : charge(m));

  const saveHold = async (d: HoldData) => {
    if (!c.cart) return;
    const data = { customerName: d.customerName, phone: d.phone, email: d.email, channel: d.channel, note: d.note };
    if (!d.paid) {
      const t = await api.rpc.holdCart(c.cart.id, data);
      printHtml(comandaHtml(t));
      setModal(null);
      await c.newCart();
      await refreshMeta();
      return;
    }
    setModal(null);
    await pay.start(c.cart.id, d.method, {}, {
      onDone: afterPayment,
      onApproved: async (saleId) => { printHtml(comandaHtml(await api.rpc.createPaidTicket(saleId, data))); await refreshMeta(); },
    });
  };

  const resume = async (t: Ticket) => {
    const cart = await api.rpc.resumeTicket(t.id);
    await c.loadCart(cart);
    setModal(null);
    await refreshMeta();
  };

  if (shift.info === undefined) return <div className="page"><p className="empty">Cargando…</p></div>;
  if (shift.info === null) {
    return (
      <>
        <OpenShiftCard api={api} onOpened={refreshMeta} />
        {closedShift && <ShiftSummaryModal shift={closedShift} onClose={() => setClosedShift(null)} />}
      </>
    );
  }
  const si = shift.info;
  const hasLines = !!c.cart?.lines.length;
  const canCredit = !!(c.cart?.customer.clientId && c.cart.customer.creditAuthorized);

  return (
    <div className="pos">
      <section className="pos-main">
        <div className="pos-bar">
          {prefs.headerInfo && (
            <div className="header-info">
              <strong>{branchName}</strong><span>{si.shift.terminal}</span><span>👤 {si.shift.cashierName}</span>
            </div>
          )}
          <div className="pos-bar-actions">
            <Dropdown label="Folios" align="right">{() => (
              <div className="dd-info"><div><span>Folio actual</span><b>{folio.current}</b></div><div><span>Folios restantes</span><b>{folio.remaining}</b></div></div>
            )}</Dropdown>
            <Dropdown label={<>🟢 Jornada</>} align="right" className="green">{(close) => (
              <>
                <button onClick={() => { close(); go('history'); }}>🧾 Historial</button>
                <button onClick={async () => { close(); download('boletas.json', JSON.stringify(await api.rpc.listSales({ shiftId: si.shift.id }), null, 2), 'application/json'); }}>JSON de boletas</button>
                <button onClick={() => { close(); setModal('shift-info'); }}>ℹ️ Info Jornada</button>
                <button onClick={() => { close(); setModal('shift-close'); }}>🔒 Cerrar Jornada</button>
              </>
            )}</Dropdown>
          </div>
        </div>

        {(prefs.showSearch || prefs.showBarcode) && (
          <div className="toolbar">
            {prefs.showSearch && <input className="search" placeholder="Buscar producto…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar producto" />}
            {prefs.showBarcode && (
              <input ref={barcodeRef} className="search barcode" placeholder="Código de barras" value={code} inputMode="numeric"
                onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan()} aria-label="Código de barras" />
            )}
          </div>
        )}
        <div className="chips" role="tablist">
          {categories.map((cat) => (
            <button key={cat} className={'chip' + (cat === activeCat ? ' on' : '')} onClick={() => setCategory(cat)}>{cat}</button>
          ))}
        </div>
        {c.error && <div className="alert" role="alert">{c.error}</div>}
        <div className="grid">
          {shown.map((p) => (
            <button key={p.id} className="tile" disabled={p.available <= 0} onClick={() => c.add(p.barcode)}>
              <span className="tile-name">{p.name}</span>
              <span className="tile-price">{formatClp(p.priceClp)}</span>
              <span className={'tile-stock' + (p.available <= 5 ? ' low' : '')}>{p.available > 0 ? `${p.available} en caja` : 'Sin stock'}</span>
            </button>
          ))}
        </div>

        <div className="status-bar">
          <button className="btn ghost sm" onClick={() => setModal('tickets')}>📋 Pedidos {tickets > 0 && <span className="badge">{tickets}</span>}</button>
          <Dropdown label="🏷️ Promociones" up className="promo-dd">{(close) => (
            <div className="promo-menu">
              <button onClick={() => { close(); setModal('promos'); }}>📋 Ver promociones activas</button>
              <hr />
              <label className="field">Aplicar código promo
                <span className="inline">
                  <input placeholder="Código…" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter' && promoCode) { c.applyPromo(promoCode); setPromoCode(''); close(); } }} />
                  <button className="btn primary sm" disabled={!promoCode || !hasLines} onClick={() => { c.applyPromo(promoCode); setPromoCode(''); close(); }}>Aplicar</button>
                </span>
              </label>
            </div>
          )}</Dropdown>
          <span className="spacer" />
          <Clock />
          <span className="ver">Nexus v0.2</span>
        </div>
      </section>

      <CartPanel
        cart={c.cart}
        orderNo={c.orderNo}
        title="Pedido"
        compact={prefs.compactCart}
        onQty={(i, q) => c.setQty(i, q)}
        onClear={() => c.clear()}
        onRemovePromo={() => c.removePromo()}
        customerBar={c.cart && <CustomerBar api={api} customer={c.cart.customer} onChange={(cu) => c.setCustomer(cu)} />}
        footer={
          <>
            <button className="btn ghost" disabled={!hasLines} onClick={() => setModal('hold')}>📋 Dejar pedido abierto</button>
            {!prefs.payAlways && (
              <button className="btn primary" disabled={!hasLines} onClick={() => setPayOpen(!payOpen)}>💵 Cobrar {formatClp(c.cart?.totalClp ?? 0)} {payOpen ? '▼' : '▲'}</button>
            )}
            {(prefs.payAlways || payOpen) && (
              <>
                <div className="pay-grid">
                  {PAY_METHODS.map((m) => (
                    <button key={m} className={`btn pay ${m}`} disabled={!hasLines || (m === 'convenio' && !canCredit)}
                      title={m === 'convenio' && !canCredit ? 'Selecciona un cliente autorizado para convenio' : undefined} onClick={() => onPayClick(m)}>
                      <span aria-hidden>{ICON[m]}</span> {PAY_METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
                {hasLines && !canCredit && <small className="hint">Convenio: busca un cliente registrado y autorizado (con nombre y RUT).</small>}
              </>
            )}
          </>
        }
      />

      {modal === 'cash' && c.cart && (
        <CashModal total={c.cart.totalClp} onClose={() => setModal(null)} onConfirm={(r) => { setModal(null); charge('cash', r); }} />
      )}
      {modal === 'hold' && c.cart && (
        <HoldModal
          summary={`${c.cart.lines.length} producto(s) · ${c.cart.lines.reduce((s, l) => s + l.quantity, 0)} artículo(s) · Total ${formatClp(c.cart.totalClp)}`}
          defaultName={c.cart.customer.name ?? ''} onSave={saveHold} onClose={() => setModal(null)}
        />
      )}
      {modal === 'tickets' && <TicketsModal api={api} onResume={resume} onChanged={() => { refreshMeta(); c.refreshCatalog(); }} onClose={() => setModal(null)} />}
      {modal === 'promos' && <PromosModal api={api} canApply={hasLines} onApply={(code) => c.applyPromo(code)} onClose={() => setModal(null)} />}
      {modal === 'shift-info' && <ShiftInfoModal info={si} onClose={() => setModal(null)} />}
      {modal === 'shift-close' && (
        <ShiftCloseModal api={api} info={si} onCancel={() => setModal(null)}
          onClosed={async (s) => { setModal(null); setClosedShift(s); await c.newCart(); await refreshMeta(); }} />
      )}

      <PaymentModal {...pay} onCancel={pay.cancel} onClose={pay.close} onNew={async () => { pay.close(); await c.newCart(); }} />
    </div>
  );
}
