import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Prefs {
  theme: 'auto' | 'light' | 'dark';
  headerInfo: boolean;
  payAlways: boolean;
  compactCart: boolean;
  /** Porcentaje (70–160). */
  btnScale: number;
  fontScale: number;
  showSearch: boolean;
  showBarcode: boolean;
  showAll: boolean;
}

const DEFAULTS: Prefs = {
  theme: 'auto', headerInfo: true, payAlways: true, compactCart: false, btnScale: 100, fontScale: 100,
  showSearch: true, showBarcode: true, showAll: true,
};
const KEY = 'nexus-prefs';

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

interface Ctx {
  prefs: Prefs;
  set: (p: Partial<Prefs>) => void;
}
const SettingsCtx = createContext<Ctx>({ prefs: DEFAULTS, set: () => undefined });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
    root.style.setProperty('--btn-scale', String(prefs.btnScale / 100));
    root.style.setProperty('--font-scale', String(prefs.fontScale / 100));
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* sin persistencia */
    }
  }, [prefs]);

  const set = useCallback((p: Partial<Prefs>) => setPrefs((cur) => ({ ...cur, ...p })), []);
  const value = useMemo(() => ({ prefs, set }), [prefs, set]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export const useSettings = () => useContext(SettingsCtx);
export const clampScale = (n: number) => Math.min(160, Math.max(70, n));
