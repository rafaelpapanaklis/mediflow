"use client";
import { useEffect } from "react";

/**
 * Reabre la reserva al volver de iniciar sesión / crear cuenta.
 *
 * Los botones "Iniciar sesión" / "Crear cuenta" de la modal navegan con
 * ?next=/{slug}?reservar=1. Al regresar a la landing, este hook detecta
 * ?reservar=1, lo limpia de la URL (sin recargar) y vuelve a abrir la modal,
 * para que el paciente continúe justo en la misma reserva.
 *
 * `open` debe ser estable (defínela con useCallback o un setter de estado).
 */
export function useReservarAutoOpen(open: () => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reservar") !== "1") return;
    params.delete("reservar");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
