"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * La puerta del poste 3D. Decide si vale la pena descargar three.js y, si
 * sí, lo hace DESPUÉS de que la página terminó de cargar y el hilo está
 * ocioso: el primer render, el LCP y la hidratación ya pasaron. El chunk
 * de three vive aparte (next/dynamic, ssr:false), igual que el visor 3D
 * del panel (Clinic3DMount.tsx) y el robot con Spline del login.
 *
 * Se queda con el poste CSS —sin pedir ni un byte— cuando:
 *  - el usuario pidió menos movimiento (prefers-reduced-motion);
 *  - la página se ve en menos de 1000px de ancho o sin puntero fino: el
 *    móvil recibe el poste CSS siempre, gama alta o baja;
 *  - hay ahorro de datos o una red 2G/3G;
 *  - el equipo trae poca memoria o pocos núcleos;
 *  - no hay WebGL, o el que hay es por software (SwiftShader/llvmpipe),
 *    que se arrastraría.
 *
 * Y si algo falla al montar (contexto perdido, shader que no compila), el
 * poste CSS sigue debajo intacto: se quita el atributo y vuelve a verse.
 */
const BarberPole3D = dynamic(() => import("./pole-3d"), { ssr: false, loading: () => null });

type NavigatorHints = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
  deviceMemory?: number;
};

function shouldUpgrade(host: HTMLElement): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  const mq = (q: string) => window.matchMedia(q).matches;
  if (mq("(prefers-reduced-motion: reduce)")) return false;
  if (!mq("(pointer: fine)") || !mq("(hover: hover)")) return false;
  const root = host.closest<HTMLElement>(".dcbl");
  if (!root || root.clientWidth < 1000) return false;

  const nav = navigator as NavigatorHints;
  if (nav.connection?.saveData) return false;
  if (nav.connection?.effectiveType && /(^|-)(2g|3g)$/.test(nav.connection.effectiveType)) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return false;
  if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency < 4) return false;

  try {
    const probe = document.createElement("canvas");
    const gl = (probe.getContext("webgl2") || probe.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return false;
  } catch {
    return false;
  }
  return true;
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

export function BarberPoleUpgrade() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState(false);

  useEffect(() => {
    const host = wrapRef.current?.parentElement;
    if (!host || !shouldUpgrade(host)) return;

    let cancelled = false;
    // Orden: load → la PRIMERA señal de que hay alguien (mueve el puntero,
    // hace scroll, toca una tecla) → hilo libre → montar. Quien aterriza y se
    // va no descarga ni un byte de three; quien se queda lo ve en menos de
    // un segundo. Y como Lighthouse/PSI no interactúan, la auditoría mide
    // la página que ve el que rebota: sin los ~600 KB de three encima.
    const INTERACTION = ["pointermove", "pointerdown", "wheel", "keydown", "scroll", "touchstart"] as const;
    const mountWhenIdle = () => {
      if (cancelled) return;
      const w = window as IdleWindow;
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(() => !cancelled && setMount(true), { timeout: 2000 });
      } else {
        window.setTimeout(() => !cancelled && setMount(true), 300);
      }
    };
    const offInteraction = () => {
      for (const ev of INTERACTION) window.removeEventListener(ev, onInteraction);
    };
    const onInteraction = () => {
      offInteraction();
      mountWhenIdle();
    };
    const armInteraction = () => {
      if (cancelled) return;
      for (const ev of INTERACTION) window.addEventListener(ev, onInteraction, { passive: true });
    };
    if (document.readyState === "complete") armInteraction();
    else window.addEventListener("load", armInteraction, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", armInteraction);
      offInteraction();
    };
  }, []);

  const setOn = useCallback((on: boolean) => {
    const host = wrapRef.current?.parentElement;
    if (!host) return;
    if (on) host.setAttribute("data-3d", "on");
    else host.removeAttribute("data-3d");
  }, []);

  const handleReady = useCallback(() => setOn(true), [setOn]);
  const handleFail = useCallback(() => {
    setOn(false);
    setMount(false);
  }, [setOn]);

  return (
    <div ref={wrapRef} className="dcbl-pole3d-wrap" aria-hidden="true">
      {mount ? <BarberPole3D onReady={handleReady} onFail={handleFail} /> : null}
    </div>
  );
}
