"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * GESTOS TÁCTILES PARA LOS PLANOS DEL CBCT — sin tocar el dental.
 *
 * `MprPane` (src/components/patient-3d/MprPane.tsx) está escrito para el
 * RATÓN: `onMouseDown/Move/Up` para la cruz, la medición, la sonda y el
 * paneo, y un listener nativo de `wheel` para navegar cortes y hacer zoom
 * con Ctrl. En una pantalla táctil eso significa que un arrastre no hace
 * nada: el navegador se lo lleva para desplazar la página. 🔴 Ese archivo
 * es del DENTAL y no se edita, así que los gestos se montan DESDE FUERA.
 *
 * Cómo, exactamente:
 *   · UN dedo, herramienta CRUZ → navega cortes. No se reenvía nada: el
 *     índice del corte lo manda el contenedor del instituto (es él quien
 *     tiene `cross`), así que basta con llamarle.
 *   · UN dedo, herramienta medir/sonda/mover → se reenvían `mousedown`/
 *     `mousemove`/`mouseup` al rectángulo negro. Sin esto, con el dedo no
 *     se podría medir, que es justo para lo que se abre un CBCT.
 *   · DOS dedos → paneo Y pellizco a la vez:
 *       – el CENTRO de los dos dedos se reenvía como arrastre con el BOTÓN
 *         CENTRAL, porque MprPane ya trata `e.button === 1` como "panear
 *         siempre, sea cual sea la herramienta". Cero suposiciones nuevas.
 *       – la SEPARACIÓN entre los dedos se reenvía como `wheel` con
 *         `ctrlKey`, que es literalmente lo que ese archivo ya entiende
 *         por zoom. Un paso de rueda por cada 6 % de cambio: sale suave y
 *         no hay que inventar una escala nueva.
 *   · Un TOQUE seco no se toca. Al no llamar a `preventDefault`, el propio
 *     navegador sintetiza el mousedown/mouseup y la cruz se mueve sola.
 *
 * Reenviar eventos es legítimo aquí y no es un truco escondido: React 18
 * escucha en la raíz, así que un `MouseEvent` real y burbujeante lanzado
 * sobre un descendiente dispara su `onMouseDown`; y el `wheel` se lanza
 * sobre el mismísimo elemento donde MprPane puso su listener nativo.
 *
 * Lo único que este archivo TOCA del dental es una propiedad de estilo en
 * caliente: `touch-action: none` sobre el rectángulo negro, para que el
 * navegador no se lleve el arrastre antes de que llegue aquí. Se restaura
 * al desmontar. Si algún día el árbol de MprPane cambiara y no se
 * encontrara ese rectángulo, los gestos simplemente no se activan y el
 * visor se queda como está hoy: nada revienta.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { useEffect, useRef, type RefObject } from "react";

/** Píxeles de arrastre que valen UN corte. Con 7 px, recorrer 668 cortes
 *  cuesta unos cuatro barridos de pantalla: rápido sin ser incontrolable. */
const PX_POR_CORTE = 7;

/** Cambio relativo de la separación entre dedos que vale UN paso de zoom.
 *  MprPane multiplica por 1.1 / 0.9 en cada paso de rueda. */
const PASO_PELLIZCO = 0.06;

/** A partir de aquí un toque deja de ser un TOQUE y pasa a ser arrastre. */
const UMBRAL_ARRASTRE = 8;

export interface EduGestosPlano {
  /** Mueve el corte de ESTE plano: +1 avanza, -1 retrocede. */
  onCorte: (pasos: number) => void;
  /** ¿La herramienta activa es la cruz? Con la cruz, un dedo navega
   *  cortes; con las demás, un dedo se reenvía como ratón. */
  cruz: boolean;
  /** Con `false` no se engancha nada (p. ej. mientras no hay volumen). */
  activo: boolean;
}

/**
 * El rectángulo negro de MprPane a partir de la tarjeta que lo envuelve.
 * Se busca por ESTRUCTURA y no por clase de Tailwind: dentro de la
 * tarjeta, el árbol es `viewport > capa centrada > caja del corte >
 * <canvas>`. Devuelve null si no lo encuentra, y quien llama se rinde.
 */
function eduRectanguloDelPlano(host: HTMLElement | null): HTMLElement | null {
  if (!host) return null;
  const lienzo = host.querySelector("canvas");
  const padre = lienzo && lienzo.parentElement;
  const abuelo = padre && padre.parentElement;
  const visor = abuelo && abuelo.parentElement;
  return visor instanceof HTMLElement ? visor : null;
}

function eventoRaton(tipo: string, x: number, y: number, boton: number): MouseEvent {
  return new MouseEvent(tipo, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: boton,
    // 1 = principal, 4 = central. MprPane solo lee `button`, pero un
    // evento coherente es lo que evita sorpresas si mañana lee `buttons`.
    buttons: boton === 1 ? 4 : 1,
  });
}

function eventoRueda(x: number, y: number, deltaY: number): WheelEvent {
  return new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    deltaY,
    ctrlKey: true, // Ctrl + rueda = zoom, tal como ya lo lee MprPane.
  });
}

/** Un dedo sobre la regleta del corte o sobre un botón NO es un gesto del
 *  visor: es alguien usando ese control. */
function enControl(objetivo: EventTarget | null): boolean {
  return (
    objetivo instanceof Element &&
    objetivo.closest("input, button, a, select, textarea, label") !== null
  );
}

export function useEduGestosPlano(
  hostRef: RefObject<HTMLElement | null>,
  { onCorte, cruz, activo }: EduGestosPlano,
): void {
  // Los gestos viven en listeners nativos que se enganchan UNA vez; lo que
  // cambia entre renders (la herramienta, el callback) entra por una ref
  // para no volver a enganchar en cada pintado.
  const vivo = useRef({ onCorte, cruz });
  vivo.current = { onCorte, cruz };

  useEffect(() => {
    const host = hostRef.current;
    if (!activo || !host || typeof window === "undefined") return;
    const visor = eduRectanguloDelPlano(host);
    if (!visor) return;

    const touchActionPrevio = visor.style.touchAction;
    visor.style.touchAction = "none";

    let modo: null | "corte" | "raton" | "dos" = null;
    let ignorar = false;
    let x0 = 0;
    let y0 = 0;
    let consumido = 0;
    let separacion = 1;
    let cx = 0;
    let cy = 0;

    const empezarUnDedo = (t: Touch) => {
      modo = null;
      x0 = t.clientX;
      y0 = t.clientY;
      consumido = 0;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        ignorar = enControl(e.target);
        if (ignorar) return;
        empezarUnDedo(e.touches[0]);
        return;
      }
      if (e.touches.length === 2 && !ignorar) {
        if (modo === "raton") visor.dispatchEvent(eventoRaton("mouseup", x0, y0, 0));
        modo = "dos";
        const a = e.touches[0];
        const b = e.touches[1];
        separacion = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
        cx = (a.clientX + b.clientX) / 2;
        cy = (a.clientY + b.clientY) / 2;
        visor.dispatchEvent(eventoRaton("mousedown", cx, cy, 1));
      }
    };

    const onMove = (e: TouchEvent) => {
      if (ignorar) return;

      if (modo === "dos" && e.touches.length >= 2) {
        e.preventDefault();
        const a = e.touches[0];
        const b = e.touches[1];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
        const nx = (a.clientX + b.clientX) / 2;
        const ny = (a.clientY + b.clientY) / 2;

        if (nx !== cx || ny !== cy) {
          cx = nx;
          cy = ny;
          visor.dispatchEvent(eventoRaton("mousemove", cx, cy, 1));
        }

        // Un paso de rueda por cada tramo de PASO_PELLIZCO, y la
        // referencia se mueve con cada paso: el zoom sigue al dedo en vez
        // de dar un salto al soltar. Los `while` acotan solos porque
        // `separacion` crece/decrece hacia `d` en cada vuelta.
        while (d / separacion > 1 + PASO_PELLIZCO) {
          visor.dispatchEvent(eventoRueda(cx, cy, -100));
          separacion *= 1 + PASO_PELLIZCO;
        }
        while (d / separacion < 1 - PASO_PELLIZCO) {
          visor.dispatchEvent(eventoRueda(cx, cy, 100));
          separacion *= 1 - PASO_PELLIZCO;
        }
        return;
      }

      if (modo === "dos" || e.touches.length !== 1) return;

      const t = e.touches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;

      if (modo === null) {
        if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE) return;
        modo = vivo.current.cruz ? "corte" : "raton";
        if (modo === "raton") visor.dispatchEvent(eventoRaton("mousedown", x0, y0, 0));
      }

      e.preventDefault();

      if (modo === "corte") {
        // Manda el eje DOMINANTE: arrastrar hacia arriba avanza cortes
        // (mismo sentido que la rueda), y hacia la derecha también, para
        // quien prefiera barrer en horizontal.
        const avance = Math.abs(dy) >= Math.abs(dx) ? -dy : dx;
        const pasos = Math.trunc((avance - consumido) / PX_POR_CORTE);
        if (pasos !== 0) {
          consumido += pasos * PX_POR_CORTE;
          vivo.current.onCorte(pasos);
        }
        return;
      }

      visor.dispatchEvent(eventoRaton("mousemove", t.clientX, t.clientY, 0));
    };

    const onEnd = (e: TouchEvent) => {
      // Se levantó UNO de los dos dedos: se cierra el paneo y el que queda
      // arranca como un gesto nuevo de un dedo (si no, el siguiente
      // arrastre se interpretaría con el centro viejo).
      if (modo === "dos" && e.touches.length === 1) {
        visor.dispatchEvent(eventoRaton("mouseup", cx, cy, 1));
        empezarUnDedo(e.touches[0]);
        return;
      }
      if (e.touches.length > 0) return;

      if (modo === "dos") visor.dispatchEvent(eventoRaton("mouseup", cx, cy, 1));
      else if (modo === "raton") visor.dispatchEvent(eventoRaton("mouseup", x0, y0, 0));
      // Si `modo` quedó en null fue un toque seco: no se hizo
      // preventDefault y el navegador ya sintetizó el clic por su cuenta.
      modo = null;
      ignorar = false;
    };

    host.addEventListener("touchstart", onStart, { passive: false });
    host.addEventListener("touchmove", onMove, { passive: false });
    host.addEventListener("touchend", onEnd, { passive: false });
    host.addEventListener("touchcancel", onEnd, { passive: false });

    return () => {
      host.removeEventListener("touchstart", onStart);
      host.removeEventListener("touchmove", onMove);
      host.removeEventListener("touchend", onEnd);
      host.removeEventListener("touchcancel", onEnd);
      visor.style.touchAction = touchActionPrevio;
    };
  }, [activo, hostRef]);
}
