// Ortodoncia — «Nueva consulta» de tipo Ortodoncia y las plantillas de nota de
// la hoja de control (Rafael, 28-sep-2026). Puro, sin React ni Prisma: lo
// prueban los tests en node.
//
// 1. La consulta de ortodoncia ES la hoja de control (la de «Registrar
//    control»): elegir «Ortodoncia» en Nueva consulta lleva a la pestaña y,
//    según el paciente, abre la hoja, ofrece abrir un caso o enseña su caso.
// 2. Las seis plantillas de nota de ortodoncia
//    (clinical-shared/evolution-templates/seed-orthodontics.ts) traen
//    marcadores `{{así}}`. Aquí se rellenan con lo que la hoja ya sabe (mes,
//    fase, arco) y lo que no se sabe queda como un hueco a la vista para
//    escribirlo, nunca como `{{clave}}` en la nota de un paciente.

import type { VistaPestanaOrto } from "./pestana-ficha";

export type EstadoDelCaso = "no-iniciado" | "en-tratamiento" | "retencion" | "completado";

export type DestinoConsultaOrto =
  /** Caso activo: se abre su hoja de control. */
  | "hoja-de-control"
  /** Nunca tuvo caso: se ofrece «Abrir caso de ortodoncia». */
  | "abrir-caso"
  /** Tiene historial pero no un caso en marcha (solo valoración, o caso terminado): se enseña su pestaña. */
  | "ver-caso";

/** A dónde lleva elegir «Ortodoncia» en Nueva consulta. */
export function destinoDeConsultaOrto(p: {
  vista: VistaPestanaOrto;
  tienePlan: boolean;
  estado: EstadoDelCaso | null;
}): DestinoConsultaOrto | null {
  if (p.vista === "oculta") return null;
  if (p.vista === "solo-abrir-caso") return "abrir-caso";
  return debeAbrirLaHoja(p) ? "hoja-de-control" : "ver-caso";
}

/** Un caso ACTIVO es uno con plan, en tratamiento o en retención. */
export function debeAbrirLaHoja(p: { tienePlan: boolean; estado: EstadoDelCaso | null }): boolean {
  return p.tienePlan && (p.estado === "en-tratamiento" || p.estado === "retencion");
}

// ── Plantillas de nota ───────────────────────────────────────────────────

/** Lo que se escribe donde la plantilla pide un dato que la hoja no tiene. */
export const HUECO = "____";

export interface ContextoDeControl {
  /** Mes de tratamiento de esta visita. */
  mes: number | null;
  /** Duración estimada del caso, en meses. */
  duracionMeses: number | null;
  /** La fase, dicha para la clínica («Alineación y nivelación»), no su clave. */
  fase: string | null;
  /** El arco con el que llega («NiTi .014»). */
  arcoActual: string | null;
  /** El arco que se coloca hoy, si ya se eligió en la hoja. */
  arcoNuevo: string | null;
}

/** Qué marcador de las plantillas se rellena con qué dato de la hoja. */
const MARCADORES: Record<string, (c: ContextoDeControl) => string | null> = {
  // La nota clínica dice el mes cumplido («mes 4»), como la ficha; el decimal es de la hoja, no de la nota.
  monthInTreatment: (c) => (c.mes === null ? null : String(Math.floor(c.mes))),
  estimatedDurationMonths: (c) => (c.duracionMeses === null ? null : String(c.duracionMeses)),
  currentPhase: (c) => c.fase,
  archWire: (c) => c.arcoActual,
  newArchWire: (c) => c.arcoNuevo,
};

/** Un texto de plantilla con sus marcadores resueltos. Nunca deja `{{algo}}`. */
export function rellenarMarcadores(texto: string, contexto: ContextoDeControl): string {
  return texto.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_todo, clave: string) => {
    const valor = MARCADORES[clave]?.(contexto);
    return valor && valor.trim() !== "" ? valor : HUECO;
  });
}

export interface NotaSoap {
  s: string;
  o: string;
  a: string;
  p: string;
}

/**
 * La nota de la hoja tras aplicar una plantilla. NO pisa lo que el doctor ya
 * escribió: si un campo tiene texto, la plantilla se añade debajo.
 */
export function aplicarPlantillaAlControl(
  actual: NotaSoap,
  plantilla: { S: string; O: string; A: string; P: string },
  contexto: ContextoDeControl,
): NotaSoap {
  const unir = (escrito: string, nuevo: string) => {
    const texto = rellenarMarcadores(nuevo, contexto).trim();
    if (texto === "") return escrito;
    return escrito.trim() === "" ? texto : `${escrito.trimEnd()}\n\n${texto}`;
  };
  return {
    s: unir(actual.s, plantilla.S),
    o: unir(actual.o, plantilla.O),
    a: unir(actual.a, plantilla.A),
    p: unir(actual.p, plantilla.P),
  };
}

/** ¿Quedan huecos por llenar en la nota? Para avisar antes de firmar. */
export function huecosPorLlenar(nota: NotaSoap): number {
  return [nota.s, nota.o, nota.a, nota.p].reduce((n, t) => n + (t.split(HUECO).length - 1), 0);
}
