/**
 * Reporte «lo que el bot no supo contestar» (ws1-t11). PURO.
 *
 * Recibe los eventos ya detectados y agrupa por tema con su conteo. Cada
 * pregunta sale anonimizada; las clínicas solo se cuentan (ni texto ni botón
 * para volverlas respuesta automática).
 */
import { anonimizar, motivoClinico, motivoPersonal, type OpcionesAnonimizar } from "./anonimizar";
import type { EventoNoSupo } from "./detectar";
import { ETIQUETA_TEMA, ORDEN_TEMAS, temaDePregunta, type ClaveTema } from "./temas";

export type PreguntaReporte = {
  /** Id del disparador: sirve de llave en la pantalla. */
  id: string;
  at: string;
  pregunta: string;
  /** Lo que contestó el equipo, anonimizado, si sirve como punto de partida. */
  respuestaEquipo: string | null;
};

export type GrupoReporte = {
  tema: ClaveTema;
  etiqueta: string;
  total: number;
  /** Vacío en el grupo clínico: solo se cuenta. */
  preguntas: PreguntaReporte[];
};

export const MAX_PREGUNTAS_POR_TEMA = 6;

export function armarReporte(
  eventos: Array<EventoNoSupo & { anonimizar?: OpcionesAnonimizar }>,
  opciones: {
    /** true si ya hay una respuesta frecuente que contestaría esta pregunta. */
    yaTieneRespuesta?: (pregunta: string) => boolean;
  } = {},
): GrupoReporte[] {
  const grupos = new Map<ClaveTema, GrupoReporte>();
  const vistas = new Set<string>();
  // Lo más reciente primero dentro de cada tema.
  const orden = [...eventos].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const ev of orden) {
    const tema = temaDePregunta(ev.pregunta);
    if (tema !== "clinico" && opciones.yaTieneRespuesta?.(ev.pregunta)) continue;
    let g = grupos.get(tema);
    if (!g) {
      g = { tema, etiqueta: ETIQUETA_TEMA[tema], total: 0, preguntas: [] };
      grupos.set(tema, g);
    }
    g.total++;
    if (tema === "clinico" || g.preguntas.length >= MAX_PREGUNTAS_POR_TEMA) continue;
    const pregunta = anonimizar(ev.pregunta, ev.anonimizar);
    const clave = pregunta.toLowerCase().replace(/[¿?¡!.,\s]+/g, " ").trim();
    if (vistas.has(clave)) continue; // la misma pregunta dos veces: una fila
    vistas.add(clave);
    const respuestaUtil =
      ev.respuesta && !motivoClinico(ev.respuesta) && !motivoPersonal(ev.respuesta)
        ? anonimizar(ev.respuesta, ev.anonimizar)
        : null;
    g.preguntas.push({ id: ev.disparadorId, at: ev.at.toISOString(), pregunta, respuestaEquipo: respuestaUtil });
  }
  return ORDEN_TEMAS.map((t) => grupos.get(t)).filter((g): g is GrupoReporte => !!g && g.total > 0);
}
