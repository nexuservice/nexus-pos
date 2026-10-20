import { useEffect, useMemo, useState } from 'react';
import { createApi, resetLocalDemo } from './api';
import { PosView } from './views/Pos';
import { StoreView } from './views/Store';
import { ReportsView } from './views/Reports';
import { InventoryView } from './views/Inventory';

type Tab = 'pos' | 'store' | 'inventory' | 'reports';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pos', label: 'Caja' },
  { id: 'store', label: 'Tienda online' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'reports', label: 'Reportes' },
];

export default function App() {
  const api = useMemo(createApi, []);
  const [tab, setTab] = useState<Tab>('pos');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api.branches().then((b) => setBranchId(b[0]?.id ?? null)).catch(() => setOffline(true));
  }, [api]);

  if (offline) {
    return (
      <div className="page">
        <h1>No se pudo conectar con el servidor</h1>
        <p>Revisa que la API esté corriendo (<code>npm run dev:api</code>) y que <code>VITE_API_URL</code> sea correcta.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="logo">N</span> Nexus<small>tu tienda online y punto de venta</small></div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (t.id === tab ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        {api.mode === 'demo' && (
          <button className="link" onClick={() => { resetLocalDemo(); location.reload(); }} title="Borra ventas y restaura el stock inicial">
            Reiniciar demo
          </button>
        )}
      </header>
      <main>
        {tab === 'pos' && <PosView api={api} branchId={branchId} />}
        {tab === 'store' && <StoreView api={api} branchId={branchId} />}
        {tab === 'inventory' && <InventoryView api={api} branchId={branchId} />}
        {tab === 'reports' && <ReportsView api={api} branchId={branchId} />}
      </main>
      {api.mode === 'demo' && <footer className="demo-note">Modo demostración: los datos viven solo en este navegador. Pagos y boletas son simulados.</footer>}
    </div>
  );
}
