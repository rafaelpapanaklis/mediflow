// Ortodoncia — «Abrir caso» desde el módulo (ws1-t3, H17 de la QA en vivo del
// 28-sep-2026). Puro, sin React ni Prisma: lo prueban los tests en node.
//
// El fallo: un caso solo se podía abrir entrando primero a la ficha del
// paciente. Dentro del módulo (Pacientes en tratamiento) no había por dónde.
//
// El arreglo NO inventa otra alta: el botón lleva a elegir paciente y de ahí a
// SU ficha, en la pestaña Ortodoncia, que abre el mismo asistente de siempre
// (`DrawerNewCase`). Lo que viaja en la dirección es solo el aviso de
// «ábrelo al llegar» — quién puede abrir un caso lo sigue decidiendo la ficha.

/** El aviso que viaja en la dirección: `?tab=ortodoncia&abrirCaso=1`. */
export const PARAMETRO_ABRIR_CASO = "abrirCaso";

export type SituacionOrto =
  /** Tiene un caso en curso (planeado, en tratamiento, en pausa o en retención). */
  | "con-caso"
  /** Se le valoró y quedó en observación: todavía sin plan. */
  | "en-observacion"
  /** Tiene diagnóstico de ortodoncia, pero no un caso en curso. */
  | "con-diagnostico"
  /** Nunca ha tenido nada de ortodoncia. */
  | "sin-caso";

const ESTADOS_EN_CURSO = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"];

/** Dónde está este paciente respecto a ortodoncia, con lo que hay guardado de él. */
export function situacionOrto(p: {
  /** `status` de cada uno de sus planes de tratamiento (sin los borrados). */
  planes: readonly string[];
  /** Cuántos diagnósticos de ortodoncia tiene (sin los borrados). */
  diagnosticos: number;
  /** Alguno de esos diagnósticos está marcado «en observación». */
  enObservacion?: boolean;
}): SituacionOrto {
  if (p.planes.some((s) => ESTADOS_EN_CURSO.includes(s))) return "con-caso";
  if (p.diagnosticos > 0) return p.enObservacion ? "en-observacion" : "con-diagnostico";
  return "sin-caso";
}

/** Lo que dice la etiqueta de cada paciente en la lista de «Abrir caso». */
export function etiquetaDeSituacion(s: SituacionOrto): { texto: string; tono: "info" | "warning" | "neutral" | "success" } {
  switch (s) {
    case "con-caso":
      return { texto: "Ya tiene un caso abierto", tono: "success" };
    case "en-observacion":
      return { texto: "En observación", tono: "warning" };
    case "con-diagnostico":
      return { texto: "Con diagnóstico, sin caso", tono: "info" };
    default:
      return { texto: "Sin caso", tono: "neutral" };
  }
}

/**
 * A dónde lleva elegir a este paciente: siempre a la pestaña Ortodoncia de su
 * ficha. Si ya tiene un caso en curso, a verlo; si no, con el aviso para que
 * el asistente de alta se abra al llegar.
 */
export function destinoDeAbrirCaso(patientId: string, situacion: SituacionOrto): string {
  const base = `/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia`;
  return situacion === "con-caso" ? base : `${base}&${PARAMETRO_ABRIR_CASO}=1`;
}

/**
 * ¿La ficha tiene que abrir el asistente de alta nada más llegar? Solo si lo
 * pide la dirección, el paciente NO tiene ya un caso y quien mira puede
 * crearlo. El aviso no da ningún permiso: sin `puedeCrear` no pasa nada.
 */
export function debeAbrirElAlta(p: {
  /** El valor de `abrirCaso` en la dirección, o `null` si no viene. */
  parametro: string | null | undefined;
  tieneCaso: boolean;
  puedeCrear: boolean;
}): boolean {
  return p.parametro === "1" && !p.tieneCaso && p.puedeCrear;
}

/** Cuántas letras hacen falta para buscar. Con menos, salen los pacientes más recientes. */
export const MIN_LETRAS_BUSQUEDA = 2;
export const MAX_RESULTADOS = 25;
