"use client";

/**
 * LOS BLOQUEOS DEL PERIODO QUE LA AGENDA YA TIENE EN LA MANO.
 *
 * Los añade ws1-t2 al payload que la agenda ya trae (`/api/agenda/range` y la
 * SSR): aquí NO se pide nada por red — sería una segunda consulta del mismo
 * rango y podría enseñar un bloqueo que las citas de al lado todavía no saben
 * que existe.
 *
 * 🔴 SE SIGUE PARSEANDO AUNQUE EL CAMPO YA ESTÉ TIPADO. Desde WS1-T3
 * `state.bloqueos` existe de verdad en el store, pero su contenido llega por
 * red sin validar (`/api/agenda/range` devuelve lo que devuelve). Un `fin` que
 * no sea una fecha o un `reason` que llegue `null` descartan la fila en vez de
 * tumbar la agenda entera en mitad de una consulta.
 */

import { useMemo } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { parseBloqueo, type BloqueoDTO } from "./tipos";

const VACIO: BloqueoDTO[] = [];

export function useBloqueosAgenda(): BloqueoDTO[] {
  const { state } = useAgenda();
  // Cualquier forma que no sea una lista (ausente, null, un objeto) cae a la
  // lista vacía sin romper el render.
  const crudo: unknown = state.bloqueos;

  return useMemo(() => {
    if (!Array.isArray(crudo)) return VACIO;
    const out: BloqueoDTO[] = [];
    for (const fila of crudo) {
      const b = parseBloqueo(fila);
      if (b) out.push(b);
    }
    // Sin ninguno utilizable se devuelve la MISMA referencia vacía: así los
    // `useMemo` que dependen de esta lista no se recalculan en cada render de
    // una clínica que no tiene bloqueos, que son casi todas al principio.
    return out.length > 0 ? out : VACIO;
  }, [crudo]);
}
