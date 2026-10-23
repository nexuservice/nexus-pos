import { useEffect, useState } from 'react';
import type { Business } from '@nexus/core';
import type { PosApi } from '../api';
import { setPrintBusiness } from '../format';
import { msg } from '../hooks';

/** Datos de la empresa: salen en el encabezado de los comprobantes de venta. */
export function BusinessSection({ api }: { api: PosApi }) {
  const [f, setF] = useState<Business>({ name: '' });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.rpc.getBusiness().then(setF); }, [api]);
  const set = (p: Partial<Business>) => { setF({ ...f, ...p }); setSaved(false); };
  const field = (key: keyof Business, label: string, placeholder?: string) => (
    <label className="field">{label}<input value={f[key] ?? ''} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value })} /></label>
  );

  const save = async () => {
    try {
      setError(null);
      const b = await api.rpc.updateBusiness(f);
      setF(b);
      setPrintBusiness(b);
      setSaved(true);
    } catch (e) {
      setError(msg(e));
    }
  };

  return (
    <>
      <div className="page-head"><h2>Mi negocio</h2></div>
      <p className="hint">Estos datos aparecen en el encabezado de tus comprobantes de venta internos.</p>
      <div className="inline-form">
        <div className="two-col">
          {field('name', 'Nombre del negocio *')}
          {field('rut', 'RUT', '76.123.456-0')}
          {field('razonSocial', 'Razón social')}
          {field('giro', 'Giro')}
          {field('direccion', 'Dirección')}
          {field('comuna', 'Comuna')}
          {field('phone', 'Teléfono')}
        </div>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="row-btns">
          {saved && <span className="pill ok">Guardado</span>}
          <button className="btn primary" onClick={save}>Guardar</button>
        </div>
      </div>
    </>
  );
}
