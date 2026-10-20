import type { CartLine, Customer, Emisor } from './types';
import { splitIva } from './money';

export interface BoletaInput {
  folio: number;
  /** YYYY-MM-DD */
  date: string;
  emisor: Emisor;
  receptor?: Customer;
  lines: CartLine[];
  /** Descuento global (CLP, IVA incluido). */
  discountClp?: number;
  /** Total final, ya con el descuento aplicado. */
  totalClp: number;
}

export interface ParsedBoleta {
  tipoDte: number;
  folio: number;
  date: string;
  mntNeto: number;
  iva: number;
  mntTotal: number;
  discountClp: number;
  items: { name: string; quantity: number; unitPriceClp: number; amountClp: number }[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const unesc = (s: string) =>
  s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

/**
 * Boleta electrónica (DTE tipo 39) con la estructura de datos del esquema público del SII.
 * Los precios del detalle incluyen IVA. NO incluye timbre (TED), CAF ni firma digital:
 * es el documento estructurado listo para firmarse y enviarse con un certificador.
 */
export function buildBoletaXml(i: BoletaInput): string {
  const { netClp, ivaClp } = splitIva(i.totalClp);
  const receptor = i.receptor?.rut
    ? `<RUTRecep>${esc(i.receptor.rut)}</RUTRecep><RznSocRecep>${esc(i.receptor.name ?? 'Cliente')}</RznSocRecep>`
    : `<RUTRecep>66666666-6</RUTRecep>`;
  const detalle = i.lines
    .map(
      (l, n) =>
        `<Detalle><NroLinDet>${n + 1}</NroLinDet><NmbItem>${esc(l.name)}</NmbItem><QtyItem>${l.quantity}</QtyItem><PrcItem>${l.unitPriceClp}</PrcItem><MontoItem>${l.unitPriceClp * l.quantity}</MontoItem></Detalle>`,
    )
    .join('');
  const descuento = i.discountClp
    ? `<DscRcgGlobal><NroLinDR>1</NroLinDR><TpoMov>D</TpoMov><TpoValor>$</TpoValor><ValorDR>${i.discountClp}</ValorDR></DscRcgGlobal>`
    : '';
  return (
    `<?xml version="1.0" encoding="ISO-8859-1"?>` +
    `<DTE version="1.0"><Documento ID="B${i.folio}T39"><Encabezado>` +
    `<IdDoc><TipoDTE>39</TipoDTE><Folio>${i.folio}</Folio><FchEmis>${i.date}</FchEmis><IndServicio>3</IndServicio></IdDoc>` +
    `<Emisor><RUTEmisor>${esc(i.emisor.rut)}</RUTEmisor><RznSocEmisor>${esc(i.emisor.razonSocial)}</RznSocEmisor><GiroEmisor>${esc(i.emisor.giro)}</GiroEmisor><DirOrigen>${esc(i.emisor.direccion)}</DirOrigen><CmnaOrigen>${esc(i.emisor.comuna)}</CmnaOrigen></Emisor>` +
    `<Receptor>${receptor}</Receptor>` +
    `<Totales><MntNeto>${netClp}</MntNeto><IVA>${ivaClp}</IVA><MntTotal>${i.totalClp}</MntTotal></Totales>` +
    `</Encabezado>${detalle}${descuento}</Documento></DTE>`
  );
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  if (!m) throw new Error(`Falta <${name}> en la boleta`);
  return unesc(m[1]!);
}

export function parseBoletaXml(xml: string): ParsedBoleta {
  const items = [...xml.matchAll(/<Detalle>(.*?)<\/Detalle>/g)].map((m) => ({
    name: tag(m[1]!, 'NmbItem'),
    quantity: Number(tag(m[1]!, 'QtyItem')),
    unitPriceClp: Number(tag(m[1]!, 'PrcItem')),
    amountClp: Number(tag(m[1]!, 'MontoItem')),
  }));
  const dr = /<DscRcgGlobal>.*?<ValorDR>(\d+)<\/ValorDR>/.exec(xml);
  return {
    tipoDte: Number(tag(xml, 'TipoDTE')),
    folio: Number(tag(xml, 'Folio')),
    date: tag(xml, 'FchEmis'),
    mntNeto: Number(tag(xml, 'MntNeto')),
    iva: Number(tag(xml, 'IVA')),
    mntTotal: Number(tag(xml, 'MntTotal')),
    discountClp: dr ? Number(dr[1]) : 0,
    items,
  };
}
