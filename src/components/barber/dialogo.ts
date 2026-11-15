"use client";

// ═══════════════════════════════════════════════════════════════════════
// El comportamiento de TODAS las ventanas del vertical barber, en un lugar.
//
// EL BUG (15-nov, Rafael en «Dar una estrella»): se escribía UNA letra y el
// cursor se iba a la «X». Cada ventana hacía
//     useEffect(() => { …Esc…; primerEnfocable.focus(); }, [onClose])
// y quien la usa pasa onClose={() => setDialog(null)}: una función NUEVA en
// cada render. Cada tecla → re-render → el efecto corría otra vez → el foco
// saltaba al primer enfocable (la X, que va antes que los campos).
//
// Aquí:
//   · onClose se lee de un ref que se actualiza en cada render: Esc llama
//     siempre a la versión actual sin re-suscribir nada;
//   · Esc, el candado de scroll y el foco inicial se ponen UNA vez al abrir
//     (dependen solo de `abierta`), y al cerrar el foco vuelve a quien abrió;
//   · el foco inicial va al primer CAMPO (input, textarea, select); si no
//     hay, al primer botón del cuerpo o del pie, NUNCA a la X de cerrar
//     (marcada con data-dialogo-cerrar).
// Probado en src/components/barber/__tests__/dialogo.test.ts.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, type RefObject } from "react";

/** Atributo que lleva el botón de cerrar de cada ventana. */
export const DIALOGO_CERRAR = "data-dialogo-cerrar";

const CAMPOS =
  'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])';
const OTROS = `button:not([disabled]):not([${DIALOGO_CERRAR}]), a[href]:not([${DIALOGO_CERRAR}]), [tabindex]:not([tabindex="-1"]):not([${DIALOGO_CERRAR}])`;

/** Dónde poner el foco al abrir: el primer campo; si no hay, el primer control que no sea la X. */
export function primerEnfocable(raiz: ParentNode | null | undefined): HTMLElement | null {
  if (!raiz) return null;
  return raiz.querySelector<HTMLElement>(CAMPOS) ?? raiz.querySelector<HTMLElement>(OTROS);
}

export function useDialogo(opts: {
  /** El panel de la ventana (role="dialog"). */
  panel: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Para ventanas que se montan cerradas; las que solo existen abiertas, true. */
  abierta?: boolean;
  /** Bloquear el scroll de la página mientras está abierta. */
  bloquearScroll?: boolean;
  /** Que Esc no siga a otros oyentes (p. ej. la agenda, que también lo escucha). */
  detenerEsc?: boolean;
}): void {
  const { panel, abierta = true, bloquearScroll = true, detenerEsc = false } = opts;
  // La versión ACTUAL de onClose, sin re-suscribir el efecto en cada render.
  const onCloseRef = useRef(opts.onClose);
  onCloseRef.current = opts.onClose;

  // Esc y candado de scroll: una vez por apertura.
  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detenerEsc) e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const antes = document.body.style.overflow;
    if (bloquearScroll) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (bloquearScroll) document.body.style.overflow = antes;
    };
  }, [abierta, bloquearScroll, detenerEsc]);

  // Foco inicial: una vez por apertura; al cerrar vuelve a quien abrió.
  useEffect(() => {
    if (!abierta) return;
    const quienAbrio = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Un cuadro después: la ventana ya está pintada (y montada, si va por portal).
    const raf = window.requestAnimationFrame(() => {
      const raiz = panel.current;
      if (!raiz || raiz.contains(document.activeElement)) return;
      (primerEnfocable(raiz) ?? raiz).focus();
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (quienAbrio && document.contains(quienAbrio)) quienAbrio.focus();
    };
    // `panel` es un ref estable: solo cuenta abrir y cerrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierta]);
}
