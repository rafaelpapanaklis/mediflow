"use client";

// ═══════════════════════════════════════════════════════════════════════
// fetch-safe — el patrón correcto para pedir datos desde un componente.
//
// EL PROBLEMA que resuelve
// ────────────────────────
// Un fetch lanzado en un efecto sigue vivo aunque el componente se
// desmonte (cambio de sección, cierre de modal, router.refresh(), un error
// boundary que tira el subárbol). Si nadie lo cancela ni atrapa, aparecen
// dos síntomas:
//   1. `Uncaught (in promise) AbortError: signal is aborted without reason`
//      en consola — el cleanup abortó la petición y el rechazo quedó sin
//      handler (o el handler lo re-lanzó).
//   2. Un setState sobre un componente ya desmontado.
//
// EL PATRÓN (los 3 puntos, siempre juntos)
// ────────────────────────────────────────
//   a) AbortController por efecto, y `ctrl.abort()` en el cleanup.
//   b) IGNORAR el AbortError: cancelar NO es fallar. Nunca debe pintar un
//      estado de error ni escalar a un error boundary.
//   c) No tocar estado después de desmontar: guardia `alive`.
//
// CÓMO USARLO
// ───────────
//   • `useAbortableFetch<T>(url)` — el caso normal: GET que devuelve JSON y
//     alimenta una lista. Ya trae los 3 puntos. Devuelve `reload()` para
//     refrescar tras crear/editar algo.
//   • `isAbortError(err)` — para catch escritos a mano (polling, fetch con
//     POST, cadenas que no encajan en el hook). Es la ÚNICA fuente de
//     verdad del check; no compares `err.name === "AbortError"` suelto.
//
// NO HACER
// ────────
//   • `try { await fetch(...) } finally { ... }` SIN `catch`: el rechazo se
//     propaga y termina en unhandled rejection.
//   • Llamar a una función async desde un efecto sin `.catch()`.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ¿Este rechazo es una cancelación (no un fallo)?
 *
 * Cubre las dos formas en que llega: la `DOMException` con name
 * "AbortError" que lanza fetch, y el `Error` con ese mismo name que usan
 * algunas libs. Fuente única — si mañana hay que cubrir otro caso, se
 * cubre aquí y lo heredan todos los consumidores.
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { name?: unknown }).name === "AbortError";
}

export interface AbortableFetchState<T> {
  data: T | null;
  loading: boolean;
  /** Mensaje de error REAL. Una cancelación nunca lo llena. */
  error: string | null;
  /** Vuelve a pedir (tras crear/editar/borrar algo). Estable. */
  reload: () => void;
}

/**
 * GET de JSON atado al ciclo de vida del componente.
 *
 * - Cancela la petición en curso al desmontar o al cambiar `url`.
 * - Una cancelación no pinta error ni deja `loading` colgado.
 * - No hace setState después de desmontar.
 *
 * Pasa `url = null` para no pedir nada (p. ej. mientras falta un id).
 *
 * `init` se lee por ref: puedes pasar un objeto literal sin provocar
 * refetches por identidad nueva en cada render.
 */
export function useAbortableFetch<T>(url: string | null, init?: RequestInit): AbortableFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(url !== null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const initRef = useRef(init);
  initRef.current = init;

  useEffect(() => {
    if (url === null) {
      setLoading(false);
      return;
    }

    // (a) un controller por efecto
    const ctrl = new AbortController();
    // (c) guardia de desmontaje
    let alive = true;

    setLoading(true);
    setError(null);

    fetch(url, { ...initRef.current, signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as T;
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // (b) cancelar no es fallar: ni error ni loading=false (el efecto
        // que lo reemplaza ya puso su propio loading).
        if (!alive || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [url, token]);

  const reload = useCallback(() => setToken((n) => n + 1), []);

  return { data, loading, error, reload };
}
