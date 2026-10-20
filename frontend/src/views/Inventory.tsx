import { useCallback, useEffect, useState } from 'react';
import type { InventoryRow } from '@nexus/core';
import type { PosApi } from '../api';

export function InventoryView({ api, branchId }: { api: PosApi; branchId: string | null }) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (branchId) setRows(await api.inventory(branchId));
  }, [api, branchId]);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const move = async (productId: string, from: 'physical' | 'online', to: 'physical' | 'online') => {
    if (!branchId) return;
    try {
      setError(null);
      await api.moveStock(branchId, productId, from, to, 5);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Inventario por canal</h1></div>
      <p className="hint">Mueve unidades entre la caja y la tienda online. Reservado = en carritos abiertos.</p>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Producto</th><th>Caja</th><th>Online</th><th>Mover 5</th></tr>
          </thead>
          <tbody>
            {rows.map(({ product, physical, online }) => (
              <tr key={product.id}>
                <td>{product.name}{!product.published && <span className="tag">solo local</span>}</td>
                <td>{physical.qty}{physical.reserved > 0 && <small> ({physical.reserved} res.)</small>}</td>
                <td>{online.qty}{online.reserved > 0 && <small> ({online.reserved} res.)</small>}</td>
                <td>
                  <button className="btn ghost sm" onClick={() => move(product.id, 'physical', 'online')} disabled={!product.published}>→ Online</button>{' '}
                  <button className="btn ghost sm" onClick={() => move(product.id, 'online', 'physical')}>→ Caja</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
