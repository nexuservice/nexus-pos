import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const DATA_DIR = process.env.NEXUS_DATA ?? path.join(import.meta.dirname, '..', 'data');

/**
 * Lee un secreto de la variable de entorno o, si no existe, de un archivo en el directorio de datos
 * (lo genera la primera vez). Así en local funciona sin configurar nada y en un servidor se fija por variable.
 */
export function loadSecret(envName: string, file: string): { value: string; created: boolean } {
  const fromEnv = process.env[envName];
  if (fromEnv) return { value: fromEnv, created: false };
  const p = path.join(DATA_DIR, file);
  try {
    return { value: fs.readFileSync(p, 'utf8').trim(), created: false };
  } catch {
    const value = randomBytes(24).toString('base64url');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(p, value, { mode: 0o600 });
    return { value, created: true };
  }
}
