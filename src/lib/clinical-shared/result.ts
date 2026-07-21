// Clinical-shared — result helper genérico (mismo contrato que pediatrics/result).

// `code` opcional: identificador machine-readable para que el cliente
// distinga fallas accionables (ej. "PLAN_LIMIT_STORAGE" → CTA de plan).
// Aditivo — los callers existentes que solo leen `error` no cambian.
export type Failure = { ok: false; error: string; code?: string };
export type Success<T> = { ok: true; data: T };
export type ActionResult<T = unknown> = Success<T> | Failure;

export function ok<T>(data: T): Success<T> {
  return { ok: true, data };
}

export function fail(error: string, code?: string): Failure {
  return code ? { ok: false, error, code } : { ok: false, error };
}

export function isFailure<T>(r: ActionResult<T>): r is Failure {
  return r.ok === false;
}

export function isSuccess<T>(r: ActionResult<T>): r is Success<T> {
  return r.ok === true;
}
