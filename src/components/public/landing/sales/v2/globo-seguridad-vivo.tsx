"use client";

import { useEffect, useRef } from "react";
import type { GloboSeguridad } from "./globo-seguridad-motor";

/**
 * La parte viva de la franja de seguridad: el <canvas> del globo y los tres
 * gestos que necesitan JavaScript. Es lo ÚNICO de la franja que entra al bundle
 * de cliente de la portada (este archivo); el motor que dibuja el globo
 * (globo-seguridad-motor.ts, con el mapa dentro) va en un trozo aparte.
 *
 *  1. Carga perezosa: el motor se pide con `import()` cuando el globo está a
 *     300 px de entrar en pantalla, nunca antes. Si no llega (o no hay canvas),
 *     se queda el globo SVG de debajo, que ya gira solo con CSS.
 *  2. Pausa: el globo solo se anima mientras se ve y la pestaña está activa
 *     (y en pantallas táctiles, a ~30 cuadros por segundo).
 *  3. Entrada y profundidad: marca con `is-visto` lo que va entrando en
 *     pantalla (la coreografía es CSS) y, con ratón, publica su posición en
 *     `--px`/`--py` para que globo, escudo y sellos se muevan a distinta
 *     profundidad.
 *
 *  4. Descripciones en pantallas táctiles: tocar un sello la muestra
 *     (`is-abierto`), tocar fuera —u otro sello, o el mismo— la oculta. Con
 *     ratón NO hay nada que se fije con clic: ahí manda `:hover` y la
 *     descripción se va al quitar el ratón. Escape la cierra con teclado.
 *
 * Con `prefers-reduced-motion` no hay entrada, ni seguimiento del ratón, ni
 * animación: el motor pinta UN cuadro fijo del globo y se queda quieto. Las
 * descripciones siguen funcionando igual, sin transiciones.
 */
export function GloboSeguridadVivo() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const marco = canvas?.parentElement;
    const panel = canvas?.closest<HTMLElement>(".dcsg__panel");
    const escena = canvas?.closest<HTMLElement>(".dcsg__escena");
    if (!canvas || !marco || !panel || !escena || typeof IntersectionObserver === "undefined") return;

    const medio = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
    const quieto = medio("(prefers-reduced-motion: reduce)");
    // En pantallas táctiles el globo va a ~30 cuadros por segundo (batería).
    const suave = medio("(pointer: coarse)");
    let globo: GloboSeguridad | null = null;
    let desmontado = false;
    let aLaVista = false;

    const animar = () => {
      if (!globo) return;
      if (aLaVista && !document.hidden) globo.arrancar();
      else globo.parar();
    };

    // 1 · Carga perezosa (una sola vez).
    const carga = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        carga.disconnect();
        import("./globo-seguridad-motor")
          .then((m) => {
            if (desmontado) return;
            globo = m.crearGlobo(canvas, { quieto, suave, alListo: () => marco.classList.add("is-vivo") });
            animar();
          })
          .catch(() => {
            /* sin motor se queda el globo SVG */
          });
      },
      { rootMargin: "300px 0px" },
    );
    carga.observe(marco);

    // 2 · Pausa fuera de pantalla o con la pestaña oculta.
    const vista = new IntersectionObserver((entradas) => {
      aLaVista = entradas[entradas.length - 1].isIntersecting;
      animar();
    });
    vista.observe(marco);
    document.addEventListener("visibilitychange", animar);

    // 4 · Descripciones al tocar. `dcsg--tactil` apaga el `:hover` del CSS en
    // dispositivos sin ratón, donde un toque lo dejaría «pegado».
    if (medio("(hover: none)")) panel.classList.add("dcsg--tactil");
    const sellos = Array.from(escena.querySelectorAll<HTMLElement>(".dcsg__sello"));
    const cerrar = (salvo?: Element | null) => {
      for (const s of sellos) if (s !== salvo) s.classList.remove("is-abierto");
    };
    // Un toque = apoyar y levantar casi en el mismo punto. No se usa `click`:
    // en iOS no llega al documento desde elementos que no son «clicables», y
    // tocar fuera no cerraría. Si el dedo arrastra (scroll), no cuenta.
    let apoyo: { x: number; y: number } | null = null;
    const alApoyar = (ev: PointerEvent) => {
      apoyo = ev.pointerType === "mouse" ? null : { x: ev.clientX, y: ev.clientY };
    };
    const alCancelar = () => {
      apoyo = null;
    };
    const alLevantar = (ev: PointerEvent) => {
      const a = apoyo;
      apoyo = null;
      if (!a || Math.hypot(ev.clientX - a.x, ev.clientY - a.y) > 12) return;
      const sello = ev.target instanceof Element ? ev.target.closest(".dcsg__sello") : null;
      const mio = sello && escena.contains(sello) ? sello : null;
      cerrar(mio);
      mio?.classList.toggle("is-abierto");
    };
    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      cerrar();
      const activo = document.activeElement;
      if (activo instanceof HTMLElement && sellos.includes(activo)) activo.blur();
    };
    document.addEventListener("pointerdown", alApoyar, { passive: true });
    document.addEventListener("pointerup", alLevantar, { passive: true });
    document.addEventListener("pointercancel", alCancelar, { passive: true });
    document.addEventListener("keydown", alTeclear);

    // 3 · Entrada al hacer scroll + profundidad con el ratón.
    let entrada: IntersectionObserver | null = null;
    let raf = 0;
    let quitarRaton = () => {};
    if (!quieto) {
      // El estado inicial (oculto) lo pone este script: sin JS todo se ve.
      panel.classList.add("dcsg--js");
      entrada = new IntersectionObserver(
        (entradas) => {
          for (const e of entradas) {
            if (!e.isIntersecting) continue;
            (e.target === marco ? escena : e.target).classList.add("is-visto");
            entrada?.unobserve(e.target);
          }
        },
        { threshold: 0.35, rootMargin: "0px 0px -4% 0px" },
      );
      entrada.observe(marco);
      for (const sello of sellos) entrada.observe(sello);

      if (medio("(hover: hover) and (pointer: fine)")) {
        let x = 0;
        let y = 0;
        const publicar = () => {
          raf = 0;
          escena.style.setProperty("--px", x.toFixed(3));
          escena.style.setProperty("--py", y.toFixed(3));
          globo?.apuntar(x, y);
        };
        const mover = (ev: PointerEvent) => {
          const r = panel.getBoundingClientRect();
          x = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1));
          y = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height) * 2 - 1));
          if (!raf) raf = requestAnimationFrame(publicar);
        };
        const salir = () => {
          x = 0;
          y = 0;
          if (!raf) raf = requestAnimationFrame(publicar);
        };
        panel.addEventListener("pointermove", mover, { passive: true });
        panel.addEventListener("pointerleave", salir, { passive: true });
        quitarRaton = () => {
          panel.removeEventListener("pointermove", mover);
          panel.removeEventListener("pointerleave", salir);
        };
      }
    }

    return () => {
      desmontado = true;
      carga.disconnect();
      vista.disconnect();
      entrada?.disconnect();
      document.removeEventListener("visibilitychange", animar);
      document.removeEventListener("pointerdown", alApoyar);
      document.removeEventListener("pointerup", alLevantar);
      document.removeEventListener("pointercancel", alCancelar);
      document.removeEventListener("keydown", alTeclear);
      quitarRaton();
      if (raf) cancelAnimationFrame(raf);
      globo?.destruir();
    };
  }, []);

  return <canvas ref={ref} className="dcsg__lienzo" aria-hidden="true" />;
}
