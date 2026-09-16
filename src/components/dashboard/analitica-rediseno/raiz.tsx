"use client";

import { useEffect, useState, type RefObject } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./analitica.module.css";

/**
 * Las clases de la raíz del rediseño de Analítica: los tokens `--m2-*` y las
 * dos familias tipográficas del menú de dos niveles (CLASES_MENU), más la
 * caja de esta pantalla. No hay tokens propios: el violeta, los grises y las
 * sombras son literalmente los del menú que Rafael aprobó, así que si mañana
 * cambia allí, aquí cambia solo.
 *
 * SOLO se monta con el interruptor `menu-dos-niveles` encendido para la
 * clínica; apagado no se monta ni un nodo de este paquete.
 */
export const CLASES_ANALITICA = `${CLASES_MENU} ${s.raiz}`;

/** Colores de serie para las gráficas, leídos de los tokens en tiempo real. */
export interface TokensGrafica {
  activo: string;
  azul: string;
  exito: string;
  alerta: string;
  peligro: string;
  texto: string;
  texto2: string;
  texto3: string;
  borde: string;
  tarjeta: string;
}

const VARIABLES: Record<keyof TokensGrafica, string> = {
  activo: "--m2-activo",
  azul: "--brand-blue",
  exito: "--success-strong",
  alerta: "--warning-strong",
  peligro: "--danger",
  texto: "--m2-texto",
  texto2: "--m2-texto-2",
  texto3: "--m2-texto-3",
  borde: "--m2-borde",
  tarjeta: "--m2-tarjeta",
};

/**
 * Lee los tokens del menú (`--m2-*`) y los semánticos globales desde el CSS
 * calculado del nodo que se le pasa, y vuelve a leerlos cuando cambia el tema
 * (la clase `dark` del <html>). Las gráficas de recharts reciben los colores
 * por props de JS, no por CSS: sin esto la serie quedaría con un hex copiado a
 * mano que se desalinearía del menú en cuanto alguien cambie el violeta.
 *
 * Hasta la primera lectura devuelve `null`: la gráfica espera un frame en vez
 * de pintarse con un color que no es el del tema.
 */
export function useTokensGrafica(ref: RefObject<HTMLElement>): TokensGrafica | null {
  const [tokens, setTokens] = useState<TokensGrafica | null>(null);

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const leer = () => {
      const css = getComputedStyle(nodo);
      const salida = {} as TokensGrafica;
      (Object.keys(VARIABLES) as Array<keyof TokensGrafica>).forEach((clave) => {
        salida[clave] = css.getPropertyValue(VARIABLES[clave]).trim();
      });
      setTokens(salida);
    };
    leer();
    // El botón de tema alterna `dark` en <html>; no hay evento, así que se
    // observa el atributo. Sin polling.
    const observador = new MutationObserver(leer);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observador.disconnect();
  }, [ref]);

  return tokens;
}
