// Ortodoncia — REEVALUACIONES del caso (ws1-t8, decisión de Rafael del 29-sep-2026). PURO.
//
// Un caso tiene una versión VIVA (la que se edita en la pestaña) y, por cada «Nueva reevaluación», una
// versión CERRADA: una foto fechada e inmutable del diagnóstico y del plan de tratamiento completos
// (columnas + los dos JSON), con quién la cerró, cuándo y por qué se reevaluó. Nunca se sobrescribe ni se borra
// una versión cerrada (NOM-004): la tabla `orthodontic_case_versions` (sql/ortodoncia-reevaluaciones.sql) no
// acepta UPDATE ni DELETE.
//
// Numeración: la fila N guarda la versión N ya cerrada. La 0 es la «Inicial» (empezó con el diagnóstico); la
// fila N también dice el MOTIVO y la FECHA de la reevaluación que la cerró, que es donde empieza la N+1. La
// versión viva es la N+1 = número de filas: «Reevaluación k» desde el `cerradaEl` de la fila k−1.

import {
  normalizarDiagnosticoDetalle,
  seccionesDelDiagnostico,
  type DiagnosticoBase,
  type SeccionLegible,
} from "./diagnostico-detalle";
import { lineasDelPlan, normalizarPlanDetalle, type LineaDelPlan } from "./plan-detalle";
import { nombreDeTecnica } from "./tecnicas-de-la-clinica";

export const MOTIVO_MINIMO = 5;
export const MOTIVO_MAXIMO = 500;

/** Una versión cerrada, tal como se lee de la tabla. */
export interface VersionCerrada {
  id: string;
  numero: number;
  iniciadaEl: string;
  cerradaEl: string;
  /** Por qué se reevaluó (lo que abrió la versión SIGUIENTE). */
  motivo: string;
  cerradaPor: string | null;
  diagnostico: Record<string, unknown>;
  diagnosticoDetalle: unknown;
  plan: Record<string, unknown>;
  planDetalle: unknown;
}

/** Un punto de la línea de tiempo: «Inicial 12/09/2026», «Reevaluación 1 29/09/2026». */
export interface PuntoDeVersion {
  numero: number;
  etiqueta: string;
  desde: string;
  hasta: string | null;
  /** El motivo de la reevaluación que ABRIÓ esta versión (la inicial no tiene). */
  motivo: string | null;
  actual: boolean;
}

export function etiquetaDeVersion(numero: number): string {
  return numero === 0 ? "Inicial" : `Reevaluación ${numero}`;
}

/**
 * «dd/mm/aaaa» en la zona horaria de la CLÍNICA (no UTC: una reevaluación cerrada a las 6 p.m. de México no es
 * del día siguiente). Un día suelto («2026-09-29») se respeta tal cual.
 */
export function fechaDma(iso: string | null | undefined, zona: string = ZONA_POR_DEFECTO): string {
  if (!iso) return "";
  const soloDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (soloDia) return `${soloDia[3]}/${soloDia[2]}/${soloDia[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat("es-MX", { timeZone: zona, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  } catch {
    partes = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA_POR_DEFECTO, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  }
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")}`;
}

export const ZONA_POR_DEFECTO = "America/Mexico_City";

/** La línea de tiempo completa: las cerradas en orden y la viva al final. `inicioDelCaso` = fecha del diagnóstico. */
export function lineaDeTiempo(cerradas: ReadonlyArray<Pick<VersionCerrada, "numero" | "iniciadaEl" | "cerradaEl" | "motivo">>, inicioDelCaso: string): PuntoDeVersion[] {
  const orden = [...cerradas].sort((a, b) => a.numero - b.numero);
  const puntos: PuntoDeVersion[] = orden.map((v, i) => ({
    numero: v.numero,
    etiqueta: etiquetaDeVersion(v.numero),
    desde: i === 0 ? v.iniciadaEl : orden[i - 1]!.cerradaEl,
    hasta: v.cerradaEl,
    motivo: i === 0 ? null : orden[i - 1]!.motivo,
    actual: false,
  }));
  const ultima = orden[orden.length - 1];
  puntos.push({
    numero: orden.length,
    etiqueta: etiquetaDeVersion(orden.length),
    desde: ultima ? ultima.cerradaEl : inicioDelCaso,
    hasta: null,
    motivo: ultima ? ultima.motivo : null,
    actual: true,
  });
  return puntos;
}

export function validarMotivo(raw: unknown): { ok: true; motivo: string } | { ok: false; error: string } {
  const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (t.length < MOTIVO_MINIMO) return { ok: false, error: `Escribe el motivo de la reevaluación (al menos ${MOTIVO_MINIMO} caracteres).` };
  if (t.length > MOTIVO_MAXIMO) return { ok: false, error: `Motivo: máximo ${MOTIVO_MAXIMO} caracteres.` };
  return { ok: true, motivo: t };
}

/**
 * La frase de Movimientos al abrir una reevaluación, CON su motivo: «Abrió la reevaluación 3 del caso de ortodoncia
 * (quedó guardada la versión «Reevaluación 2» del diagnóstico y del plan). Motivo: «…»». `cerrada` = número de la
 * versión que se acaba de cerrar; la nueva es la siguiente.
 */
export function textoDelMovimientoDeReevaluacion(cerrada: number, motivo: string): string {
  const base = `Abrió la ${etiquetaDeVersion(cerrada + 1).toLowerCase()} del caso de ortodoncia (quedó guardada la versión «${etiquetaDeVersion(cerrada)}» del diagnóstico y del plan)`;
  const m = motivo.replace(/\s+/g, " ").trim();
  return m ? `${base}. Motivo: «${m}»` : base;
}

// ─── Lectura de una versión ─────────────────────────────────────────────

const n = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const b = (v: unknown): boolean => v === true;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Las columnas del diagnóstico guardadas en la foto (JSON de la fila de Prisma) como `DiagnosticoBase`. */
export function baseDeLaFoto(d: Record<string, unknown>): DiagnosticoBase {
  return {
    angleClassRight: String(d.angleClassRight ?? ""),
    angleClassLeft: String(d.angleClassLeft ?? ""),
    overbiteMm: n(d.overbiteMm),
    overbitePercentage: n(d.overbitePercentage),
    overjetMm: n(d.overjetMm),
    midlineDeviationMm: n(d.midlineDeviationMm),
    crowdingUpperMm: n(d.crowdingUpperMm),
    crowdingLowerMm: n(d.crowdingLowerMm),
    crossbite: b(d.crossbite),
    crossbiteDetails: s(d.crossbiteDetails),
    openBite: b(d.openBite),
    openBiteDetails: s(d.openBiteDetails),
    etiologySkeletal: b(d.etiologySkeletal),
    etiologyDental: b(d.etiologyDental),
    etiologyFunctional: b(d.etiologyFunctional),
    etiologyNotes: s(d.etiologyNotes),
    habits: Array.isArray(d.habits) ? (d.habits as string[]) : [],
    habitsDescription: s(d.habitsDescription),
    dentalPhase: s(d.dentalPhase),
    skeletalPattern: s(d.skeletalPattern),
    tmjPainPresent: b(d.tmjPainPresent),
    tmjClickingPresent: b(d.tmjClickingPresent),
    tmjNotes: s(d.tmjNotes),
    clinicalSummary: s(d.clinicalSummary),
  };
}

export interface VersionLegible {
  diagnostico: SeccionLegible[];
  resumen: string | null;
  plan: LineaDelPlan[];
}

/** Una foto (diagnóstico + plan) redactada como la ficha: `seccionesDelDiagnostico` y `lineasDelPlan`. */
export function versionLegible(foto: Pick<VersionCerrada, "diagnostico" | "diagnosticoDetalle" | "plan" | "planDetalle">): VersionLegible {
  const base = baseDeLaFoto(foto.diagnostico ?? {});
  const detalle = foto.diagnosticoDetalle ? normalizarDiagnosticoDetalle(foto.diagnosticoDetalle) : null;
  const p = foto.plan ?? {};
  const plan = lineasDelPlan(
    {
      estimatedDurationMonths: n(p.estimatedDurationMonths),
      anchorageType: s(p.anchorageType),
      extractionsRequired: b(p.extractionsRequired),
      extractionsTeethFdi: Array.isArray(p.extractionsTeethFdi) ? (p.extractionsTeethFdi as number[]) : [],
    },
    foto.planDetalle ? normalizarPlanDetalle(foto.planDetalle) : null,
    0,
  ).filter((l) => l.clave !== "tads");
  if (s(p.technique)) plan.unshift({ clave: "tecnica", etiqueta: "Técnica", valor: nombreDeTecnica(String(p.technique), s(p.techniqueLabel)) });
  if (s(p.retentionPlanText)) plan.push({ clave: "retencion", etiqueta: "Plan de retención", valor: String(p.retentionPlanText) });
  return { diagnostico: seccionesDelDiagnostico(base, detalle), resumen: base.clinicalSummary, plan };
}

// ─── Qué cambió entre dos versiones ─────────────────────────────────────

export interface CambioEntreVersiones {
  parte: "Diagnóstico" | "Plan de tratamiento";
  apartado: string;
  etiqueta: string;
  antes: string | null;
  despues: string | null;
}

/**
 * Renglones «de siempre» que la ficha deja de mostrar cuando existe su versión detallada (la línea media única
 * cuando hay superior/inferior; la mordida sí/no cuando hay su zona). Que desaparezcan NO es un dato perdido.
 */
const REEMPLAZADOS: Record<string, readonly string[]> = {
  "oclusal.midlineDeviationMm": ["oclusal.lineaMediaSuperior", "oclusal.lineaMediaInferior"],
  "dentoalveolar.crossbite": ["dentoalveolar.cruzadaAnterior", "dentoalveolar.cruzadaPosterior"],
  "dentoalveolar.openBite": ["dentoalveolar.mordidaAbierta"],
};

/** Renglón por renglón (misma redacción que la ficha): lo que se agregó, se quitó o cambió de valor. */
export function queCambio(antes: VersionLegible, despues: VersionLegible): CambioEntreVersiones[] {
  const out: CambioEntreVersiones[] = [];
  const mapaDx = (v: VersionLegible) => {
    const m = new Map<string, { apartado: string; etiqueta: string; valor: string }>();
    for (const sec of v.diagnostico) for (const l of sec.lineas) m.set(`${sec.clave}.${l.clave}`, { apartado: sec.titulo, etiqueta: l.etiqueta, valor: l.valor });
    if (v.resumen) m.set("resumen", { apartado: "Resumen diagnóstico", etiqueta: "Resumen", valor: v.resumen });
    return m;
  };
  const mapaPlan = (v: VersionLegible) => new Map(v.plan.map((l) => [l.clave, { apartado: "Plan", etiqueta: l.etiqueta, valor: l.valor }]));
  const comparar = (parte: CambioEntreVersiones["parte"], a: Map<string, { apartado: string; etiqueta: string; valor: string }>, d: typeof a) => {
    for (const k of new Set([...a.keys(), ...d.keys()])) {
      const x = a.get(k);
      const y = d.get(k);
      if (x?.valor === y?.valor) continue;
      if (x && !y && (REEMPLAZADOS[k] ?? []).some((r) => d.has(r))) continue;
      const ref = (y ?? x)!;
      out.push({ parte, apartado: ref.apartado, etiqueta: ref.etiqueta, antes: x?.valor ?? null, despues: y?.valor ?? null });
    }
  };
  comparar("Diagnóstico", mapaDx(antes), mapaDx(despues));
  comparar("Plan de tratamiento", mapaPlan(antes), mapaPlan(despues));
  return out;
}
