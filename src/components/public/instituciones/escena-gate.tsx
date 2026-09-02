"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA PUERTA DE LAS ESCENAS 3D. Decide si vale la pena descargar three.js
 * y, si sí, CUÁNDO.
 *
 * ── 1. ¿ESTA MÁQUINA PUEDE? ────────────────────────────────────────────
 * Se queda con el dibujo estático —sin pedir ni un byte— cuando:
 *   · el visitante pidió menos movimiento (prefers-reduced-motion);
 *   · hay ahorro de datos, o la red dice 2G/3G;
 *   · el equipo trae poca memoria o pocos núcleos;
 *   · no hay WebGL, o el que hay es por software (SwiftShader/llvmpipe),
 *     que se arrastraría más de lo que luce.
 * Un teléfono moderno SÍ pasa: la escena está pensada para él (menos
 * densidad de píxeles, menos pasos de rayo), y quien no llega al listón se
 * queda con un dibujo terminado, no con un hueco.
 *
 * ── 2. ¿HAY ALGUIEN MIRANDO? ───────────────────────────────────────────
 * Un observador de intersección vigila la caja de la escena con 240 px de
 * margen. Hasta que la caja no se acerca, no se pide nada: quien no baja
 * hasta la sección de imagenología no descarga su escena jamás.
 *
 * ── 3. ¿YA TERMINÓ DE CARGAR LA PÁGINA? ────────────────────────────────
 * Y aun estando a la vista, se espera al evento `load` y a la PRIMERA
 * señal de que hay una persona (mover el puntero, desplazar, tocar, una
 * tecla), y luego al hilo ocioso. Así el primer pintado, el LCP y la
 * hidratación pasan sin competir con los ~600 KB de three.
 *
 * 🔴 Y ése es también el motivo de que Lighthouse mida la página SIN las
 * escenas: una auditoría no mueve el ratón ni desplaza. Es a propósito —
 * la medición refleja lo que recibe quien aterriza y se va— pero para
 * poder auditar CON las escenas puestas hay una puerta trasera explícita:
 *
 *     /instituciones?escenas=ya
 *
 * salta la espera de interacción (no la de intersección ni la de
 * capacidad) y monta en cuanto la caja está a la vista. Se lee del
 * `location` en el cliente, así que la ruta sigue siendo ESTÁTICA: nadie
 * lee searchParams en el servidor.
 *
 * ── 4. SI ALGO FALLA, NO PASA NADA ─────────────────────────────────────
 * Contexto perdido, sombreador que no compila, WebGL 2 ausente: se quita
 * el atributo y el dibujo estático —que nunca salió del DOM— vuelve a
 * verse al instante.
 * ═══════════════════════════════════════════════════════════════════════
 */

export type EduEscenaNombre = "arcada" | "volumen" | "clinica";

const EscenaArcada = dynamic(() => import("./escena-arcada"), { ssr: false, loading: () => null });
const EscenaVolumen = dynamic(() => import("./escena-volumen"), { ssr: false, loading: () => null });
const EscenaClinica = dynamic(() => import("./escena-clinica"), { ssr: false, loading: () => null });

type NavigatorPistas = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
  deviceMemory?: number;
};

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

function sePuede(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

  const nav = navigator as NavigatorPistas;
  if (nav.connection?.saveData) return false;
  if (nav.connection?.effectiveType && /(^|-)(2g|3g)$/.test(nav.connection.effectiveType)) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return false;
  if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency < 4) return false;

  try {
    const sonda = document.createElement("canvas");
    const gl = (sonda.getContext("webgl2") || sonda.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const pintor = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(pintor)) return false;
  } catch {
    return false;
  }
  return true;
}

/** ¿Se pidió auditar con las escenas puestas? */
function forzado(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("escenas") === "ya";
  } catch {
    return false;
  }
}

export function EscenaGate({ nombre }: { nombre: EduEscenaNombre }) {
  const ref = useRef<HTMLDivElement>(null);
  const [montar, setMontar] = useState(false);

  useEffect(() => {
    const caja = ref.current?.parentElement;
    if (!caja || !sePuede()) return;
    if (typeof IntersectionObserver === "undefined") return;

    let cancelado = false;
    const INTERACCION = ["pointermove", "pointerdown", "wheel", "keydown", "scroll", "touchstart"] as const;
    let quitaInteraccion = () => {};
    let quitaLoad = () => {};

    const montaOcioso = () => {
      if (cancelado) return;
      const w = window as IdleWindow;
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(() => !cancelado && setMontar(true), { timeout: 1800 });
      } else {
        window.setTimeout(() => !cancelado && setMontar(true), 250);
      }
    };

    const esperaPersona = () => {
      if (cancelado) return;
      if (forzado()) {
        montaOcioso();
        return;
      }
      const alInteractuar = () => {
        quitaInteraccion();
        montaOcioso();
      };
      quitaInteraccion = () => {
        for (const ev of INTERACCION) window.removeEventListener(ev, alInteractuar);
      };
      for (const ev of INTERACCION) window.addEventListener(ev, alInteractuar, { passive: true });
    };

    const alCargar = () => {
      if (cancelado) return;
      if (document.readyState === "complete") esperaPersona();
      else {
        window.addEventListener("load", esperaPersona, { once: true });
        quitaLoad = () => window.removeEventListener("load", esperaPersona);
      }
    };

    // Nada de lo anterior arranca hasta que la caja se acerca a la pantalla.
    const io = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        io.disconnect();
        alCargar();
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(caja);

    return () => {
      cancelado = true;
      io.disconnect();
      quitaInteraccion();
      quitaLoad();
    };
  }, []);

  const marca = useCallback((on: boolean) => {
    const caja = ref.current?.parentElement;
    if (!caja) return;
    if (on) caja.setAttribute("data-3d", "on");
    else caja.removeAttribute("data-3d");
  }, []);

  const alListo = useCallback(() => marca(true), [marca]);
  const alFallar = useCallback(() => {
    marca(false);
    setMontar(false);
  }, [marca]);

  const Escena =
    nombre === "arcada" ? EscenaArcada : nombre === "volumen" ? EscenaVolumen : EscenaClinica;

  return (
    <div ref={ref} className="dcei-escena__3d" aria-hidden="true">
      {montar ? <Escena onReady={alListo} onFail={alFallar} /> : null}
    </div>
  );
}
