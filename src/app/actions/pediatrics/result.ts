// Pediatrics — tipos públicos del result de los server actions (client-safe). Spec: §4.A.9

export type Failure = { ok: false; error: string };
export type Success<T> = { ok: true; data: T };
export type ActionResult<T = unknown> = Success<T> | Failure;

export function ok<T>(data: T): Success<T> {
  return { ok: true, data };
}

export function fail(error: string): Failure {
  return { ok: false, error };
}

export function isFailure<T>(r: ActionResult<T>): r is Failure {
  return r.ok === false;
}
