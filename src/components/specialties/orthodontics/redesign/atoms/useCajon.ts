"use client";
// Teclado y foco de un cajón o una ventana del módulo de Ortodoncia.
//
// Al abrir, el foco entra al panel (antes se quedaba en el botón que lo abrió,
// DETRÁS del velo: con Tab se recorría la página de fondo). Tab da la vuelta
// dentro del panel, Escape lo cierra —igual que pulsar el velo— y al cerrar el
// foco vuelve a donde estaba.
//
// No sabe nada del contenido: solo de teclas. Es el mismo comportamiento que
// ya trae el `Drawer` del design-system (`ui/design-system/Drawer.tsx`).

import { useEffect, useRef } from "react";

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useCajon<T extends HTMLElement = HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  // Siempre el `onClose` más reciente, sin volver a montar los oyentes.
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Dentro de una lista desplegable o un selector de fecha, Escape es
        // del propio control (cierra su menú): no se lleva el cajón por delante.
        const t = e.target;
        if (t instanceof HTMLSelectElement) return;
        if (t instanceof HTMLInputElement && /^(date|datetime-local|time|month)$/.test(t.type)) return;
        e.stopPropagation();
        cerrar.current();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = Array.from(panel.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (lista.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = lista[0]!;
      const ultimo = lista[lista.length - 1]!;
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || activo === panel)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };

    panel.addEventListener("keydown", onKey);
    return () => {
      panel.removeEventListener("keydown", onKey);
      if (antes && document.contains(antes)) antes.focus({ preventScroll: true });
    };
  }, []);

  return ref;
}
