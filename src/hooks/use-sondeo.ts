"use client";
import { useCallback, useEffect, useRef } from "react";

/**
 * El sondeo de las piezas del armazón (menú, campanas, aviso de sala de
 * espera), con las mismas reglas para todas:
 *
 * - Carga al montar.
 * - Repite cada `cadaMs` SOLO con la pestaña visible. Una pestaña de fondo no
 *   pregunta nada: con diez pestañas abiertas pregunta una.
 * - Al volver a la pestaña (o a la ventana) recarga SOLO si lo último tiene
 *   más de medio intervalo. Antes cada pieza recargaba en cada
 *   `visibilitychange` —y el menú además en cada `focus`, así que volver a la
 *   pestaña eran dos peticiones seguidas por pieza—: saltar entre pestañas
 *   era una ráfaga contra la base.
 * - `refrescar()` recarga YA si la pestaña está visible (p. ej. tras «acabo
 *   de cambiar esto», ver @/lib/armazon/refrescar); si no, lo deja pendiente
 *   para cuando vuelva, sin esperar el medio intervalo.
 *
 * El `fetch` sigue viviendo en cada componente (lo fija
 * topbar-rediseno.test.ts): este hook solo decide CUÁNDO.
 */
export function useSondeo(cargar: () => void | Promise<void>, cadaMs: number): () => void {
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const ultimo = useRef(0);
  const pendiente = useRef(false);

  const ejecutar = useCallback(() => {
    ultimo.current = Date.now();
    pendiente.current = false;
    void cargarRef.current();
  }, []);

  useEffect(() => {
    let intervalo: ReturnType<typeof setInterval> | null = null;
    const visible = () => document.visibilityState === "visible";
    const arrancar = () => {
      if (intervalo === null) intervalo = setInterval(ejecutar, cadaMs);
    };
    const parar = () => {
      if (intervalo !== null) { clearInterval(intervalo); intervalo = null; }
    };
    const alVolver = () => {
      if (!visible()) { parar(); return; }
      if (pendiente.current || Date.now() - ultimo.current >= cadaMs / 2) ejecutar();
      arrancar();
    };

    ejecutar();
    if (visible()) arrancar();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [cadaMs, ejecutar]);

  return useCallback(() => {
    if (document.visibilityState === "visible") ejecutar();
    else pendiente.current = true;
  }, [ejecutar]);
}
