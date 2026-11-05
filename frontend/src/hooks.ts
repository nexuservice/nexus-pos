import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cart, CatalogItem, Channel, Customer, PayMethod, Shift, ShiftInfo } from '@nexus/core';
import { PAY_METHOD_LABEL } from '@nexus/core';
import type { PayOptions, PosApi } from './api/types';

export const msg = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado');
export type SaleDetail = Awaited<ReturnType<PosApi['rpc']['getSale']>>;

/** `shiftId`: la caja en la que se vende (solo la caja física lo necesita; cada caja recuerda su propio carrito abierto). */
export function useCart(api: PosApi, branchId: string | null, channel: Channel, shiftId?: string | null) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [orderNo, setOrderNo] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const refreshCatalog = useCallback(async () => {
    if (!branchId) return;
    setCatalog(await api.rpc.catalog(branchId, channel));
    setOrderNo(await api.rpc.nextOrderNumber());
  }, [api, branchId, channel]);

  const needsShift = channel === 'physical';
  const newCart = useCallback(async () => {
    if (!branchId || (needsShift && !shiftId)) return;
    setCart(await api.rpc.createCart(branchId, channel, undefined, shiftId ?? undefined));
    await refreshCatalog();
  }, [api, branchId, channel, needsShift, shiftId, refreshCatalog]);

  // Al recargar la página se retoma el carrito abierto, para no dejar stock reservado sin dueño.
  const legacyKey = `nexus-cart-${channel}`;
  const storeKey = shiftId ? `${legacyKey}-${shiftId}` : legacyKey;
  useEffect(() => {
    (async () => {
      if (!branchId) return;
      if (needsShift && !shiftId) { setCart(null); return; }
      try {
        // Antes había una sola caja y un solo carrito guardado: se adopta una vez en la caja que se elija.
        const saved = localStorage.getItem(storeKey) ?? (shiftId ? localStorage.getItem(legacyKey) : null);
        if (saved) {
          let prev = await api.rpc.getCart(saved);
          if (prev.status === 'open' && prev.branchId === branchId && (!prev.shiftId || prev.shiftId === shiftId)) {
            if (shiftId && !prev.shiftId) prev = await api.rpc.assignCartShift(prev.id, shiftId);
            if (shiftId) localStorage.removeItem(legacyKey);
            setCart(prev);
            await refreshCatalog();
            return;
          }
        }
      } catch {
        /* el carrito guardado ya no existe: se crea uno nuevo */
      }
      await newCart();
    })().catch((e) => setError(msg(e)));
  }, [api, branchId, storeKey, legacyKey, needsShift, shiftId, newCart, refreshCatalog]);

  useEffect(() => {
    try {
      if (cart?.status === 'open') localStorage.setItem(storeKey, cart.id);
    } catch {
      /* sin persistencia */
    }
  }, [cart, storeKey]);

  const guard = async (fn: (id: string) => Promise<Cart>) => {
    if (!cart) return;
    try {
      setError(null);
      setCart(await fn(cart.id));
    } catch (e) {
      setError(msg(e));
    }
    await refreshCatalog().catch(() => undefined);
  };

  return {
    cart, catalog, orderNo, error, setError, refreshCatalog, newCart,
    loadCart: async (c: Cart) => { setCart(c); await refreshCatalog(); },
    add: (code: string, q = 1) => guard((id) => api.rpc.cartAdd(id, code, q)),
    setQty: (i: number, q: number) => guard((id) => api.rpc.cartSetQuantity(id, i, q)),
    clear: () => guard((id) => api.rpc.cartClear(id)),
    setCustomer: (c: Customer) => guard((id) => api.rpc.setCustomer(id, c)),
    applyPromo: (code: string) => guard((id) => api.rpc.applyPromo(id, code)),
    removePromo: () => guard((id) => api.rpc.removePromo(id)),
  };
}

export type PayPhase = 'idle' | 'waiting' | 'approved' | 'rejected' | 'cancelled';

export function usePayment(api: PosApi) {
  const [phase, setPhase] = useState<PayPhase>('idle');
  const [message, setMessage] = useState('');
  const [label, setLabel] = useState('');
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const paymentId = useRef<string | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const start = async (
    cartId: string, method: PayMethod, opts: PayOptions = {},
    hooks: { onDone?: () => void; onApproved?: (saleId: string) => void } = {},
  ) => {
    setPhase('waiting');
    setMessage('Iniciando cobro…');
    setSale(null);
    try {
      const p = await api.pay(cartId, method, opts);
      paymentId.current = p.id;
      setLabel(p.provider === 'cash' || p.provider === 'manual' ? PAY_METHOD_LABEL[method] : `${PAY_METHOD_LABEL[method]} · ${p.provider}`);
      stop.current?.();
      stop.current = api.watchPayment(p.id, async (e) => {
        if (e.type === 'terminal_waiting') setMessage(e.message ?? 'Esperando al terminal…');
        if (e.type === 'approved') {
          setSale(await api.rpc.getSale(e.saleId!));
          setPhase('approved');
          hooks.onApproved?.(e.saleId!);
          hooks.onDone?.();
        }
        if (e.type === 'rejected') { setMessage(e.message ?? 'Rechazado'); setPhase('rejected'); hooks.onDone?.(); }
        if (e.type === 'cancelled') { setPhase('cancelled'); hooks.onDone?.(); }
      });
    } catch (e) {
      setMessage(msg(e));
      setPhase('rejected');
    }
  };

  const cancel = async () => {
    if (paymentId.current) await api.rpc.cancelPayment(paymentId.current).catch(() => undefined);
    setPhase('cancelled');
  };

  return { phase, message, label, sale, start, cancel, close: () => setPhase('idle') };
}

/**
 * La caja en la que se está vendiendo (`info`: null = ninguna elegida o ya cerrada, undefined = cargando)
 * y todas las cajas abiertas (`open`), para poder elegir o cambiar de caja.
 */
export function useShift(api: PosApi, shiftId: string | null) {
  const [state, setState] = useState<{ for: string | null; info: ShiftInfo | null; open: Shift[] } | undefined>(undefined);
  const refresh = useCallback(async () => {
    const [info, open] = await Promise.all([shiftId ? api.rpc.shiftInfo(shiftId) : Promise.resolve(null), api.rpc.openShifts()]);
    setState({ for: shiftId, info, open });
  }, [api, shiftId]);
  useEffect(() => { refresh().catch(() => setState({ for: shiftId, info: null, open: [] })); }, [refresh, shiftId]);
  // Mientras se carga la caja recién elegida no se muestra la anterior.
  const ready = state && state.for === shiftId;
  return { info: ready ? state.info : undefined, open: ready ? state.open : [], refresh };
}
