import { useEffect, useState, type ReactNode } from 'react';
import { LEGAL_VERSION } from '@nexus/core';
import terminosMd from './terminos.md?raw';
import privacidadMd from './privacidad.md?raw';
import tiendaMd from './tienda.md?raw';

export type LegalDoc = 'terminos' | 'privacidad';
const DOCS: Record<LegalDoc, string> = { terminos: terminosMd, privacidad: privacidadMd };

/** Documento legal pedido en la dirección (#/legal/terminos o #/legal/privacidad), o null. */
export const legalFromHash = (): LegalDoc | null => {
  const m = /^#\/?legal\/(terminos|privacidad)\/?$/.exec(location.hash);
  return (m?.[1] as LegalDoc | undefined) ?? null;
};

/** **negrita** y *cursiva*; el resto, texto tal cual. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

/** Convierte el texto de los documentos (títulos, párrafos y listas) en pantalla, sin librerías. */
export function Md({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^- (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith('# ')) blocks.push(<h1 key={blocks.length}>{inline(line.slice(2))}</h1>);
    else if (line.startsWith('## ')) blocks.push(<h2 key={blocks.length}>{inline(line.slice(3))}</h2>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

/** Página pública con los términos o la política de privacidad. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="page legal">
      <p><a href="#/">← Volver</a></p>
      <Md text={DOCS[doc]} />
      <p className="hint">
        <a href="#/legal/terminos">Términos y condiciones</a> · <a href="#/legal/privacidad">Política de privacidad</a> · versión {LEGAL_VERSION}
      </p>
    </div>
  );
}

/** Aviso de privacidad y condiciones de la tienda web de un negocio (se completa con sus datos). */
export function StoreNotice({ business }: { business: { name: string; direccion?: string; comuna?: string; phone?: string } }) {
  const where = [business.direccion, business.comuna].filter(Boolean).join(', ');
  const text = tiendaMd
    .replaceAll('{{NEGOCIO}}', business.name)
    .replaceAll('{{DIRECCION}}', where || 'dirección del local')
    .replaceAll('{{TELEFONO}}', business.phone || 'el teléfono del local');
  return <div className="legal"><Md text={text} /></div>;
}

/** Pantalla que pide aceptar los términos vigentes antes de usar la aplicación. */
export function TermsGate({ onAccept, onLogout }: { onAccept: () => Promise<void>; onLogout: () => void }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const accept = async () => {
    try { setBusy(true); setError(null); await onAccept(); } catch (e) { setError((e as Error)?.message ?? 'No se pudo guardar. Intenta de nuevo.'); } finally { setBusy(false); }
  };
  return (
    <div className="gate">
      <div className="gate-card" style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}>
        <h2>Términos y privacidad</h2>
        <p className="hint">Para seguir usando Nexus, lee y acepta los términos del servicio y la política de privacidad (versión {LEGAL_VERSION}).</p>
        <div className="legal" style={{ maxHeight: '45vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
          <Md text={terminosMd} />
          <Md text={privacidadMd} />
        </div>
        <label className="check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> He leído y acepto los términos y condiciones y la política de privacidad
        </label>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="row-btns">
          <button className="btn ghost" onClick={onLogout}>Cerrar sesión</button>
          <button className="btn primary" disabled={!ok || busy} onClick={accept}>{busy ? 'Guardando…' : 'Aceptar y continuar'}</button>
        </div>
      </div>
    </div>
  );
}
