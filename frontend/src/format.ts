import { formatClp, type Ticket } from '@nexus/core';

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

/** Imprime HTML en un iframe oculto (comanda o boleta). */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><meta charset="utf-8"><style>body{font:13px monospace;width:72mm;margin:4mm}h1{font-size:16px;margin:0 0 6px}hr{border:0;border-top:1px dashed #000}.r{display:flex;justify-content:space-between}</style>${html}`);
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

export const CHANNEL_LABEL: Record<Ticket['channel'], string> = {
  phone: '📞 Teléfono', whatsapp: '💬 WhatsApp', inperson: '🧍 Presencial', web: '🌐 Web',
};
