import { PAY_METHOD_LABEL, formatClp, splitIva, type ClientBalance, type StockCard, type Ticket } from '@nexus/core';

export function download(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV para Excel en español: separador ";" y BOM UTF-8 para que respete las tildes. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour12: false });
export const fmtDateTime = (iso: string) => `${fmtDate(iso)} ${fmtTime(iso)}`;
export const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const TICKET_CSS = 'body{font:13px monospace;width:72mm;margin:4mm}h1{font-size:16px;margin:0 0 6px}hr{border:0;border-top:1px dashed #000}.r{display:flex;justify-content:space-between}';
const SHEET_CSS = 'body{font:12px Arial,sans-serif;margin:12mm}h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border-bottom:1px solid #aaa;padding:4px 6px;text-align:left}th{background:#eee}.n{text-align:right}.muted{color:#555}';

/** Imprime HTML en un iframe oculto: ticket de 72 mm (comanda, boleta) u hoja completa (tablas). */
export function printHtml(html: string, page: 'ticket' | 'sheet' = 'ticket'): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><meta charset="utf-8"><style>${page === 'sheet' ? SHEET_CSS : TICKET_CSS}</style>${html}`);
  doc.close();
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 2000);
}

export function comandaHtml(t: Ticket, business = 'Nexus'): string {
  const lines = t.lines.map((l) => `<div class="r"><span>${l.quantity} × ${esc(l.name)}</span><span>${formatClp(l.unitPriceClp * l.quantity)}</span></div>`).join('');
  return `<h1>${esc(business)} · COMANDA #${t.number}</h1><div>${esc(fmtDateTime(t.createdAt))}</div><hr>
    <div><b>${esc(t.customerName)}</b></div>${t.phone ? `<div>Tel: ${esc(t.phone)}</div>` : ''}<div>Canal: ${esc(CHANNEL_LABEL[t.channel])}</div>
    ${t.note ? `<div>Obs.: ${esc(t.note)}</div>` : ''}<hr>${lines}<hr><div class="r"><b>Total</b><b>${formatClp(t.totalClp)}</b></div>
    <div>${t.paid ? 'PAGADO' : 'PENDIENTE DE PAGO'}</div>`;
}

/**
 * Estado de cuenta de convenio: cada compra con sus productos, los abonos y el saldo,
 * para que el cliente revise lo que se le cobra antes de pagar.
 */
export function estadoCuentaHtml(b: ClientBalance, business = 'Nexus'): string {
  const small = (s: string) => `<div style="color:#444;font-size:11px">${s}</div>`;
  const sales = [...b.sales].reverse().map((s) => {
    const items = s.lines.map((l) => `<div class="r"><span>${l.quantity} × ${esc(l.name)}</span><span>${formatClp(l.unitPriceClp * l.quantity)}</span></div>${l.quantity > 1 ? small(`&nbsp;&nbsp;${formatClp(l.unitPriceClp)} c/u`) : ''}`).join('');
    const discount = s.discountClp > 0 ? `<div class="r"><span>Descuento</span><span>−${formatClp(s.discountClp)}</span></div>` : '';
    return `<div class="r"><b>Compra #${s.number}</b><span>${esc(fmtDateTime(s.paidAt))}</span></div>${items}${discount}<div class="r"><b>Total compra</b><b>${formatClp(s.totalClp)}</b></div><hr>`;
  }).join('');
  const payments = b.payments.length
    ? [...b.payments].reverse().map((p) => `<div class="r"><span>${esc(fmtDateTime(p.at))} · ${esc(PAY_METHOD_LABEL[p.method])}</span><span>−${formatClp(p.amountClp)}</span></div>`).join('')
    : '<div>Sin abonos</div>';
  return `<h1>${esc(business)} · ESTADO DE CUENTA</h1><div>Compras a convenio (crédito)</div><div>Emitido: ${esc(fmtDateTime(new Date().toISOString()))}</div><hr>
    <div><b>${esc(b.clientName)}</b></div>${b.clientRut ? `<div>RUT: ${esc(b.clientRut)}</div>` : ''}<hr>
    <div><b>COMPRAS</b></div>${sales || '<div>Sin compras a convenio</div><hr>'}
    <div><b>ABONOS</b></div>${payments}<hr>
    <div class="r"><span>Total comprado</span><span>${formatClp(b.creditSalesClp)}</span></div>
    <div class="r"><span>Total abonado</span><span>${formatClp(b.paidClp)}</span></div>
    <div class="r" style="font-size:15px"><b>SALDO A PAGAR</b><b>${formatClp(b.debtClp)}</b></div><hr>
    ${small('Revise cada compra antes de pagar. Las compras anuladas no se incluyen.')}`;
}

const STOCK_CHANNEL_LABEL = { all: 'Total (caja + online)', physical: 'Caja', online: 'Online' } as const;

/** Tarjeta de existencia lista para imprimir en hoja: del movimiento más antiguo al más nuevo, con saldo. */
export function stockCardHtml(card: StockCard, range: { from?: string; to?: string } = {}, business = 'Nexus'): string {
  const rows = [...card.rows].reverse().map((r) =>
    `<tr><td>${esc(fmtDate(r.at))}${r.dateOnly ? '' : ` ${esc(fmtTime(r.at))}`}</td><td>${esc(r.detail)}</td>${card.channel === 'all' ? `<td>${r.channel === 'physical' ? 'Caja' : 'Online'}</td>` : ''}<td class="n">${r.entry || ''}</td><td class="n">${r.exit || ''}</td><td class="n"><b>${r.balance}</b></td></tr>`).join('');
  const cols = card.channel === 'all' ? 6 : 5;
  const period = range.from || range.to ? ` · Período: ${esc(range.from ?? 'inicio')} a ${esc(range.to ?? 'hoy')}` : '';
  return `<h1>${esc(business)} · Tarjeta de existencia</h1>
    <div><b>${esc(card.product.name)}</b> · SKU ${esc(card.product.sku)} · Código ${esc(card.product.barcode)}</div>
    <div class="muted">${STOCK_CHANNEL_LABEL[card.channel]}${period} · Emitida ${esc(fmtDateTime(new Date().toISOString()))}</div>
    <div class="muted">Existencia actual ${card.currentQty} · Costo unitario ${formatClp(card.product.costClp)} · Precio neto de venta unitario ${formatClp(splitIva(card.product.priceClp).netClp)} (${formatClp(card.product.priceClp)} con IVA)</div>
    <table><thead><tr><th>Fecha</th><th>Detalle</th>${card.channel === 'all' ? '<th>Canal</th>' : ''}<th class="n">Entrada</th><th class="n">Salida</th><th class="n">Saldo</th></tr></thead>
    <tbody><tr><td colspan="${cols - 1}"><i>Saldo inicial</i></td><td class="n"><b>${card.openingQty}</b></td></tr>${rows}
    <tr><td colspan="${cols - 3}"><b>Totales</b></td><td class="n"><b>${card.entries}</b></td><td class="n"><b>${card.exits}</b></td><td class="n"><b>${card.closingQty}</b></td></tr></tbody></table>`;
}

export const CHANNEL_LABEL: Record<Ticket['channel'], string> = {
  phone: '📞 Teléfono', whatsapp: '💬 WhatsApp', inperson: '🧍 Presencial', web: '🌐 Web',
};
