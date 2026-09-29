// Ortodoncia — la dirección de la ficha que abre la ventana del caso en el paso que falta (ws1-t12). Sin Prisma:
// la usan componentes de pantalla (Tablero, Alertas) y el cargador de la ficha.

import type { PasoDelCaso } from "./plan-detalle";

/** El aviso que viaja en la dirección: `?tab=ortodoncia&completar=plan`. */
export const PARAMETRO_COMPLETAR = "completar";

export function enlaceParaCompletar(patientId: string, paso: PasoDelCaso): string {
  return `/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia&${PARAMETRO_COMPLETAR}=${paso}`;
}

/** Lo que dice el aviso de la dirección, o `null` si no es uno de los dos pasos. */
export function pasoPedido(valor: string | null | undefined): PasoDelCaso | null {
  return valor === "diagnostico" || valor === "plan" ? valor : null;
}
