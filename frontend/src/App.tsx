import { useEffect, useMemo, useState } from 'react';
import { API_URL, clearSession, createHttpApi, loadSession, saveSession, type PosApi, type Session } from './api';
import { Dropdown } from './components';
import { clampScale, SettingsProvider, useSettings } from './settings';
import { download, setPrintBusiness } from './format';
import { PosView } from './views/Pos';
import { StoreView } from './views/Store';
import { PanelView } from './views/Panel';
import { HistoryView } from './views/History';
import { AdminView } from './views/Admin';
import { HelpView } from './views/Help';
import { LoginView } from './views/Login';
import { SuperAdminView } from './views/SuperAdmin';

type Tab = 'pos' | 'store' | 'panel' | 'history' | 'admin' | 'help';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pos', label: 'Caja' },
  { id: 'store', label: 'Tienda online' },
  { id: 'panel', label: 'Panel' },
  { id: 'history', label: 'Historial' },
  { id: 'admin', label: 'Administración' },
  { id: 'help', label: 'Ayuda' },
];

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button className="dd-item" role="switch" aria-checked={on} onClick={onClick}><span>{label}</span><i className={'dot' + (on ? ' on' : '')} /></button>;
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="dd-item"><span>{label}</span>
      <span className="stepper"><button aria-label={`Reducir ${label}`} onClick={() => onChange(clampScale(value - 10))}>−</button><b>{value}%</b><button aria-label={`Aumentar ${label}`} onClick={() => onChange(clampScale(value + 10))}>+</button></span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(title === 'Pantalla');
  return (
    <div className="dd-group">
      <button className="dd-group-title" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {title}</button>
      {open && <div className="dd-group-body">{children}</div>}
    </div>
  );
}

function SettingsMenu(props: { api: PosApi; go: (t: Tab) => void; onLogout: () => void }) {
  const { prefs, set } = useSettings();
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <Dropdown label="⚙️" align="right" className="settings">
      {(close) => (
        <div className="settings-menu">
          <Group title="Pantalla">
            <Toggle on={dark} label="Tema oscuro" onClick={() => set({ theme: dark ? 'light' : 'dark' })} />
            <Toggle on={fullscreen} label="Pantalla completa" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())} />
            <Toggle on={prefs.headerInfo} label="Ver info superior" onClick={() => set({ headerInfo: !prefs.headerInfo })} />
            <Toggle on={prefs.payAlways} label="Formas de pago siempre visibles" onClick={() => set({ payAlways: !prefs.payAlways })} />
            <Toggle on={prefs.compactCart} label="Detalle de venta compacto" onClick={() => set({ compactCart: !prefs.compactCart })} />
            <Stepper label="Tamaño botones" value={prefs.btnScale} onChange={(v) => set({ btnScale: v })} />
            <Stepper label="Tamaño fuente" value={prefs.fontScale} onChange={(v) => set({ fontScale: v })} />
            <div className="dd-item static"><span>Resolución</span><b>{window.innerWidth}×{window.innerHeight}</b></div>
          </Group>
          <Group title="Catálogo">
            <Toggle on={prefs.showSearch} label="Buscar productos" onClick={() => set({ showSearch: !prefs.showSearch })} />
            <Toggle on={prefs.showBarcode} label="Código de barras" onClick={() => set({ showBarcode: !prefs.showBarcode })} />
            <Toggle on={prefs.showAll} label="Ver todos los productos" onClick={() => set({ showAll: !prefs.showAll })} />
          </Group>
          <Group title="Sistema">
            <button className="dd-item" onClick={async () => { close(); download(`nexus-respaldo-${new Date().toISOString().slice(0, 10)}.json`, await props.api.backup(), 'application/json'); }}>Respaldar base de datos</button>
            <button className="dd-item" onClick={() => location.reload()}>Recargar</button>
            <button className="dd-item" onClick={() => { close(); props.onLogout(); }}>Cerrar sesión</button>
          </Group>
          <Group title="Gestión">
            {TABS.filter((t) => ['admin', 'panel', 'history', 'help'].includes(t.id)).map((t) => (
              <button key={t.id} className="dd-item" onClick={() => { close(); props.go(t.id); }}>{t.label}</button>
            ))}
          </Group>
        </div>
      )}
    </Dropdown>
  );
}

/** App del negocio, ya con sesión iniciada. */
function Shell({ session, base, onLogout }: { session: Session; base: string; onLogout: (notice?: string) => void }) {
  const api = useMemo(
    () => createHttpApi(base, () => session.token, () => onLogout('Tu sesión venció. Ingresa de nuevo.')),
    [base, session.token], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [tab, setTab] = useState<Tab>('pos');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api.rpc.branches().then((b) => setBranchId(b[0]?.id ?? null)).catch((e) => { if (e?.status !== 401) setOffline(true); });
    api.rpc.getBusiness().then(setPrintBusiness).catch(() => undefined);
  }, [api]);

  if (offline) {
    return (
      <div className="page">
        <h1>No se pudo conectar con el servidor</h1>
        <p>Revisa tu conexión a internet y vuelve a intentar. Si el problema sigue, avísanos.</p>
        <p><button className="btn primary" onClick={() => location.reload()}>Reintentar</button></p>
      </div>
    );
  }

  const go = (t: string) => setTab(t as Tab);
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="logo">N</span> Nexus<small>{session.business.name}</small></div>
        <nav aria-label="Secciones">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (t.id === tab ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <SettingsMenu api={api} go={setTab} onLogout={() => onLogout()} />
      </header>
      <main>
        {tab === 'pos' && <PosView api={api} branchId={branchId} go={go} />}
        {tab === 'store' && <StoreView api={api} branchId={branchId} />}
        {tab === 'panel' && <PanelView api={api} branchId={branchId} />}
        {tab === 'history' && <HistoryView api={api} branchId={branchId} />}
        {tab === 'admin' && <AdminView api={api} branchId={branchId} />}
        {tab === 'help' && <HelpView />}
      </main>
    </div>
  );
}

const isSuperAdminRoute = () => location.hash.replace(/^#\/?/, '') === 'superadmin';

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [notice, setNotice] = useState<string | null>(null);
  const [superAdmin, setSuperAdmin] = useState(isSuperAdminRoute);

  useEffect(() => {
    const on = () => setSuperAdmin(isSuperAdminRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  if (!API_URL) {
    return (
      <div className="page">
        <h1>Falta configurar el servidor</h1>
        <p>Esta versión de la app no sabe a qué servidor conectarse. Compílala con la variable <code>VITE_API_URL</code>.</p>
      </div>
    );
  }

  const logout = (msg?: string) => {
    clearSession();
    setSession(null);
    setNotice(msg ?? null);
  };

  let content: React.ReactNode;
  if (superAdmin) content = <SuperAdminView base={API_URL} />;
  else if (!session) content = <LoginView base={API_URL} notice={notice} onLogin={(s) => { saveSession(s); setNotice(null); setSession(s); }} />;
  else content = <Shell session={session} base={API_URL} onLogout={logout} />;

  return <SettingsProvider>{content}</SettingsProvider>;
}
