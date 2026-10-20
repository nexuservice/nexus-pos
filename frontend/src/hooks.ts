import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cart, CatalogItem, Channel, Customer, PayMethod, ShiftInfo } from '@nexus/core';
import { PAY_METHOD_LABEL } from '@nexus/core';
import type { PayOptions, PosApi } from './api/types';

export const msg = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado');
export type SaleDetail = Awaited<ReturnType<PosApi['rpc']['getSale']>>;

export function useCart(api: PosApi, branchId: string | null, channel: Channel) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [orderNo, setOrderNo] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const refreshCatalog = useCallback(async () => {
    if (!branchId) return;
    setCatalog(await api.rpc.catalog(branchId, channel));
    setOrderNo(await api.rpc.nextOrderNumber());
  }, [api, branchId, channel]);

  const newCart = useCallback(async () => {
    if (!branchId) return;
    setCart(await api.rpc.createCart(branchId, channel));
    await refreshCatalog();
  }, [api, branchId, channel, refreshCatalog]);

  // Al recargar la página se retoma el carrito abierto, para no dejar stock reservado sin dueño.
  const storeKey = `nexus-cart-${channel}`;
  useEffect(() => {
    (async () => {
      if (!branchId) return;
      try {
        const saved = localStorage.getItem(storeKey);
        if (saved) {
          const prev = await api.rpc.getCart(saved);
          if (prev.status === 'open' && prev.branchId === branchId) {
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
  }, [api, branchId, storeKey, newCart, refreshCatalog]);

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

/** Jornada abierta (null = sin jornada, undefined = cargando). */
export function useShift(api: PosApi) {
  const [info, setInfo] = useState<ShiftInfo | null | undefined>(undefined);
  const refresh = useCallback(async () => setInfo(await api.rpc.shiftInfo()), [api]);
  useEffect(() => { refresh().catch(() => setInfo(null)); }, [refresh]);
  return { info, refresh };
}
