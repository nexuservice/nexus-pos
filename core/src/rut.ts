/** Quita puntos y guion: "12.345.678-5" -> "123456785". */
function clean(rut: string): string {
  return rut.replace(/[.\-\s]/g, '').toUpperCase();
}

export function rutCheckDigit(body: string): string {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

export function isValidRut(rut: string): boolean {
  const c = clean(rut);
  if (!/^\d{7,8}[\dK]$/.test(c)) return false;
  return rutCheckDigit(c.slice(0, -1)) === c.slice(-1);
}

/** Formato canónico sin puntos: "12345678-5". */
export function normalizeRut(rut: string): string {
  const c = clean(rut);
  return `${c.slice(0, -1)}-${c.slice(-1)}`;
}
