import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cart, CatalogItem, Channel, Customer, PayMethod, Provider } from '@nexus/core';
import type { PosApi, SaleWithDoc } from './api/types';

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado');

export function useCart(api: PosApi, branchId: string | null, channel: Channel) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshCatalog = useCallback(async () => {
    if (branchId) setCatalog(await api.catalog(branchId, channel));
  }, [api, branchId, channel]);

  const newCart = useCallback(async () => {
    if (!branchId) return;
    setCart(await api.createCart(branchId, channel));
    await refreshCatalog();
  }, [api, branchId, channel, refreshCatalog]);

  useEffect(() => {
    newCart().catch((e) => setError(msg(e)));
  }, [newCart]);

  const guard = async (fn: () => Promise<Cart>) => {
    try {
      setError(null);
      setCart(await fn());
      await refreshCatalog();
    } catch (e) {
      setError(msg(e));
      await refreshCatalog().catch(() => undefined);
    }
  };

  return {
    cart, catalog, error, setError, refreshCatalog, newCart,
    add: (code: string, q = 1) => cart && guard(() => api.addItem(cart.id, code, q)),
    setQty: (i: number, q: number) => cart && guard(() => api.setQuantity(cart.id, i, q)),
    clear: () => cart && guard(() => api.clearCart(cart.id)),
    setCustomer: (c: Customer) => cart && guard(() => api.setCustomer(cart.id, c)),
  };
}

export type PayPhase = 'idle' | 'waiting' | 'approved' | 'rejected' | 'cancelled';

export function usePayment(api: PosApi) {
  const [phase, setPhase] = useState<PayPhase>('idle');
  const [message, setMessage] = useState('');
  const [label, setLabel] = useState('');
  const [sale, setSale] = useState<SaleWithDoc | null>(null);
  const paymentId = useRef<string | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const start = async (cartId: string, method: PayMethod, provider?: Provider, onDone?: () => void) => {
    setPhase('waiting');
    setMessage('Iniciando cobro…');
    setSale(null);
    try {
      const p = await api.pay(cartId, method, provider);
      paymentId.current = p.id;
      setLabel(method === 'cash' ? 'Efectivo' : `${method === 'debit' ? 'Débito' : 'Crédito'} · ${p.provider}`);
      stop.current?.();
      stop.current = api.watchPayment(p.id, async (e) => {
        if (e.type === 'terminal_waiting') setMessage(e.message ?? 'Esperando al terminal…');
        if (e.type === 'approved') {
          setSale(await api.sale(e.saleId!));
          setPhase('approved');
          onDone?.();
        }
        if (e.type === 'rejected') { setMessage(e.message ?? 'Rechazado'); setPhase('rejected'); onDone?.(); }
        if (e.type === 'cancelled') { setPhase('cancelled'); onDone?.(); }
      });
    } catch (e) {
      setMessage(msg(e));
      setPhase('rejected');
    }
  };

  const cancel = async () => {
    if (paymentId.current) await api.cancelPayment(paymentId.current).catch(() => undefined);
    setPhase('cancelled');
  };
  const close = () => setPhase('idle');

  return { phase, message, label, sale, start, cancel, close };
}
