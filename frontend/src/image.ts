/**
 * Reduce una foto a un JPEG liviano (lado mayor de 640 px) antes de subirla: las fotos del celular pesan varios MB
 * y la tienda tiene que cargar rápido. Devuelve un Blob JPEG de menos de ~100 KB en la mayoría de los casos.
 */
export async function resizeToJpeg(file: Blob, maxSide = 640, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador no puede preparar la foto.');
  ctx.fillStyle = '#fff'; // fondo blanco por si la imagen tiene transparencia
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  for (const q of [quality, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
    if (blob && blob.size <= 350_000) return blob;
  }
  throw new Error('La foto sigue siendo muy pesada. Prueba con otra.');
}
