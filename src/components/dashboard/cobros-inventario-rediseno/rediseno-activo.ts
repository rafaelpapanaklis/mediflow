"use client";

import { useEffect, useState } from "react";

/**
 * ¿El panel se está pintando con el diseño nuevo (`menu-dos-niveles`)?
 *
 * Para las ventanas que se abren desde pantallas que NO son de este trabajo
 * (la receta de materiales sale de Procedimientos; «Pedir anticipo», de la
 * Agenda y de la factura): así se visten igual que la pantalla que las abre
 * sin tener que tocar esa pantalla para pasarles un prop. Quien SÍ tiene el
 * interruptor a mano (Inventario) lo pasa por prop, que manda sobre esto.
 *
 * Cómo lo sabe: el layout de /dashboard monta `<TipografiaPanel />`
 * (`menu-dos-niveles/tipografia-panel.tsx`) ÚNICAMENTE con el interruptor
 * encendido para la clínica, y ese componente deja en el documento un
 * `<style data-tipografia-panel>`. Se mira después de montar, no durante el
 * render: en el servidor y en la primera pintura vale `false`, que es la
 * ropa de siempre, y ninguna de estas ventanas está abierta todavía.
 *
 * ⛔ Solo decide ROPA. Ninguna regla, permiso ni cálculo depende de esto.
 */
export function useRedisenoActivo(): boolean {
  const [activo, setActivo] = useState(false);
  useEffect(() => {
    setActivo(document.querySelector("style[data-tipografia-panel]") !== null);
  }, []);
  return activo;
}
