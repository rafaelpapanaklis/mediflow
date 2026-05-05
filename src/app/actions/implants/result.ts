// Implants — tipos Result<T> compartidos entre actions y consumidores.
// SIN imports de server-only (no auth-context, no prisma) — este archivo
// es seguro de importar desde componentes 'use client'.
//
// Imitamos la firma del módulo Endodoncia para uniformidad.

export type Success<T> = { ok: true; data: T };
export type Failure = { ok: false; error: string; issues?: unknown };
export type ActionResult<T> = Success<T> | Failure;

export function ok<T>(data: T): Success<T> {
  return { ok: true, data };
}

export function fail(error: string, issues?: unknown): Failure {
  return { ok: false, error, issues };
}

export function isFailure<T>(r: ActionResult<T>): r is Failure {
  return !r.ok;
}
