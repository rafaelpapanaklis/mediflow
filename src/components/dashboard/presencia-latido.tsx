"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  INACTIVIDAD_MS,
  LATIDO_MS,
  RUTA_LATIDO,
  debeLatir,
  puedeLatirYa,
} from "@/lib/presencia/presencia-core";

/**
 * «Clínicas en línea» — la señal de vida del panel. No pinta nada.
 *
 * Reglas (aprobadas por Rafael, 1-oct-2026):
 *   · una señal cada 60 s SOLO con la pestaña visible (document.visibilityState);
 *   · sin mouse, teclado ni toque en 15 min deja de mandarla aunque siga abierta,
 *     y la manda de nuevo en cuanto el usuario vuelve a tocar algo;
 *   · además, una señal al volver a la pestaña y al cambiar de pantalla (para que
 *     el admin vea la pantalla de verdad), con 15 s mínimos entre una y otra.
 * El servidor decide a quién cuenta (no cuenta «Ver como clínica»); aquí solo se
 * manda la ruta, que el servidor traduce a un nombre de pantalla.
 *
 * Si el servidor dice que no hay dónde guardarla (sin Redis), que no cuenta esta
 * sesión, o que no hay sesión (401/403), se deja de intentar hasta recargar.
 */
export function PresenciaLatido() {
  const pathname = usePathname();
  const latirYa = useRef<() => void>(() => {});

  useEffect(() => {
    let parado = false;
    let enCurso = false;
    let ultimaActividad = Date.now();
    let ultimoLatido = 0;

    const mandar = async () => {
      if (parado || enCurso) return;
      enCurso = true;
      ultimoLatido = Date.now();
      // Una petición colgada (red que se cae a medias) no debe dejar a la pestaña
      // sin mandar señales para siempre: a los 20 s se corta y la siguiente reintenta.
      const control = new AbortController();
      const corte = window.setTimeout(() => control.abort(), 20_000);
      try {
        const r = await fetch(RUTA_LATIDO, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          signal: control.signal,
          body: JSON.stringify({ ruta: window.location.pathname }),
        });
        if (r.status === 401 || r.status === 403) {
          parado = true;
        } else if (r.ok) {
          const j = (await r.json().catch(() => null)) as { guardado?: boolean; motivo?: string } | null;
          if (j && j.guardado === false && (j.motivo === "sin-redis" || j.motivo === "no-cuenta")) parado = true;
        }
      } catch {
        // sin red o servidor caído: la siguiente señal lo vuelve a intentar
      } finally {
        window.clearTimeout(corte);
        enCurso = false;
      }
    };

    const intentar = (delReloj: boolean) => {
      const ahora = Date.now();
      const visible = document.visibilityState === "visible";
      if (!debeLatir({ visible, ahora, ultimaActividad })) return;
      if (!delReloj && !puedeLatirYa(ahora, ultimoLatido)) return;
      void mandar();
    };
    latirYa.current = () => intentar(false);

    const alActividad = () => {
      const ahora = Date.now();
      const venia = ahora - ultimaActividad >= INACTIVIDAD_MS;
      ultimaActividad = ahora;
      if (venia) intentar(false); // estaba en reposo y volvió: avisa sin esperar al reloj
    };
    const alVolver = () => {
      if (document.visibilityState === "visible") intentar(false);
    };

    const eventos = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"] as const;
    for (const e of eventos) window.addEventListener(e, alActividad, { passive: true, capture: true });
    document.addEventListener("visibilitychange", alVolver);
    const reloj = window.setInterval(() => intentar(true), LATIDO_MS);
    intentar(false);

    return () => {
      parado = true;
      window.clearInterval(reloj);
      for (const e of eventos) window.removeEventListener(e, alActividad, { capture: true });
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  // Cambio de pantalla: señal con la ruta nueva (respeta los 15 s mínimos).
  useEffect(() => {
    latirYa.current();
  }, [pathname]);

  return null;
}
