import { useEffect, useRef, useState } from 'react';

/**
 * Lector de códigos de barras con la cámara del celular (cámara trasera). Usa zxing, que funciona en Android e iPhone.
 * Requiere HTTPS (o localhost). `paused` ignora lecturas mientras el usuario está llenando algo.
 * Un mismo código no se repite en 3 segundos, para no leer dos veces el producto que sigue frente a la cámara.
 */
export function CameraScanner({ onCode, paused }: { onCode: (code: string) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const pausedRef = useRef(!!paused);
  onCodeRef.current = onCode;
  pausedRef.current = !!paused;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let stop: (() => void) | undefined;
    let last = { code: '', at: 0 };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (se necesita https).');
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (result) => {
            if (!result || pausedRef.current) return;
            const code = result.getText().trim();
            const now = Date.now();
            if (!code || (code === last.code && now - last.at < 3000)) return;
            last = { code, at: now };
            try { navigator.vibrate?.(60); } catch { /* sin vibración */ }
            onCodeRef.current(code);
          },
        );
        if (dead) controls.stop(); else stop = () => controls.stop();
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(name === 'NotAllowedError' ? 'Permite el acceso a la cámara en tu navegador para escanear.'
          : name === 'NotFoundError' ? 'No se encontró una cámara en este equipo.'
            : (e as Error)?.message || 'No se pudo abrir la cámara.');
      }
    })();
    return () => { dead = true; stop?.(); };
  }, []);

  if (error) return <div className="alert" role="alert">{error}</div>;
  return (
    <div className="cam-box">
      <video ref={videoRef} className="cam-video" muted playsInline />
      <div className="cam-guide" aria-hidden="true" />
    </div>
  );
}
