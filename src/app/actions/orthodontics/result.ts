// Orthodontics — tipos del Result. Client-safe (sin imports server-only).

export type Failure = { ok: false; error: string; existingId?: string };
export type Success<T> = { ok: true; data: T };
export type ActionResult<T = unknown> = Success<T> | Failure;

export function ok<T>(data: T): Success<T> {
  return { ok: true, data };
}

export function fail(error: string, existingId?: string): Failure {
  return existingId ? { ok: false, error, existingId } : { ok: false, error };
}

export function isFailure<T>(r: ActionResult<T>): r is Failure {
  return r.ok === false;
}

export function isSuccess<T>(r: ActionResult<T>): r is Success<T> {
  return r.ok === true;
}
