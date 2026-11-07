import { useEffect, useState } from 'react';
import type { Business } from '@nexus/core';
import type { PosApi } from '../api';
import { download, setPrintBusiness } from '../format';
import { msg } from '../hooks';

/** Datos de la empresa: salen en el encabezado de los comprobantes de venta. */
export function BusinessSection({ api, storeSlug }: { api: PosApi; storeSlug?: string | null }) {
  const [copied, setCopied] = useState(false);
  const storeUrl = storeSlug ? `${location.origin}/t/${storeSlug}` : null;
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
      {storeUrl && (
        <div className="inline-form">
          <h4>Tu tienda web</h4>
          <p className="hint">Comparte este enlace con tus clientes: arman su pedido y lo pagan al retirar en el local.</p>
          <span className="inline"><code>{storeUrl}</code>
            <button className="btn ghost sm" onClick={async () => { try { await navigator.clipboard.writeText(storeUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sin portapapeles */ } }}>{copied ? 'Copiado' : 'Copiar enlace'}</button>
          </span>
        </div>
      )}
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

      <h3 className="section-title">Copia de seguridad</h3>
      <p className="hint">Descarga una copia de todos los datos de tu negocio (productos, ventas, clientes). Guárdala en un lugar seguro, por ejemplo tu correo o un pendrive: es tu respaldo propio, por si algún día lo necesitas.</p>
      <div className="row-btns">
        <button className="btn ghost" onClick={async () => { try { download(`nexus-respaldo-${new Date().toISOString().slice(0, 10)}.json`, await api.backup(), 'application/json'); } catch (e) { setError(msg(e)); } }}>⬇️ Descargar copia de mis datos</button>
      </div>
    </>
  );
}
