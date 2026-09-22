"use client";

/**
 * LOS BLOQUEOS DEL PERIODO QUE LA AGENDA YA TIENE EN LA MANO.
 *
 * Los añade ws1-t2 al payload que la agenda ya trae (`/api/agenda/range` y la
 * SSR): aquí NO se pide nada por red — sería una segunda consulta del mismo
 * rango y podría enseñar un bloqueo que las citas de al lado todavía no saben
 * que existe.
 *
 * 🔴 SE LEE CON CAST Y SE PARSEA. El campo todavía no está en el tipo del
 * proveedor (`src/components/dashboard/agenda/agenda-provider.tsx`), que es de
 * ws1-t2 y esta pantalla no toca. Mientras no lo esté, esto devuelve una lista
 * vacía y la agenda se pinta exactamente como hoy; en cuanto lo esté, las
 * franjas salen solas sin tocar una línea de aquí. Ese es el punto de leerlo
 * así y no de esperar su aviso.
 */

import { useMemo } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { parseBloqueo, type BloqueoDTO } from "./tipos";

const VACIO: BloqueoDTO[] = [];

export function useBloqueosAgenda(): BloqueoDTO[] {
  const { state } = useAgenda();
  // El campo que ws1-t2 añade al estado de la agenda. Cualquier otra forma
  // (ausente, null, un objeto) cae a la lista vacía sin romper el render.
  const crudo = (state as unknown as { bloqueos?: unknown }).bloqueos;

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
