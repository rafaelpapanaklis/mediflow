"use client";

/**
 * La ROPA de la ventana «Nueva cita»: la de siempre o la del diseño nuevo.
 *
 * ⛔ Esto no toca ni una regla. La ventana es la misma —el mismo estado, la
 * misma búsqueda de paciente, la misma duración por tratamiento, los mismos
 * huecos libres por doctor y por unidad, el mismo POST y los mismos avisos del
 * servidor—; lo único que decide la apariencia es con qué estilos se pinta
 * cada pieza.
 *
 * La elige el layout del panel con el MISMO interruptor por clínica que el
 * menú de dos niveles (`menu-dos-niveles`). Apagado —todas las clínicas menos
 * las que lo tienen encendido— llega `"clasica"`, que es el valor por defecto,
 * y cada pieza recibe exactamente los mismos `style` de antes: ni un píxel
 * distinto. Encendido, las piezas cambian esos `style` por las clases de
 * `nueva-cita.module.css`.
 *
 * Va por contexto y no por props porque la ventana tiene siete piezas y un
 * calendario que se abre en un portal: el contexto de React sí atraviesa el
 * portal, y así ninguna pieza cambia su firma.
 */

import { createContext, useCallback, useContext, type CSSProperties } from "react";

export type AparienciaNuevaCita = "clasica" | "nueva";

const AparienciaContext = createContext<AparienciaNuevaCita>("clasica");

export const AparienciaNuevaCitaProvider = AparienciaContext.Provider;

/** ¿Se pinta con la ropa del diseño nuevo? */
export function useAparienciaNueva(): boolean {
  return useContext(AparienciaContext) === "nueva";
}

/**
 * `vestir(estiloDeSiempre, claseNueva)` → las props de estilo de un elemento.
 *
 * Con la apariencia clásica devuelve `{ style }` y nada más, así que el
 * elemento recibe EXACTAMENTE lo mismo que antes. Con la nueva devuelve
 * `{ className }` y ningún `style`: un `style` en línea le ganaría a la clase.
 */
export function useVestir(): (
  clasico: CSSProperties | undefined,
  clase: string | undefined,
) => { style?: CSSProperties; className?: string } {
  const nueva = useAparienciaNueva();
  return useCallback(
    (clasico: CSSProperties | undefined, clase: string | undefined) =>
      nueva ? { className: clase } : { style: clasico },
    [nueva],
  );
}
