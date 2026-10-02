// Ortodoncia — el estado del caso en la cabecera de la ficha. PURO (sin Prisma ni React): lo usan el adaptador del
// servidor y la ficha en el cliente.
//
// ws1-t8 (revisión final de ortodoncia, fallo 1): con un caso «Por colocar», guardar la fecha de colocación en
// «Datos del caso» lo pasa a «En curso» en la base, pero la cabecera seguía diciendo «Caso de ortodoncia · Por
// colocar» hasta recargar, y el aviso de la hoja mandaba otra vez a registrar la colocación. La ficha ya no espera
// al refresco de la página: lo que el servidor confirmó al guardar se pinta al momento encima de lo que trajo la
// página, hasta que la página traiga su versión.

import { ETIQUETA_ESTADO_CASO } from "../resumen-para-ficha";
import type { OrthoTreatmentDTO } from "@/components/specialties/orthodontics/redesign/types";

/** Las mismas palabras que `resumen-para-ficha.ts`: un solo nombre para cada estado. */
export const ETIQUETA_DEL_ESTADO: Record<string, string> = {
  PLANNED: ETIQUETA_ESTADO_CASO.planeado,
  IN_PROGRESS: ETIQUETA_ESTADO_CASO["en-curso"],
  ON_HOLD: ETIQUETA_ESTADO_CASO.pausado,
  RETENTION: ETIQUETA_ESTADO_CASO.retencion,
  COMPLETED: ETIQUETA_ESTADO_CASO.terminado,
  DROPPED_OUT: ETIQUETA_ESTADO_CASO.abandonado,
};

/** El estado de la ficha para un caso que existe (sin caso es «no-iniciado», y eso lo decide quien llama). */
export function estadoDeLaFicha(estadoDelCaso: string): OrthoTreatmentDTO["status"] {
  if (estadoDelCaso === "RETENTION") return "retencion";
  if (estadoDelCaso === "COMPLETED") return "completado";
  return "en-tratamiento";
}

/** Lo que el servidor devolvió al guardar «Datos del caso». */
export interface CasoGuardado {
  /** `OrthoTreatmentStatus` tal como quedó en la base. */
  status: string;
  /** ISO, o `null` si el caso no tiene colocación registrada. */
  installedAt: string | null;
}

/** La cabecera con lo que se acaba de guardar: estado, «Por colocar» y fecha de colocación. */
export function tratamientoConCasoGuardado(t: OrthoTreatmentDTO, g: CasoGuardado): OrthoTreatmentDTO {
  const { caseStatusLabel: _etiqueta, casoPorColocar: _porColocar, ...resto } = t;
  const etiqueta = ETIQUETA_DEL_ESTADO[g.status];
  return {
    ...resto,
    status: t.treatmentPlanId ? estadoDeLaFicha(g.status) : t.status,
    startDate: g.installedAt ?? t.startDate,
    ...(etiqueta ? { caseStatusLabel: etiqueta } : {}),
    ...(g.status === "PLANNED" ? { casoPorColocar: true } : {}),
  };
}
