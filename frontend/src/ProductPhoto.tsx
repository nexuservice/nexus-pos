import { useEffect, useState } from 'react';
import type { PosApi } from './api';

/** Fotos ya descargadas, por sesión (cada negocio tiene sus propios ids) y por versión de la foto. */
const caches = new WeakMap<PosApi, Map<string, Promise<string | null>>>();

/** Foto de un producto, pedida al servidor con la sesión del negocio. No muestra nada si el producto no tiene foto. */
export function ProductPhoto({ api, productId, version, className, alt = '' }: { api: PosApi; productId?: string; version?: number; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!productId || !version) { setSrc(null); return; }
    let live = true;
    let cache = caches.get(api);
    if (!cache) { cache = new Map(); caches.set(api, cache); }
    const key = `${productId}:${version}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = api.getProductImage(productId).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null);
      cache.set(key, pending);
    }
    pending.then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [api, productId, version]);
  return src ? <img className={className} src={src} alt={alt} /> : null;
}
