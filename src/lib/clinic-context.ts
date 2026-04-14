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

export const clinicContextStorage = new AsyncLocalStorage<ClinicContext>();

/**
 * Obtiene el contexto actual. Retorna undefined si no hay contexto.
 * Úsalo dentro del middleware de Prisma o cualquier lugar que necesite
 * saber la clínica activa sin pasar parámetros.
 */
export function getCurrentClinicContext(): ClinicContext | undefined {
  return clinicContextStorage.getStore();
}
