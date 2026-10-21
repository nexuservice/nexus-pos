import { useEffect, useState } from 'react';
import {
  PAY_METHODS, PAY_METHOD_LABEL, WHATSAPP_TEMPLATE_LABEL, formatClp, whatsappMessage, whatsappUrl,
  type Cart, type Cashier, type Consumption, type PayMethod, type Promotion, type Shift, type ShiftInfo, type Ticket, type TicketChannel, type WhatsappTemplate,
} from '@nexus/core';
import type { PosApi } from '../api';
import { Modal } from '../components';
import { CHANNEL_LABEL, comandaHtml, fmtDate, fmtDateTime, fmtDuration, fmtTime, printHtml } from '../format';
import { msg } from '../hooks';

const Err = ({ text }: { text: string | null }) => (text ? <div className="alert" role="alert">{text}</div> : null);

/** Consumo propio: sale del inventario valorizado al costo; no es una venta ni deja ganancia. */
export function ConsumptionModal({ api, cart, onDone, onClose }: { api: PosApi; cart: Cart; onDone: () => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Consumption | null>(null);
  const units = cart.lines.reduce((n, l) => n + l.quantity, 0);
  const cost = cart.lines.reduce((n, l) => n + l.costClp * l.quantity, 0);
  const noCost = cart.lines.filter((l) => l.costClp === 0);

  const confirm = async () => {
    try { setBusy(true); setError(null); setDone(await api.rpc.registerConsumption(cart.id, note)); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Modal title="✓ Consumo registrado" onClose={onDone}>
        <div className="receipt"><div className="big"><span>Consumo #{done.number} · al costo</span><strong>{formatClp(done.costClp)}</strong></div></div>
        <p className="hint">Se descontó del inventario. No se emitió boleta ni se registró ingreso ni ganancia.</p>
        <button className="btn primary" onClick={onDone}>Nuevo pedido</button>
      </Modal>
    );
  }
  return (
    <Modal title="🍽️ Registrar consumo" onClose={onClose}>
      <p className="hint">No es una venta: los productos salen del inventario al costo, sin boleta, sin cobro y sin ganancia.</p>
      <ul className="plain">
        {cart.lines.map((l) => <li key={l.productId}>{l.quantity} × {l.name} · costo {formatClp(l.costClp)} c/u</li>)}
      </ul>
      <div className="receipt"><div className="big"><span>{units} unidad(es) al costo</span><strong>{formatClp(cost)}</strong></div></div>
      {noCost.length > 0 && (
        <div className="alert" role="alert">Sin costo definido: {noCost.map((l) => l.name).join(', ')}. Se valoriza en $0; define el costo en Administración → Productos.</div>
      )}
      <label className="field">Motivo o quién consume (opcional)
        <input autoFocus placeholder="Ej: consumo del local, merma, degustación" value={note} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && confirm()} />
      </label>
      <Err text={error} />
      <div className="row-btns">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={confirm}>Confirmar consumo</button>
      </div>
    </Modal>
  );
}

/** Pantalla central cuando no hay jornada: elegir cajero, PIN y fondo inicial. */
export function OpenShiftCard({ api, onOpened }: { api: PosApi; onOpened: () => void }) {
  const [cashiers, setCashiers] = useState<Omit<Cashier, 'pin'>[]>([]);
  const [cashierId, setCashierId] = useState('');
  const [pin, setPin] = useState('');
  const [cash, setCash] = useState('0');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.rpc.listCashiers().then((c) => {
      const active = c.filter((x) => x.active);
      setCashiers(active);
      setCashierId(active[0]?.id ?? '');
    });
  }, [api]);

  const open = async () => {
    try {
      setError(null);
      await api.rpc.openShift(cashierId, pin, Number(cash.replace(/\D/g, '')) || 0);
      onOpened();
    } catch (e) {
      setError(msg(e));
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <h2>Abrir jornada</h2>
        <p className="hint">Antes de vender, abre el turno: registra quién opera la caja y el efectivo inicial.</p>
        <label className="field">Cajero
          <select value={cashierId} onChange={(e) => setCashierId(e.target.value)}>
            {cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">PIN
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && open()} />
        </label>
        <label className="field">Efectivo inicial (fondo de caja)
          <input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} />
        </label>
        <Err text={error} />
        <button className="btn primary" disabled={!cashierId || !pin} onClick={open}>Abrir jornada</button>
        <p className="hint">Demo: cajero «Cajero 1», PIN 1234.</p>
      </div>
    </div>
  );
}

export function ShiftInfoModal({ info, onClose }: { info: ShiftInfo; onClose: () => void }) {
  const s = info.shift;
  const rows: [string, string][] = [
    ['Estado', '🟢 Abierta'], ['Cajero', s.cashierName], ['Terminal', s.terminal], ['Fecha apertura', fmtDate(s.openedAt)],
    ['Hora apertura', fmtTime(s.openedAt)], ['Tiempo transcurrido', fmtDuration(info.elapsedMs)],
    ['Efectivo inicial', formatClp(s.initialCashClp)], ['Ventas', `${info.salesCount} (${formatClp(info.salesTotalClp)})`],
  ];
  return (
    <Modal title="ℹ️ Información de Jornada" onClose={onClose}>
      <dl className="kv">{rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}</dl>
      <button className="btn ghost" onClick={onClose}>Cerrar</button>
    </Modal>
  );
}

/** Cierre con arqueo: monto contado por forma de pago contra lo esperado. */
export function ShiftCloseModal({ api, info, onClosed, onCancel }: { api: PosApi; info: ShiftInfo; onClosed: (s: Shift) => void; onCancel: () => void }) {
  const methods = PAY_METHODS.filter((m) => info.expected[m] !== undefined);
  const [counted, setCounted] = useState<Record<string, string>>(() => Object.fromEntries(methods.map((m) => [m, String(info.expected[m] ?? 0)])));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const num = (m: PayMethod) => Number((counted[m] ?? '').replace(/\D/g, '')) || 0;

  const close = async () => {
    try {
      setError(null);
      const payload = Object.fromEntries(methods.map((m) => [m, num(m)]));
      onClosed(await api.rpc.closeShift(payload, notes));
    } catch (e) {
      setError(msg(e));
    }
  };

  return (
    <Modal title="Cerrar jornada" onClose={onCancel}>
      <p className="hint">Cuenta lo que hay por forma de pago. El efectivo esperado es el fondo inicial más lo cobrado en efectivo (ya descontados los vueltos).</p>
      <h4>Monto contado por forma de pago (CLP)</h4>
      {methods.map((m) => {
        const diff = num(m) - (info.expected[m] ?? 0);
        return (
          <label className="field" key={m}>
            {PAY_METHOD_LABEL[m]} <small>(esperado: {formatClp(info.expected[m] ?? 0)})</small>
            <input inputMode="numeric" value={counted[m] ?? ''} onChange={(e) => setCounted({ ...counted, [m]: e.target.value })} />
            {diff !== 0 && <small className={diff < 0 ? 'bad-txt' : 'warn-txt'}>{diff < 0 ? 'Faltante' : 'Sobrante'}: {formatClp(Math.abs(diff))}</small>}
          </label>
        );
      })}
      <label className="field">Notas
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <Err text={error} />
      <div className="row-btns">
        <button className="btn danger" onClick={close}>Cerrar jornada</button>
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </Modal>
  );
}

export function ShiftSummaryModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  return (
    <Modal title="Jornada cerrada" onClose={onClose}>
      <dl className="kv">
        <div><dt>Cajero</dt><dd>{shift.cashierName}</dd></div>
        <div><dt>Ventas</dt><dd>{shift.salesCount} ({formatClp(shift.salesTotalClp ?? 0)})</dd></div>
        {PAY_METHODS.filter((m) => shift.difference?.[m] !== undefined).map((m) => (
          <div key={m}><dt>{PAY_METHOD_LABEL[m]}: contado {formatClp(shift.counted?.[m] ?? 0)}</dt><dd className={(shift.difference?.[m] ?? 0) === 0 ? '' : 'bad-txt'}>
            {(shift.difference?.[m] ?? 0) === 0 ? 'Cuadra' : `Diferencia ${formatClp(shift.difference?.[m] ?? 0)}`}</dd></div>
        ))}
      </dl>
      <button className="btn primary" onClick={onClose}>Aceptar</button>
    </Modal>
  );
}

export interface HoldData { customerName: string; phone: string; email: string; channel: TicketChannel; note: string; paid: boolean; method: PayMethod }

/** "Dejar pedido abierto": retiene el pedido (pendiente de pago) o lo cobra de inmediato (ya pagó). */
export function HoldModal(props: { summary: string; defaultName: string; onSave: (d: HoldData) => Promise<void>; onClose: () => void }) {
  const [d, setD] = useState<HoldData>({ customerName: props.defaultName, phone: '', email: '', channel: 'phone', note: '', paid: false, method: 'cash' });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<HoldData>) => setD({ ...d, ...p });
  const save = async () => {
    if (!d.customerName.trim()) return setError('Escribe quién hizo el pedido.');
    try { setError(null); await props.onSave(d); } catch (e) { setError(msg(e)); }
  };
  return (
    <Modal title="📋 Dejar pedido abierto" onClose={props.onClose}>
      <p className="hint">{props.summary}</p>
      <label className="field">Nombre del cliente *
        <input autoFocus placeholder="Quién hizo el pedido" value={d.customerName} onChange={(e) => set({ customerName: e.target.value })} />
      </label>
      <div className="two-col">
        <label className="field">Teléfono / WhatsApp<input placeholder="+56 9 …" value={d.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
        <label className="field">Correo<input type="email" placeholder="opcional" value={d.email} onChange={(e) => set({ email: e.target.value })} /></label>
      </div>
      <label className="field">Canal
        <select value={d.channel} onChange={(e) => set({ channel: e.target.value as TicketChannel })}>
          {(Object.keys(CHANNEL_LABEL) as TicketChannel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </select>
      </label>
      <label className="field">Observación
        <textarea rows={2} placeholder="Hora de retiro, indicaciones de preparación, etc." value={d.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <div className="radio-cards">
        <label className={!d.paid ? 'on' : ''}><input type="radio" checked={!d.paid} onChange={() => set({ paid: false })} /> <b>Pendiente de pago</b><small>Se cobra cuando el cliente retire.</small></label>
        <label className={d.paid ? 'on' : ''}><input type="radio" checked={d.paid} onChange={() => set({ paid: true })} /> <b>Ya pagó</b><small>Se emite la boleta ahora.</small></label>
      </div>
      {d.paid && (
        <label className="field">Medio de pago
          <select value={d.method} onChange={(e) => set({ method: e.target.value as PayMethod })}>
            {PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}
          </select>
        </label>
      )}
      <Err text={error} />
      <div className="row-btns">
        <button className="btn primary" onClick={save}>📋 {d.paid ? 'Cobrar y guardar' : 'Guardar pedido'}</button>
        <button className="btn ghost" onClick={props.onClose}>Cancelar</button>
      </div>
      <p className="hint">Al guardar se imprime la comanda con los datos del cliente.</p>
    </Modal>
  );
}

export function TicketsModal(props: { api: PosApi; onResume: (t: Ticket) => void; onChanged: () => void; onClose: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [view, setView] = useState<'cards' | 'table'>(() => (localStorage.getItem('nexus-tickets-view') === 'table' ? 'table' : 'cards'));
  const [q, setQ] = useState('');
  const [wa, setWa] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => setTickets(await props.api.rpc.listTickets());
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    try { setError(null); await fn(); await load(); props.onChanged(); } catch (e) { setError(msg(e)); }
  };
  const shown = tickets.filter((t) => `${t.number} ${t.customerName} ${t.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const setV = (v: 'cards' | 'table') => { setView(v); try { localStorage.setItem('nexus-tickets-view', v); } catch { /* nada */ } };

  const actions = (t: Ticket) => (
    <div className="ticket-actions">
      {!t.paid ? <button className="btn primary sm" onClick={() => props.onResume(t)}>Cobrar</button>
        : <button className="btn primary sm" onClick={() => act(() => props.api.rpc.completeTicket(t.id))}>Entregado</button>}
      {t.phone && <button className="btn ghost sm" onClick={() => setWa(t)}>💬 WhatsApp</button>}
      <button className="btn ghost sm" onClick={() => printHtml(comandaHtml(t))}>🖨 Comanda</button>
      {!t.paid && <button className="btn ghost sm" onClick={() => confirm('¿Cancelar este pedido y liberar su stock?') && act(() => props.api.rpc.cancelTicket(t.id))}>Cancelar</button>}
    </div>
  );

  return (
    <Modal title={`📋 Pedidos abiertos (${tickets.length})`} wide onClose={props.onClose}>
      <div className="toolbar-row">
        <input className="search" placeholder="Buscar por número, nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="seg"><button className={view === 'cards' ? 'on' : ''} onClick={() => setV('cards')}>Tarjetas</button><button className={view === 'table' ? 'on' : ''} onClick={() => setV('table')}>Tabla</button></div>
      </div>
      <Err text={error} />
      {tickets.length === 0 && <p className="empty">No hay pedidos abiertos.<br /><small>Arma una venta y usa «Dejar pedido abierto» para registrar uno.</small></p>}
      {tickets.length > 0 && shown.length === 0 && <p className="empty">Sin coincidencias.</p>}
      {view === 'cards' ? (
        <div className="ticket-cards">
          {shown.map((t) => (
            <article className="ticket" key={t.id}>
              <header><b>#{t.number}</b><span className={'pill ' + (t.paid ? 'ok' : 'warn')}>{t.paid ? 'Pagado' : 'Pendiente de pago'}</span></header>
              <div><strong>{t.customerName}</strong> · {CHANNEL_LABEL[t.channel]}</div>
              {t.phone && <small>{t.phone}</small>}
              <ul>{t.lines.map((l) => <li key={l.productId}>{l.quantity} × {l.name}</li>)}</ul>
              {t.note && <em>{t.note}</em>}
              <div className="ticket-total">{formatClp(t.totalClp)} <small>{fmtDateTime(t.createdAt)}</small></div>
              {actions(t)}
            </article>
          ))}
        </div>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th>N°</th><th>Cliente</th><th>Canal</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{shown.map((t) => (
            <tr key={t.id}><td>#{t.number}</td><td>{t.customerName}</td><td>{CHANNEL_LABEL[t.channel]}</td><td>{formatClp(t.totalClp)}</td>
              <td>{t.paid ? 'Pagado' : 'Pendiente'}</td><td>{actions(t)}</td></tr>))}</tbody>
        </table></div>
      )}
      <button className="btn ghost" onClick={props.onClose}>Cerrar</button>
      {wa && <WhatsappModal ticket={wa} onClose={() => setWa(null)} />}
    </Modal>
  );
}

/** Mensaje por WhatsApp (enlace wa.me): el envío se confirma en WhatsApp, no hay API. */
function WhatsappModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const [kind, setKind] = useState<WhatsappTemplate>('ready');
  const [phone, setPhone] = useState(ticket.phone ?? '');
  const [text, setText] = useState(() => whatsappMessage(ticket, 'ready'));
  const url = whatsappUrl(phone, text);
  const pick = (k: WhatsappTemplate) => { setKind(k); setText(whatsappMessage(ticket, k)); };
  return (
    <Modal title={`💬 WhatsApp · pedido #${ticket.number}`} onClose={onClose}>
      <div className="chips">
        {(Object.keys(WHATSAPP_TEMPLATE_LABEL) as WhatsappTemplate[]).map((k) => (
          <button key={k} className={'chip' + (k === kind ? ' on' : '')} onClick={() => pick(k)}>{WHATSAPP_TEMPLATE_LABEL[k]}</button>
        ))}
      </div>
      <label className="field">Número <small>(a 9 dígitos se agrega +56; para otro país usa +código)</small>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="field">Mensaje<textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
      {!url && <Err text="Revisa el número de teléfono." />}
      <div className="row-btns">
        <a className={'btn primary' + (url ? '' : ' disabled')} href={url ?? undefined} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
        <button className="btn ghost" onClick={onClose}>Cerrar</button>
      </div>
      <p className="hint">Se abre un chat de WhatsApp: confirma el envío allí. Abrirlo no marca el pedido como entregado.</p>
    </Modal>
  );
}

/** Promociones activas, aplicar por botón y crear una nueva. */
export function PromosModal(props: { api: PosApi; canApply: boolean; onApply: (code: string) => void; onClose: () => void }) {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [creating, setCreating] = useState(false);
  const load = async () => setPromos(await props.api.rpc.activePromotions());
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="🏷️ Promociones activas" wide onClose={props.onClose}>
      {promos.length === 0 && <p className="empty">No hay promociones activas.</p>}
      {promos.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Valor</th><th>Código</th><th>Válida hasta</th><th /></tr></thead>
          <tbody>{promos.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.type === 'percent' ? '% Porcentaje' : '$ Monto fijo'}</td>
              <td>{p.type === 'percent' ? `${p.value}%` : formatClp(p.value)}</td><td><code>{p.code}</code></td>
              <td>{p.validUntil ? p.validUntil.split('-').reverse().join('/') : 'Sin vencimiento'}</td>
              <td><button className="btn primary sm" disabled={!props.canApply} title={props.canApply ? '' : 'Agrega productos primero'} onClick={() => { props.onApply(p.code); props.onClose(); }}>Aplicar</button></td></tr>))}</tbody>
        </table></div>
      )}
      {creating ? (
        <PromoForm api={props.api} onSaved={async () => { setCreating(false); await load(); }} onCancel={() => setCreating(false)} />
      ) : (
        <div className="row-btns">
          <button className="btn ghost" onClick={() => setCreating(true)}>➕ Crear promoción</button>
          <button className="btn primary" onClick={props.onClose}>Cerrar</button>
        </div>
      )}
    </Modal>
  );
}

export function PromoForm(props: { api: PosApi; initial?: Promotion; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: props.initial?.name ?? '', type: (props.initial?.type ?? 'percent') as Promotion['type'], value: String(props.initial?.value ?? ''),
    code: props.initial?.code ?? '', validUntil: props.initial?.validUntil ?? '', active: props.initial?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      setError(null);
      await props.api.rpc.upsertPromotion({ id: props.initial?.id, name: f.name, type: f.type, value: Number(f.value), code: f.code, validUntil: f.validUntil || undefined, active: f.active });
      props.onSaved();
    } catch (e) { setError(msg(e)); }
  };
  return (
    <div className="inline-form">
      <h4>{props.initial ? 'Editar promoción' : 'Nueva promoción'}</h4>
      <div className="two-col">
        <label className="field">Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Código<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
        <label className="field">Tipo
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Promotion['type'] })}>
            <option value="percent">% Porcentaje</option><option value="fixed">$ Monto fijo</option>
          </select>
        </label>
        <label className="field">Valor {f.type === 'percent' ? '(%)' : '(CLP)'}<input inputMode="numeric" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
        <label className="field">Válida hasta<input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activa</label>
      </div>
      <Err text={error} />
      <div className="row-btns">
        <button className="btn primary" onClick={save}>Guardar promoción</button>
        <button className="btn ghost" onClick={props.onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
