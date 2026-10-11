"use client";

import { useEffect, useRef, useState } from "react";
import type { GloboSeguridad } from "./globo-seguridad-motor";
import { RUTA_GLOBO_ESTATICO } from "./globo-seguridad-ruta";

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
 *  3. Entrada: marca con `is-visto` lo que va entrando en pantalla (la
 *     coreografía es CSS).
 *  4. Descripciones en pantallas táctiles: tocar un sello la muestra
 *     (`is-abierto`), tocar fuera —u otro sello, o el mismo— la oculta. Con
 *     ratón NO hay nada que se fije con clic: ahí manda `:hover` y la
 *     descripción se va al quitar el ratón. Escape la cierra con teclado.
 *
 * Nada sigue al ratón: Rafael pidió quitar la profundidad/parallax (4-oct), así
 * que aquí no hay `pointermove`. Lo único que responde al ratón es el sello
 * sobre el que está, y eso es CSS.
 *
 * Con `prefers-reduced-motion` no hay entrada ni animación: el motor pinta UN
 * cuadro fijo del globo y se queda quieto. Las descripciones siguen
 * funcionando igual, sin transiciones.
 *
 * ── Safari de iPad/iPhone: versión ESTÁTICA (11-oct-2026, ws1-t10) ──
 * En WebKit táctil la franja parpadeaba al hacer scroll: iOS desplaza la
 * página en otro proceso y pinta las capas compuestas con retraso, y aquí
 * había 19 animaciones de capa (sellos flotando, cometas de 724 px, ondas,
 * destellos, escudo), un canvas acelerado y una entrada que promovía y
 * degradaba capas justo al pasar. Ahí no se monta el motor ni se anima nada
 * (`dcsg--estatico`, franja-seguridad.css): el globo es una IMAGEN del mismo
 * cuadro (public/landing/seguridad/globo.svg, generada del mismo mapa) y los
 * sellos siguen abriendo su descripción al tocarlos. Escritorio, Android y el
 * Safari de Mac quedan igual que antes.
 */

/**
 * ¿Es Safari de iPad/iPhone (o cualquier navegador de iOS: todos son WebKit)?
 * iPadOS se presenta como Mac en el user-agent y en `platform`, así que se mira
 * el motor (`vendor` Apple) y que haya pantalla táctil: `maxTouchPoints` o,
 * si el navegador no lo informa, `(any-pointer: coarse)`. El Safari de Mac
 * (sin pantalla táctil) y Chrome/Firefox (vendor Google o vacío) quedan fuera.
 */
export function esWebKitTactil(nav: Pick<Navigator, "vendor" | "maxTouchPoints">, coincide: (q: string) => boolean): boolean {
  if (!/Apple/.test(nav.vendor || "")) return false;
  if (nav.maxTouchPoints > 1) return true;
  return coincide("(any-pointer: coarse)");
}

export function GloboSeguridadVivo() {
  const ref = useRef<HTMLCanvasElement | HTMLImageElement>(null);
  const [estatico, setEstatico] = useState(false);

  useEffect(() => {
    const lienzo = ref.current;
    const marco = lienzo?.parentElement;
    const panel = lienzo?.closest<HTMLElement>(".dcsg__panel");
    const escena = lienzo?.closest<HTMLElement>(".dcsg__escena");
    if (!lienzo || !marco || !panel || !escena || typeof IntersectionObserver === "undefined") return;

    const medio = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
    const quieto = medio("(prefers-reduced-motion: reduce)");
    // En pantallas táctiles el globo va a ~30 cuadros por segundo (batería).
    const suave = medio("(pointer: coarse)");
    // Red de seguridad para Safari de iPad/iPhone: imagen fija, sin animaciones.
    const fijo = esWebKitTactil(navigator, medio);
    let globo: GloboSeguridad | null = null;
    let desmontado = false;
    let aLaVista = false;

    const animar = () => {
      if (!globo) return;
      if (aLaVista && !document.hidden) globo.arrancar();
      else globo.parar();
    };

    let carga: IntersectionObserver | null = null;
    let vista: IntersectionObserver | null = null;
    if (fijo) {
      panel.classList.add("dcsg--estatico");
      setEstatico(true);
    } else if (lienzo instanceof HTMLCanvasElement) {
      const canvas = lienzo;
      // 1 · Carga perezosa (una sola vez).
      const cargador = new IntersectionObserver(
        (entradas) => {
          if (!entradas.some((e) => e.isIntersecting)) return;
          cargador.disconnect();
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
      cargador.observe(marco);
      carga = cargador;

      // 2 · Pausa fuera de pantalla o con la pestaña oculta.
      vista = new IntersectionObserver((entradas) => {
        aLaVista = entradas[entradas.length - 1].isIntersecting;
        animar();
      });
      vista.observe(marco);
      document.addEventListener("visibilitychange", animar);
    }

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

    // 3 · Entrada al hacer scroll (no en la versión estática: ahí todo se ve
    // desde el principio y ninguna capa cambia al pasar).
    let entrada: IntersectionObserver | null = null;
    if (!quieto && !fijo) {
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
    }

    return () => {
      desmontado = true;
      carga?.disconnect();
      vista?.disconnect();
      entrada?.disconnect();
      document.removeEventListener("visibilitychange", animar);
      document.removeEventListener("pointerdown", alApoyar);
      document.removeEventListener("pointerup", alLevantar);
      document.removeEventListener("pointercancel", alCancelar);
      document.removeEventListener("keydown", alTeclear);
      globo?.destruir();
    };
  }, []);

  // La imagen ya estaba en caché: `load` pudo dispararse antes de que React
  // enganchara `onLoad`.
  useEffect(() => {
    const img = ref.current;
    if (estatico && img instanceof HTMLImageElement && img.complete && img.naturalWidth) img.parentElement?.classList.add("is-vivo");
  }, [estatico]);

  if (estatico) {
    return (
      // SVG decorativo de 17 KB que solo pide Safari de iPad/iPhone: next/image
      // no optimiza SVG y metería su propio wrapper en el globo.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref as React.RefObject<HTMLImageElement>}
        className="dcsg__lienzo"
        src={RUTA_GLOBO_ESTATICO}
        alt=""
        aria-hidden="true"
        width={240}
        height={240}
        decoding="async"
        onLoad={(e) => e.currentTarget.parentElement?.classList.add("is-vivo")}
      />
    );
  }
  return <canvas ref={ref as React.RefObject<HTMLCanvasElement>} className="dcsg__lienzo" aria-hidden="true" />;
}
