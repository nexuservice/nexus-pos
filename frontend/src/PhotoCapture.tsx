import { useEffect, useRef, useState } from 'react';
import { Modal } from './components';
import { resizeToJpeg } from './image';

/**
 * Foto de un producto: abre la cámara del equipo (celular o computador) para sacarla en el momento,
 * o deja elegir una de la galería. Entrega un JPEG liviano ya reducido.
 */
export function PhotoCapture({ title = 'Foto del producto', onPhoto, onClose }: { title?: string; onPhoto: (jpeg: Blob) => void | Promise<void>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let dead = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (se necesita https). Puedes elegir una foto de la galería.');
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } } });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => undefined); setReady(true); }
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setCamError(name === 'NotAllowedError' ? 'Permite el acceso a la cámara en tu navegador, o elige una foto de la galería.'
          : name === 'NotFoundError' ? 'No se encontró una cámara en este equipo. Puedes elegir una foto de la galería.'
            : (e as Error)?.message || 'No se pudo abrir la cámara. Puedes elegir una foto de la galería.');
      }
    })();
    return () => { dead = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const deliver = async (source: Blob) => {
    try {
      setBusy(true); setError(null);
      await onPhoto(await resizeToJpeg(source));
    } catch (e) {
      setError((e as Error)?.message || 'No se pudo guardar la foto. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const snap = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) await deliver(blob);
  };

  return (
    <Modal title={title} onClose={onClose}>
      {camError
        ? <div className="alert" role="alert">{camError}</div>
        : <div className="cam-box"><video ref={videoRef} className="cam-video" muted playsInline /></div>}
      {error && <div className="alert" role="alert">{error}</div>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void deliver(f); }} />
      <div className="row-btns">
        <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>🖼️ Elegir de la galería</button>
        <button type="button" className="btn primary" disabled={busy || !ready} onClick={snap}>{busy ? 'Guardando…' : '📸 Sacar foto'}</button>
      </div>
    </Modal>
  );
}
