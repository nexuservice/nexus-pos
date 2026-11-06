import { useEffect, useRef, useState } from 'react';

/** ¿El dígito verificador de un EAN-8 / UPC-A / EAN-13 es correcto? Otros largos (p. ej. Code 128) no se validan. */
export function validBarcode(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return true; // Code 128 u otros: sin verificador conocido
  const d = code.split('').map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const CONFIRM_MS = 1500; // la segunda lectura igual debe llegar dentro de este tiempo
const REPEAT_MS = 3000; // un mismo código no se repite antes de esto

async function makeReader() {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
  const hints = new Map<unknown, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_128]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  return new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 120 });
}

/**
 * Lector de códigos de barras con la cámara del celular (cámara trasera), con zxing (Android e iPhone). Requiere HTTPS.
 * Para evitar lecturas falsas: solo EAN/UPC/Code128, se verifica el dígito verificador y el mismo código debe leerse
 * dos veces seguidas. Si la lectura en vivo no resulta, "Tomar foto" lee una foto en alta calidad de la cámara.
 */
export function CameraScanner({ onCode, paused }: { onCode: (code: string) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onCodeRef = useRef(onCode);
  const pausedRef = useRef(!!paused);
  onCodeRef.current = onCode;
  pausedRef.current = !!paused;
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let stop: (() => void) | undefined;
    let accepted = { code: '', at: 0 };
    let pending = { code: '', at: 0 };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (se necesita https).');
        const reader = await makeReader();
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
          videoRef.current!,
          (result) => {
            if (!result || pausedRef.current) return;
            const code = result.getText().trim();
            const now = Date.now();
            if (!code || !validBarcode(code)) return;
            if (code === accepted.code && now - accepted.at < REPEAT_MS) return;
            if (code !== pending.code || now - pending.at > CONFIRM_MS) { pending = { code, at: now }; return; }
            accepted = { code, at: now };
            pending = { code: '', at: 0 };
            setNote(null);
            try { navigator.vibrate?.(60); } catch { /* sin vibración */ }
            onCodeRef.current(code);
          },
        );
        if (dead) { controls.stop(); return; }
        stop = () => controls.stop();
        // Enfoque continuo cuando el celular lo permite.
        const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
        await track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as never] }).catch(() => undefined);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(name === 'NotAllowedError' ? 'Permite el acceso a la cámara en tu navegador para escanear.'
          : name === 'NotFoundError' ? 'No se encontró una cámara en este equipo.'
            : (e as Error)?.message || 'No se pudo abrir la cámara.');
      }
    })();
    return () => { dead = true; stop?.(); };
  }, []);

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    setNote('Leyendo la foto…');
    const url = URL.createObjectURL(file);
    try {
      const reader = await makeReader();
      const result = await reader.decodeFromImageUrl(url);
      const code = result.getText().trim();
      if (!validBarcode(code)) throw new Error('lectura inválida');
      setNote(null);
      onCodeRef.current(code);
    } catch {
      setNote('No se pudo leer el código en la foto. Acércate, que se vea completo y nítido, y vuelve a intentar (o escríbelo abajo).');
    } finally {
      URL.revokeObjectURL(url);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="cam-wrap">
      {error ? <div className="alert" role="alert">{error}</div> : (
        <div className="cam-box">
          <video ref={videoRef} className="cam-video" muted playsInline />
          <div className="cam-guide" aria-hidden="true" />
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromPhoto(e.target.files?.[0])} />
      <button type="button" className="btn ghost cam-photo" onClick={() => fileRef.current?.click()}>📸 Tomar foto del código</button>
      {note && <p className="hint">{note}</p>}
      <p className="hint">Mantén el código dentro del recuadro, quieto y bien iluminado. Verifica que el número que aparece sea el del producto.</p>
    </div>
  );
}
