"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Precarga de un enlace del menú SOLO cuando la persona se detiene encima.
 *
 * Por qué (ws1-t12, incidente del 1-oct-2026): con el `prefetch` por defecto
 * de `<Link>`, cada opción visible del menú se precargaba al montar el panel.
 * Las pantallas del panel son dinámicas, así que cada precarga corre el
 * layout de /dashboard en el servidor (sesión, clínica, módulos… consultas a
 * la base): abrir el panel disparaba ~8 de esas a la vez, además de las APIs de
 * la propia pantalla. Los enlaces del menú van con `prefetch={false}` y esto
 * pide la de UNO, cuando el ratón se queda `RETRASO_PRECARGA_MS` encima (o el
 * foco del teclado llega a él). Pasar el ratón de largo por el menú no pide
 * nada. La navegación es la misma: un clic sin precarga navega igual.
 *
 * En `next dev` no hace nada (ahí `router.prefetch` es un no-op).
 */
export const RETRASO_PRECARGA_MS = 150;

export function usePrecargaAlPasar() {
  const router = useRouter();
  const pendiente = useRef<number | null>(null);

  const cancelar = useCallback(() => {
    if (pendiente.current !== null) {
      window.clearTimeout(pendiente.current);
      pendiente.current = null;
    }
  }, []);

  useEffect(() => cancelar, [cancelar]);

  return useCallback(
    (href: string) => {
      const programar = () => {
        cancelar();
        pendiente.current = window.setTimeout(() => {
          pendiente.current = null;
          router.prefetch(href);
        }, RETRASO_PRECARGA_MS);
      };
      return { onMouseEnter: programar, onFocus: programar, onMouseLeave: cancelar, onBlur: cancelar };
    },
    [router, cancelar],
  );
}
