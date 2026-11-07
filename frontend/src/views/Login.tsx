import { useState } from 'react';
import { isValidRut } from '@nexus/core';
import { login, loginCashier, type Session } from '../api';
import { msg } from '../hooks';

/** Entrada al sistema: cada cliente usa el RUT de su negocio y su clave. */
export function LoginView({ base, notice, onLogin }: { base: string; notice?: string | null; onLogin: (s: Session) => void }) {
  const [rut, setRut] = useState('');
  const [password, setPassword] = useState('');
  const [cashier, setCashier] = useState(false);
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidRut(rut)) return setError('Escribe el RUT de tu negocio completo, con guion y dígito verificador.');
    if (cashier ? !name.trim() : false) return setError('Escribe tu nombre, como lo registró el administrador.');
    if (!password) return setError(cashier ? 'Escribe tu PIN.' : 'Escribe tu clave.');
    setBusy(true);
    setError(null);
    try {
      onLogin(cashier ? await loginCashier(base, rut, name.trim(), password) : await login(base, rut, password));
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand login-brand"><span className="logo">N</span> Nexus</div>
        <h2>{cashier ? 'Ingreso de cajero' : 'Ingresa a tu negocio'}</h2>
        <div className="chips" role="tablist" aria-label="Tipo de ingreso">
          <button type="button" className={'chip' + (!cashier ? ' on' : '')} onClick={() => { setCashier(false); setError(null); }}>Administrador</button>
          <button type="button" className={'chip' + (cashier ? ' on' : '')} onClick={() => { setCashier(true); setError(null); }}>Cajero</button>
        </div>
        <p className="hint">{cashier ? 'Escribe el RUT del negocio, tu nombre y tu PIN. Solo podrás vender, ingresar mercadería y ver el historial.' : 'Usa el RUT de tu negocio y la clave que te entregamos.'}</p>
        {notice && <div className="alert" role="status">{notice}</div>}
        <label className="field">RUT del negocio
          <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76.123.456-0" autoComplete="username" inputMode="text" autoFocus />
        </label>
        {cashier && (
          <label className="field">Tu nombre
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="Como está registrado en el negocio" />
          </label>
        )}
        <label className="field">{cashier ? 'PIN' : 'Clave'}
          <span className="inline">
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <button type="button" className="btn ghost sm" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Ocultar' : 'Ver'}</button>
          </span>
        </label>
        {error && <div className="alert" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="hint">¿No tienes acceso o olvidaste tu clave? Escríbenos y te ayudamos.</p>
        <p className="hint"><a href="#/legal/terminos">Términos y condiciones</a> · <a href="#/legal/privacidad">Política de privacidad</a></p>
      </form>
    </div>
  );
}
