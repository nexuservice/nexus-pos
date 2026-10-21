import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Cart, ClientBalance, ClientWithDebt, Customer, PayMethod } from '@nexus/core';
import { PAY_METHODS, PAY_METHOD_LABEL, formatClp } from '@nexus/core';
import type { PayPhase, SaleDetail } from './hooks';
import type { PosApi } from './api/types';
import { fmtDateTime, printHtml } from './format';
import { msg } from './hooks';

export function Modal(props: { title?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={props.title} onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={'modal' + (props.wide ? ' wide' : '')}>
        {props.title && <h3 className="modal-title">{props.title}</h3>}
        {props.children}
      </div>
    </div>
  );
}

/** Menú desplegable que se cierra al hacer clic fuera. */
export function Dropdown(props: { label: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; className?: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div className={'dd ' + (props.className ?? '')} ref={ref}>
      <button className="dd-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{props.label} <small>{props.up ? '▲' : '▼'}</small></button>
      {open && <div className={`dd-menu ${props.align ?? 'left'}${props.up ? ' up' : ''}`}>{props.children(() => setOpen(false))}</div>}
    </div>
  );
}

/** Deuda de convenio de un cliente: detalle y pago (total o abono). Necesita jornada abierta. */
export function DebtModal(props: { api: PosApi; client: { id: string; name: string }; onClose: () => void; onPaid?: () => void }) {
  const [balance, setBalance] = useState<ClientBalance | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = PAY_METHODS.filter((m) => m !== 'convenio');

  const load = async () => {
    const b = await props.api.rpc.clientBalance(props.client.id);
    setBalance(b);
    setAmount(String(b.debtClp));
  };
  useEffect(() => { load().catch((e) => setError(msg(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = Number(amount.replace(/\D/g, '')) || 0;
  const debt = balance?.debtClp ?? 0;
  const pay = async () => {
    try {
      setBusy(true); setError(null);
      await props.api.rpc.payClientDebt(props.client.id, value, method);
      await load();
      props.onPaid?.();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Deuda de ${props.client.name}`} onClose={props.onClose}>
      <div className="receipt"><div className="big"><span>Debe en total</span><strong>{formatClp(debt)}</strong></div></div>
      {balance && (
        <small className="hint">
          Vendido a convenio {formatClp(balance.creditSalesClp)} · Pagado {formatClp(balance.paidClp)}
        </small>
      )}
      {debt > 0 && (
        <>
          <label className="field">Monto a pagar
            <input inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && value > 0 && value <= debt && pay()} />
          </label>
          <div className="chips">
            <button className="chip" onClick={() => setAmount(String(debt))}>Pagar todo</button>
            {debt >= 2 && <button className="chip" onClick={() => setAmount(String(Math.ceil(debt / 2)))}>Mitad</button>}
          </div>
          <label className="field">Forma de pago
            <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
              {methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}
            </select>
          </label>
        </>
      )}
      {balance && balance.payments.length > 0 && (
        <details>
          <summary>Abonos anteriores ({balance.payments.length})</summary>
          <ul className="plain">
            {balance.payments.slice(0, 8).map((p) => <li key={p.id}>{fmtDateTime(p.at)} · {PAY_METHOD_LABEL[p.method]} · {formatClp(p.amountClp)}</li>)}
          </ul>
        </details>
      )}
      {balance && balance.sales.length > 0 && (
        <details>
          <summary>Ventas a convenio ({balance.sales.length})</summary>
          <ul className="plain">
            {balance.sales.slice(0, 8).map((s) => <li key={s.id}>#{s.number} · {fmtDateTime(s.paidAt)} · {formatClp(s.totalClp)}</li>)}
          </ul>
        </details>
      )}
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="row-btns">
        <button className="btn ghost" onClick={props.onClose}>Cerrar</button>
        {debt > 0 && <button className="btn primary" disabled={busy || value <= 0 || value > debt} onClick={pay}>Registrar pago {formatClp(value)}</button>}
      </div>
    </Modal>
  );
}

/** Campo "Nombre o RUT del cliente" con autocompletado (desde 2 caracteres), insignia VIP y deuda de convenio. */
export function CustomerBar(props: { api: PosApi; customer: Customer; onChange: (c: Customer) => void }) {
  const { customer } = props;
  const [text, setText] = useState(customer.name ?? '');
  const [items, setItems] = useState<ClientWithDebt[]>([]);
  const [idx, setIdx] = useState(-1);
  const [debt, setDebt] = useState<number | null>(null);
  const [debtOpen, setDebtOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setText(customer.name ?? ''), [customer.name]);

  const loadDebt = async () => {
    if (!customer.clientId) { setDebt(null); return; }
    setDebt((await props.api.rpc.clientBalance(customer.clientId)).debtClp);
  };
  useEffect(() => { loadDebt().catch(() => setDebt(null)); }, [customer.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = (q: string) => {
    setText(q);
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      setItems(await props.api.rpc.searchClients(q));
      setIdx(-1);
    }, 250);
  };
  const pick = (c: ClientWithDebt) => {
    clearTimeout(timer.current);
    setItems([]);
    setText(c.name);
    props.onChange({ clientId: c.id });
  };
  const saveText = () => {
    const t = text.trim();
    setItems([]);
    if (t === (customer.name ?? '')) return;
    props.onChange(t ? { name: t } : {});
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setIdx(Math.min(idx + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setIdx(Math.max(idx - 1, 0)); }
    else if (e.key === 'Escape') { setItems([]); setIdx(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (idx >= 0 && items[idx]) pick(items[idx]!);
      else saveText();
    }
  };

  return (
    <div className="customer-bar">
      <span aria-hidden>👤</span>
      <input
        placeholder="Nombre o RUT del cliente (opcional)"
        value={text}
        onChange={(e) => search(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => setTimeout(saveText, 150)}
        aria-label="Cliente"
        aria-autocomplete="list"
      />
      {customer.isVip && <span className="vip">VIP</span>}
      {(customer.name || customer.clientId) && (
        <button className="x" aria-label="Quitar cliente" onMouseDown={(e) => e.preventDefault()} onClick={() => { setText(''); props.onChange({}); }}>✕</button>
      )}
      {items.length > 0 && (
        <div className="ac" role="listbox">
          {items.map((c, i) => (
            <div key={c.id} role="option" aria-selected={i === idx} className={'ac-item' + (i === idx ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
              <span>{c.name}</span>
              {c.rut && <small>{c.rut}</small>}
              {c.isVip && <span className="vip">VIP</span>}
              {c.debtClp > 0 && <span className="debt-tag">Debe {formatClp(c.debtClp)}</span>}
            </div>
          ))}
        </div>
      )}
      {customer.rut && <small className="rut">{customer.rut}</small>}
      {customer.clientId && debt !== null && (
        <div className="credit-line">
          <span className={'credit-pill' + (customer.creditAuthorized ? ' ok' : '')}>{customer.creditAuthorized ? 'Convenio autorizado' : 'Sin convenio'}</span>
          <span>Debe en total: <b className={debt > 0 ? 'debt' : ''}>{formatClp(debt)}</b></span>
          {debt > 0 && <button className="btn primary sm" onMouseDown={(e) => e.preventDefault()} onClick={() => setDebtOpen(true)}>Pagar deuda</button>}
        </div>
      )}
      {debtOpen && customer.clientId && (
        <DebtModal api={props.api} client={{ id: customer.clientId, name: customer.name ?? 'cliente' }}
          onClose={() => { setDebtOpen(false); loadDebt().catch(() => undefined); }} onPaid={() => loadDebt().catch(() => undefined)} />
      )}
    </div>
  );
}

export function CartPanel(props: {
  cart: Cart | null;
  orderNo: number;
  onQty: (index: number, q: number) => void;
  onClear: () => void;
  onRemovePromo?: () => void;
  customerBar?: ReactNode;
  compact?: boolean;
  footer: ReactNode;
  title?: string;
  /** Botones extra junto a «Limpiar» (p. ej. Consumo en la caja). */
  headActions?: ReactNode;
}) {
  const { cart } = props;
  return (
    <aside className={'cart' + (props.compact ? ' compact' : '')}>
      <div className="cart-head">
        <h2>{props.title ?? 'Pedido'} #{props.orderNo}</h2>
        <div className="cart-head-actions">
          {props.headActions}
          <button className="btn ghost sm" onClick={props.onClear} disabled={!cart?.lines.length}>Limpiar</button>
        </div>
      </div>
      {props.customerBar}
      <div className="cart-lines">
        {!cart?.lines.length && <p className="empty">Agrega productos para comenzar</p>}
        {cart?.lines.map((l, i) => (
          <div className="line" key={l.productId}>
            <div className="line-info">
              <strong>{l.name}</strong>
              <span>{formatClp(l.unitPriceClp)} c/u</span>
            </div>
            <div className="qty">
              <button aria-label="Quitar uno" onClick={() => props.onQty(i, l.quantity - 1)}>−</button>
              <span>{l.quantity}</span>
              <button aria-label="Agregar uno" onClick={() => props.onQty(i, l.quantity + 1)}>+</button>
            </div>
            <div className="line-total">{formatClp(l.unitPriceClp * l.quantity)}</div>
            <button className="x" aria-label={`Eliminar ${l.name}`} onClick={() => props.onQty(i, 0)}>✕</button>
          </div>
        ))}
      </div>
      <div className="cart-foot">
        <div className="sub"><span>Subtotal</span><span>{formatClp(cart?.subtotalClp ?? 0)}</span></div>
        {!!cart?.discountClp && (
          <div className="sub disc">
            <span>Descuento ({cart.promotion?.code}) {props.onRemovePromo && <button className="x" aria-label="Quitar promoción" onClick={props.onRemovePromo}>✕</button>}</span>
            <span>−{formatClp(cart.discountClp)}</span>
          </div>
        )}
        <div className="total"><span>Total</span><strong>{formatClp(cart?.totalClp ?? 0)}</strong></div>
        {props.footer}
      </div>
    </aside>
  );
}

/** Efectivo: monto recibido y cálculo del vuelto. */
export function CashModal(props: { total: number; onConfirm: (received: number) => void; onClose: () => void }) {
  const [received, setReceived] = useState(String(props.total));
  const value = Number(received.replace(/\D/g, '')) || 0;
  const change = value - props.total;
  const quick = [...new Set([props.total, ...[1000, 2000, 5000, 10000, 20000].filter((n) => n >= props.total)].slice(0, 5))];
  return (
    <Modal title="Pago en efectivo" onClose={props.onClose}>
      <div className="receipt"><div className="big"><span>Total a cobrar</span><strong>{formatClp(props.total)}</strong></div></div>
      <label className="field">Monto recibido
        <input inputMode="numeric" autoFocus value={received} onChange={(e) => setReceived(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && change >= 0 && props.onConfirm(value)} />
      </label>
      <div className="chips">
        {quick.map((n) => <button key={n} className="chip" onClick={() => setReceived(String(n))}>{n === props.total ? 'Exacto' : formatClp(n)}</button>)}
      </div>
      <div className={'receipt' + (change < 0 ? ' bad-txt' : '')}>
        <div className="big"><span>{change < 0 ? 'Falta' : 'Vuelto'}</span><strong>{formatClp(Math.abs(change))}</strong></div>
      </div>
      <div className="row-btns">
        <button className="btn ghost" onClick={props.onClose}>Cancelar</button>
        <button className="btn primary" disabled={change < 0} onClick={() => props.onConfirm(value)}>Cobrar</button>
      </div>
    </Modal>
  );
}

export function PaymentModal(props: {
  phase: PayPhase;
  label: string;
  message: string;
  sale: SaleDetail | null;
  onCancel: () => void;
  onClose: () => void;
  onNew: () => void;
}) {
  if (props.phase === 'idle') return null;
  const { sale } = props;
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        {props.phase === 'waiting' && (
          <>
            <div className="spinner" aria-hidden />
            <h3>Cobrando · {props.label}</h3>
            <p>{props.message}</p>
            <button className="btn ghost" onClick={props.onCancel}>Cancelar cobro</button>
          </>
        )}
        {props.phase === 'approved' && sale && (
          <>
            <div className="ok" aria-hidden>✓</div>
            <h3>Pago aprobado</h3>
            <Receipt sale={sale} />
            <p className="hint">Documento sin firma ni timbre: modo demostración (no se envía al SII).</p>
            <div className="row-btns">
              <button className="btn ghost" onClick={() => printReceipt(sale)}>🖨 Imprimir</button>
              <button className="btn primary" onClick={props.onNew}>Nueva venta</button>
            </div>
          </>
        )}
        {props.phase === 'rejected' && (
          <>
            <div className="bad" aria-hidden>✕</div>
            <h3>No se pudo cobrar</h3>
            <p>{props.message}</p>
            <button className="btn primary" onClick={props.onClose}>Volver al pedido</button>
          </>
        )}
        {props.phase === 'cancelled' && (
          <>
            <h3>Cobro cancelado</h3>
            <button className="btn primary" onClick={props.onClose}>Volver al pedido</button>
          </>
        )}
      </div>
    </div>
  );
}

export function Receipt({ sale }: { sale: SaleDetail }) {
  return (
    <div className="receipt">
      <div><span>Boleta electrónica N°</span><strong>{sale.document?.folio ?? '—'}</strong></div>
      {sale.customer.name && <div><span>Cliente</span><span>{sale.customer.name}</span></div>}
      {sale.discountClp > 0 && <div><span>Descuento ({sale.promotionCode})</span><span>−{formatClp(sale.discountClp)}</span></div>}
      <div><span>Neto</span><span>{formatClp(sale.netClp)}</span></div>
      <div><span>IVA 19%</span><span>{formatClp(sale.ivaClp)}</span></div>
      <div className="big"><span>Total</span><strong>{formatClp(sale.totalClp)}</strong></div>
      {sale.method === 'cash' && sale.receivedClp !== undefined && (
        <>
          <div><span>Recibido</span><span>{formatClp(sale.receivedClp)}</span></div>
          <div><strong>Vuelto</strong><strong>{formatClp(sale.changeClp ?? 0)}</strong></div>
        </>
      )}
      {sale.authCode && <div><span>Autorización</span><span>{sale.authCode}</span></div>}
    </div>
  );
}

export function printReceipt(sale: SaleDetail): void {
  const lines = sale.lines.map((l) => `<div class="r"><span>${l.quantity} × ${l.name}</span><span>${formatClp(l.unitPriceClp * l.quantity)}</span></div>`).join('');
  printHtml(`<h1>Nexus · Boleta N° ${sale.document?.folio ?? '—'}</h1><hr>${lines}<hr>
    ${sale.discountClp ? `<div class="r"><span>Descuento</span><span>−${formatClp(sale.discountClp)}</span></div>` : ''}
    <div class="r"><span>Neto</span><span>${formatClp(sale.netClp)}</span></div><div class="r"><span>IVA 19%</span><span>${formatClp(sale.ivaClp)}</span></div>
    <div class="r"><b>Total</b><b>${formatClp(sale.totalClp)}</b></div><hr><div>Documento de demostración sin timbre SII</div>`);
}
