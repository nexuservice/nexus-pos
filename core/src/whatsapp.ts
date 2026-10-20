import type { Ticket } from './types';
import { formatClp } from './money';

export type WhatsappTemplate = 'ready' | 'preparing' | 'detail' | 'notice';

export const WHATSAPP_TEMPLATE_LABEL: Record<WhatsappTemplate, string> = {
  ready: 'Pedido listo', preparing: 'En preparación', detail: 'Detalle del pedido', notice: 'Aviso',
};

/**
 * Normaliza un teléfono para wa.me: a los números chilenos de 9 dígitos se les agrega +56;
 * cualquier otro número debe traer su código de país con "+".
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits.slice(1);
  if (/^\d{9}$/.test(digits)) return `56${digits}`;
  if (/^56\d{9}$/.test(digits)) return digits;
  return null;
}

export function whatsappMessage(t: Pick<Ticket, 'number' | 'customerName' | 'lines' | 'totalClp' | 'paid'>, kind: WhatsappTemplate, business = 'Nexus'): string {
  const hi = `Hola ${t.customerName}, `;
  switch (kind) {
    case 'ready': return `${hi}tu pedido #${t.number} ya está listo para retirar. ¡Te esperamos! — ${business}`;
    case 'preparing': return `${hi}estamos preparando tu pedido #${t.number}. Te avisamos cuando esté listo. — ${business}`;
    case 'detail': {
      const items = t.lines.map((l) => `• ${l.quantity} × ${l.name} (${formatClp(l.unitPriceClp * l.quantity)})`).join('\n');
      return `${hi}este es el detalle de tu pedido #${t.number}:\n${items}\nTotal: ${formatClp(t.totalClp)} (${t.paid ? 'pagado' : 'pendiente de pago'}) — ${business}`;
    }
    case 'notice': return `${hi}te escribimos por tu pedido #${t.number}. — ${business}`;
  }
}

/** Enlace wa.me con el mensaje; no usa ninguna API, el usuario confirma el envío en WhatsApp. */
export function whatsappUrl(phone: string, message: string): string | null {
  const n = normalizePhone(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
}
