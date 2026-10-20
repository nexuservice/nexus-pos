import { createHttpApi } from './http';
import { createLocalApi } from './local';
import type { PosApi } from './types';

/** Con VITE_API_URL usa el backend; sin ella, corre el modo demo en el navegador. */
export function createApi(): PosApi {
  const base = import.meta.env.VITE_API_URL as string | undefined;
  return base ? createHttpApi(base) : createLocalApi();
}

export type { PosApi } from './types';
export { resetLocalDemo } from './local';
