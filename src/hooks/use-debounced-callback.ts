"use client";
// Hook genérico para debounce de callbacks. Spec del módulo Periodoncia
// recomienda 300ms para upsertSiteData del periodontograma. Reusable
// fuera del módulo.

import { useCallback, useEffect, useRef } from "react";

/**
 * Devuelve una versión debounced del callback que se reinicia en cada
 * llamada. La referencia del callback siempre apunta al último que pasó
 * el componente — evita el problema clásico de capturar `state` viejo.
 *
 * Cancela el timeout pendiente al desmontar para evitar warnings de
 * "setState on unmounted component".
 */
export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number,
): (...args: TArgs) => void {
  const fnRef = useRef(fn);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    (...args: TArgs) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
