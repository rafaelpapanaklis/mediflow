"use client";

/**
 * ¿PUEDE QUIEN MIRA AGENDAR SOBRE ESTE BLOQUEO? — para las ventanas que lo
 * preguntan antes de guardar (`ConfirmarBloqueo` y las dos de arrastrar).
 *
 * Se pide al abrir la ventana, y solo si de verdad hay un bloqueo encima: el
 * 99 % de las citas no tocan ninguno y no ganan ni una consulta.
 *
 * ⛔ SIN CACHÉ, por lo mismo que `usar-bloqueos-dia.ts`: un `Map` de módulo
 * sobrevive a cambiar de clínica activa sin recargar, y una administradora
 * con dos clínicas vería en la segunda la regla de la primera.
 *
 * Devuelve `null` mientras pregunta. Ante cualquier fallo —red, 403, el SQL
 * del ajuste sin aplicar (ver `politica.ts`), o un servidor que no contesta
 * en `ESPERA_MAXIMA_MS`— devuelve `true`: se comporta EXACTAMENTE
 * como antes de este ajuste, y si la clínica dijo «No» el servidor rechaza la
 * cita con su frase. Una ventana que se queda «comprobando» para siempre es
 * peor que las dos cosas.
 */

import { useEffect, useState } from "react";
import { parsePolitica, POLITICA_DE_FABRICA, RUTA_POLITICA } from "./politica";

const ESPERA_MAXIMA_MS = 4000;

export function usePuedoAgendarEncima(activo: boolean): boolean | null {
  const [puedo, setPuedo] = useState<boolean | null>(null);

  useEffect(() => {
    if (!activo) {
      setPuedo(null);
      return;
    }
    let vivo = true;
    setPuedo(null);
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), ESPERA_MAXIMA_MS);

    fetch(RUTA_POLITICA, { credentials: "include", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cuerpo) => {
        if (!vivo) return;
        const p = parsePolitica(cuerpo) ?? POLITICA_DE_FABRICA;
        setPuedo(p.puedoAgendarEncima);
      })
      .catch(() => {
        if (vivo) setPuedo(POLITICA_DE_FABRICA.puedoAgendarEncima);
      })
      .finally(() => clearTimeout(reloj));

    return () => {
      vivo = false;
      clearTimeout(reloj);
      ctrl.abort();
    };
  }, [activo]);

  return puedo;
}
