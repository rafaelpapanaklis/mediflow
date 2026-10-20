"use client";

/**
 * WS1-T5 (grupo Salamanca) — lo que las vistas de la agenda nueva leen de la
 * bandera `agenda-flexible`: cómo colorear las citas y los horarios de los
 * doctores ya convertidos al mapa de `horario-doctor/core.ts`.
 *
 * Todo sale del MISMO estado (`useAgenda`), memorizado aquí una vez para que
 * Día, Semana y el panel no armen cada uno su índice del catálogo.
 */

import { useMemo } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { indiceDeProcedimientos } from "@/lib/agenda/color-procedimiento";
import { horariosDesdeObjeto, type HorariosDeDoctores } from "@/lib/horario-doctor/core";
import type { ContextoVista } from "@/lib/agenda-nueva/vista-modelo";

export function useColoresDeCitas(): ContextoVista["colores"] {
  const { state } = useAgenda();
  const flex = state.agendaFlexible;
  return useMemo(() => {
    if (!flex?.encendida || flex.modoColor !== "procedimiento") return null;
    return { modo: "procedimiento" as const, indice: indiceDeProcedimientos(flex.procedimientos) };
  }, [flex]);
}

/**
 * Los horarios propios de los doctores, solo con la bandera encendida (es
 * cuando traen la hora de comida). Apagada = mapa vacío y nada que pintar.
 */
export function useHorariosFlexibles(): HorariosDeDoctores | null {
  const { state } = useAgenda();
  const encendida = state.agendaFlexible?.encendida === true;
  return useMemo(
    () => (encendida ? horariosDesdeObjeto(state.horariosDoctores) : null),
    [encendida, state.horariosDoctores],
  );
}
