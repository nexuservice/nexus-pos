import { useCallback, useEffect, useMemo, useState } from 'react';
import { isValidRut } from '@nexus/core';
import { createAdminClient, type TenantInfo } from '../api';
import { msg } from '../hooks';
import { fmtDate } from '../format';

const KEY = 'nexus-admin-key';

/** Clave aleatoria de 12 caracteres sin letras ambiguas (0/O, 1/l/I). */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Panel del proveedor (solo tú): crea clientes y administra sus accesos.
 * Se abre en la dirección /#superadmin y pide la clave de administrador del servidor.
 */
export function SuperAdminView({ base }: { base: string }) {
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } });
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<TenantInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ rut: string; name: string; password: string } | null>(null);
  const [f, setF] = useState({ rut: '', name: '', password: '' });

  const client = useMemo(() => (key ? createAdminClient(base, key) : null), [base, key]);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setRows(await client.list());
      setError(null);
    } catch (e) {
      setRows(null);
      setError(msg(e));
      setKey('');
      try { sessionStorage.removeItem(KEY); } catch { /* nada */ }
    }
  }, [client]);
  useEffect(() => { load(); }, [load]);

  const enter = () => {
    try { sessionStorage.setItem(KEY, input); } catch { /* nada */ }
    setKey(input);
    setInput('');
  };

  const create = async () => {
    if (!client) return;
    if (!isValidRut(f.rut)) return setError('El RUT no es válido.');
    try {
      setError(null);
      const t = await client.create(f.rut, f.name, f.password);
      setCreated({ rut: t.rut, name: t.name, password: f.password });
      setF({ rut: '', name: '', password: '' });
      await load();
    } catch (e) { setError(msg(e)); }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try { setError(null); await fn(); await load(); } catch (e) { setError(msg(e)); }
  };

  if (!client || rows === null) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h2>Administración de clientes</h2>
          <p className="hint">Solo para el proveedor. Escribe la clave de administrador del servidor.</p>
          <label className="field">Clave de administrador
            <input type="password" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && input && enter()} autoFocus />
          </label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn primary" disabled={!input} onClick={enter}>Entrar</button>
          <a className="link" href="#/">Volver al ingreso</a>
        </div>
      </div>
    );
  }

  return (
    <div className="page wide-page">
      <div className="page-head">
        <h1>Clientes</h1>
        <div className="head-actions">
          <a className="btn ghost sm" href="#/">Ir al ingreso</a>
          <button className="btn ghost sm" onClick={() => { try { sessionStorage.removeItem(KEY); } catch { /* nada */ } setKey(''); setRows(null); }}>Salir</button>
        </div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}

      {created && (
        <div className="panel created">
          <h2>✅ Cliente creado: {created.name}</h2>
          <p>Entrégale estos datos. <b>La clave no se vuelve a mostrar</b>: se guarda cifrada.</p>
          <dl className="kv"><div><dt>Usuario (RUT)</dt><dd>{created.rut}</dd></div><div><dt>Clave</dt><dd><code>{created.password}</code></dd></div></dl>
          <div className="row-btns">
            <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(`Usuario: ${created.rut}\nClave: ${created.password}`)}>Copiar datos</button>
            <button className="btn primary sm" onClick={() => setCreated(null)}>Listo</button>
          </div>
        </div>
      )}

      <section className="inline-form">
        <h4>Nuevo cliente</h4>
        <div className="two-col">
          <label className="field">RUT del negocio<input value={f.rut} onChange={(e) => setF({ ...f, rut: e.target.value })} placeholder="76.123.456-0" /></label>
          <label className="field">Nombre del negocio<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Clave inicial (mínimo 8 caracteres)
            <span className="inline"><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, password: generatePassword() })}>Generar</button></span>
          </label>
        </div>
        <button className="btn primary" disabled={!f.rut || !f.name || f.password.length < 8} onClick={create}>Crear cliente</button>
        <p className="hint">El negocio parte vacío: sin productos, sin stock y sin cajeros. El cliente crea los suyos al entrar.</p>
      </section>

      <div className="table-wrap"><table>
        <thead><tr><th>RUT</th><th>Negocio</th><th>Creado</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.rut}</td><td>{t.name}</td><td>{fmtDate(t.createdAt)}</td>
              <td><span className={'pill ' + (t.active ? 'ok' : 'bad')}>{t.active ? 'activo' : 'desactivado'}</span></td>
              <td>
                <button className="btn ghost sm" onClick={() => act(() => client.setActive(t.rut, !t.active))}>{t.active ? 'Desactivar' : 'Activar'}</button>{' '}
                <button className="btn ghost sm" onClick={() => {
                  const p = prompt(`Nueva clave para ${t.name} (mínimo 8 caracteres):`, generatePassword());
                  if (p) act(async () => { await client.setPassword(t.rut, p); alert(`Clave actualizada. Entrégale: ${p}`); });
                }}>Cambiar clave</button>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="empty">Aún no hay clientes</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
