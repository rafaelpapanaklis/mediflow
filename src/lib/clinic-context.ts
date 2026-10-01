import { AsyncLocalStorage } from "async_hooks";

/**
 * Contexto de clínica para el request actual.
 *
 * Se setea al inicio de cada API route del dashboard (via withClinicContext)
 * y el middleware de Prisma lo lee automáticamente para aplicar RLS.
 */
export interface ClinicContext {
  clinicId: string;
  userId?: string;
  role?: string;
}

// En globalThis: el build mete este archivo en varios módulos (páginas, server
// actions…) y el cliente de Prisma es UNO por proceso (@/lib/prisma, ws1-t12);
// con un AsyncLocalStorage por copia, el cliente no vería el contexto que
// fija otra copia.
const globalParaContexto = globalThis as unknown as {
  clinicContextStorage: AsyncLocalStorage<ClinicContext> | undefined;
};

export const clinicContextStorage =
  globalParaContexto.clinicContextStorage ?? new AsyncLocalStorage<ClinicContext>();
globalParaContexto.clinicContextStorage = clinicContextStorage;

/**
 * Obtiene el contexto actual. Retorna undefined si no hay contexto.
 * Úsalo dentro del middleware de Prisma o cualquier lugar que necesite
 * saber la clínica activa sin pasar parámetros.
 */
export function getCurrentClinicContext(): ClinicContext | undefined {
  return clinicContextStorage.getStore();
}
