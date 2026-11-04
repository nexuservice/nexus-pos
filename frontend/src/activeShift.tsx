import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * La caja (jornada) en la que está vendiendo ESTE equipo. Puede haber varias cajas abiertas a la vez;
 * cada equipo recuerda la suya mientras la pestaña siga abierta (sessionStorage), no en todo el navegador.
 */
const KEY = 'nexus-active-shift';

const read = (): string | null => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};

export function clearActiveShift() {
  try { sessionStorage.removeItem(KEY); } catch { /* sin persistencia */ }
}

interface Ctx { shiftId: string | null; setShiftId: (id: string | null) => void }
const ActiveShiftContext = createContext<Ctx>({ shiftId: null, setShiftId: () => undefined });

export function ActiveShiftProvider({ children }: { children: ReactNode }) {
  const [shiftId, setId] = useState<string | null>(read);
  const setShiftId = useCallback((id: string | null) => {
    setId(id);
    try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); } catch { /* sin persistencia */ }
  }, []);
  const value = useMemo(() => ({ shiftId, setShiftId }), [shiftId, setShiftId]);
  return <ActiveShiftContext.Provider value={value}>{children}</ActiveShiftContext.Provider>;
}

export const useActiveShift = () => useContext(ActiveShiftContext);
