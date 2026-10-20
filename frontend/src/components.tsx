import type { Cart } from '@nexus/core';
import { formatClp } from '@nexus/core';
import type { PayPhase } from './hooks';
import type { SaleWithDoc } from './api/types';

export function CartPanel(props: {
  cart: Cart | null;
  onQty: (index: number, q: number) => void;
  onClear: () => void;
  footer: React.ReactNode;
  title?: string;
}) {
  const { cart } = props;
  return (
    <aside className="cart">
      <div className="cart-head">
        <h2>{props.title ?? 'Pedido'}</h2>
        <button className="link" onClick={props.onClear} disabled={!cart?.lines.length}>Limpiar</button>
      </div>
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
          </div>
        ))}
      </div>
      <div className="cart-foot">
        <div className="total"><span>Total</span><strong>{formatClp(cart?.totalClp ?? 0)}</strong></div>
        {props.footer}
      </div>
    </aside>
  );
}

export function PaymentModal(props: {
  phase: PayPhase;
  label: string;
  message: string;
  sale: SaleWithDoc | null;
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
            <div className="receipt">
              <div><span>Boleta electrónica N°</span><strong>{sale.document?.folio ?? '—'}</strong></div>
              <div><span>Neto</span><span>{formatClp(sale.netClp)}</span></div>
              <div><span>IVA 19%</span><span>{formatClp(sale.ivaClp)}</span></div>
              <div className="big"><span>Total</span><strong>{formatClp(sale.totalClp)}</strong></div>
              {sale.authCode && <div><span>Autorización</span><span>{sale.authCode}</span></div>}
            </div>
            <p className="hint">Documento sin firma ni timbre: modo demostración (no se envía al SII).</p>
            <button className="btn primary" onClick={props.onNew}>Nueva venta</button>
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
