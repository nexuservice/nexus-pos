export interface Session {
  token: string;
  /** Vencimiento, en ms desde epoch. */
  expiresAt: number;
  business: { name: string; rut: string; webStore?: boolean; slug?: string | null };
  webStore?: boolean;
  slug?: string | null;
  /** Sin este campo la sesión es la del administrador (dueño). «cashier» es el perfil limitado de cajero. */
  role?: 'cashier';
  cashierName?: string;
}

const KEY = 'nexus-session';

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
    return s && typeof s.token === 'string' && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: la sesión dura mientras la pestaña siga abierta */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}
