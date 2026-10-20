export const IVA_RATE = 0.19;

/** Los precios en Chile se publican con IVA incluido: separa neto e IVA de un total en CLP. */
export function splitIva(totalClp: number): { netClp: number; ivaClp: number } {
  const netClp = Math.round(totalClp / (1 + IVA_RATE));
  return { netClp, ivaClp: totalClp - netClp };
}

export function formatClp(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CL');
}
