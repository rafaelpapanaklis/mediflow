"use client";
import { useState, useEffect, useCallback } from "react";

/**
 * Abrir la paleta desde FUERA del topbar («Buscar paciente» de Hoy con la
 * bandera `menu-dos-niveles`, por ejemplo). El estado de este hook es LOCAL:
 * cada `useCommandPalette()` es una paleta distinta y solo la del topbar pinta
 * `<CommandPalette>`. Quien quiera abrir ESA no llama al hook: pide con este
 * evento de ventana (mismo patrón que `mf:open-shortcuts-panel`) y el topbar,
 * que ya está escuchando, la abre.
 */
export const EVENTO_ABRIR_PALETA = "mf:open-command-palette";

export function pedirAbrirPaleta() {
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_PALETA));
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const openPalette = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const abrir = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener(EVENTO_ABRIR_PALETA, abrir);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener(EVENTO_ABRIR_PALETA, abrir);
    };
  }, []);

  return { open, setOpen, toggle, close, openPalette };
}

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
