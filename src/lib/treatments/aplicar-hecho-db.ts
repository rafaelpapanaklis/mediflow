// Lo que «hecho» del plan dejó escrito en el odontograma (ws1-t5 · P7): la columna
// `treatment_plan_items."odontogramaHecho"` (sql/plan-hecho-odontograma.sql), su sonda y su lectura.
// Liviano a propósito (solo prisma): lo importa `snapshot.ts` para que «Completar
// consulta» se salte esas marcas al proponer cobros. La escritura vive en aplicar-hecho.server.ts.

import { prisma } from "@/lib/prisma";
import type { CaraBase, ConflictoDeshacer, EntradaConId, EntradaOdontograma, SinCambio } from "@/lib/odontogram/aplicar-hecho";

// ── La columna (sonda como items-db.ts: to_regclass/information_schema nunca falla) ─────────────

const REPREGUNTAR_MS = 2 * 60_000;
const CLAVE = Symbol.for("dalecontrol.treatments.aplicar-hecho");
type Sonda = { existe: boolean; en: number };

function memoria(): { columna?: Sonda } {
  const g = globalThis as unknown as Record<symbol, { columna?: Sonda } | undefined>;
  if (!g[CLAVE]) g[CLAVE] = {};
  return g[CLAVE]!;
}

/** Solo para las pruebas. */
export function _olvidarSondaHecho(): void {
  delete memoria().columna;
}

/** ¿Está `treatment_plan_items."odontogramaHecho"`? Un «no» se vuelve a preguntar a los 2 min. */
export async function columnaOdontogramaHechoExiste(): Promise<boolean> {
  const m = memoria();
  if (m.columna?.existe) return true;
  if (m.columna && Date.now() - m.columna.en < REPREGUNTAR_MS) return false;
  try {
    const r = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'treatment_plan_items' AND column_name = 'odontogramaHecho'
      ) AS existe`;
    const existe = r[0]?.existe === true;
    m.columna = { existe, en: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[plan:hecho] no se pudo saber si existe la columna odontogramaHecho:", e);
    return false;
  }
}

// ── Lo que se guarda por fila ───────────────────────────────────────────────────────────────────

/** `treatment_plan_items."odontogramaHecho"`: lo que escribió el último «hecho» de la fila. */
export interface RegistroHecho {
  v: 1;
  /** El estado al que vuelve con «deshacer». */
  estadoAntes: "pendiente" | "en_curso";
  /** La cita que tenía la fila antes de «hecho» (la que agendó el plan): vuelve con «deshacer». */
  citaAntes: string | null;
  en: string;
  por: string;
  patientId: string | null;
  /** Por qué no tocó el odontograma (null = sí lo tocó, o no hacía falta). */
  omitido: "sin_permiso" | "sin_paciente" | null;
  sinCambio: SinCambio | null;
  /** Lo que ESTA escritura creó (con su id): lo único que el deshacer quita. */
  altas: EntradaConId[];
  /** Lo que quitó, con su nota. */
  bajas: EntradaOdontograma[];
  /** Todo lo que el procedimiento deja en el odontograma, estuviera ya o no (el doctor lo pudo pintar
   *  antes, o lo pinta después si quien marcó no podía escribir el odontograma). */
  cubre: EntradaOdontograma[];
  deshecho?: { en: string; por: string; devueltas: EntradaOdontograma[]; conflictos: ConflictoDeshacer[] };
}

export function leerRegistro(v: unknown): RegistroHecho | null {
  const r = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!r || typeof r !== "object" || (r as RegistroHecho).v !== 1) return null;
  const x = r as RegistroHecho;
  const entrada = (e: any): EntradaOdontograma => ({
    toothNumber: Number(e?.toothNumber),
    surface: typeof e?.surface === "string" ? (e.surface as CaraBase) : null,
    conditionId: String(e?.conditionId ?? ""),
    notes: typeof e?.notes === "string" ? e.notes : null,
  });
  const lista = (l: unknown) => (Array.isArray(l) ? l.map(entrada) : []);
  return {
    ...x,
    estadoAntes: x.estadoAntes === "en_curso" ? "en_curso" : "pendiente",
    citaAntes: typeof x.citaAntes === "string" ? x.citaAntes : null,
    altas: Array.isArray(x.altas) ? x.altas.filter((a: any) => typeof a?.id === "string").map((a: any) => ({ ...entrada(a), id: a.id })) : [],
    bajas: lista(x.bajas),
    cubre: lista(x.cubre),
    ...(x.deshecho ? { deshecho: { ...x.deshecho, devueltas: lista(x.deshecho.devueltas), conflictos: Array.isArray(x.deshecho.conflictos) ? x.deshecho.conflictos : [] } } : {}),
  };
}

// ── Lo que «Completar consulta» se salta al proponer cobros ────────────────────────────────────

const despuesDe = (iso: string | undefined, desde: Date | null) => {
  if (!desde) return true;
  const t = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(t) || t > desde.getTime();
};

/**
 * Las marcas del odontograma que NO son trabajo nuevo cobrable aunque aparezcan desde la foto
 * anterior (`desde`; null = no hay foto):
 *  - lo que «hecho» del plan puso o cubre, en filas hechas sin deshacer: eso lo cobra la nota del plan;
 *  - lo que un «deshacer» devolvió (la corona que la extracción había quitado): ya estaba antes.
 * Solo cuenta lo ocurrido DESPUÉS de `desde`: lo anterior ya está en la foto (y una resina que se
 * rehace años después sí se vuelve a proponer).
 *
 * ESTRICTA a propósito: si no puede leer, LANZA (la ruta de «Completar consulta» lo atrapa y no
 * propone nada), en vez de proponer cobros que pueden estar repetidos. Tampoco se fía de un «no está»
 * recordado: pregunta cada vez (dos consultas baratas por consulta cerrada).
 */
export async function marcasQueNoSeCobran(patientId: string, desde: Date | null): Promise<EntradaOdontograma[]> {
  if (!patientId) return [];
  const hay = await prisma.$queryRaw<{ tabla: boolean; columna: boolean }[]>`
    SELECT to_regclass('public.treatment_plan_items') IS NOT NULL AS tabla,
           EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'treatment_plan_items' AND column_name = 'odontogramaHecho') AS columna`;
  if (!hay[0]?.tabla || !hay[0]?.columna) return [];
  const p = await prisma.$queryRaw<{ clinicId: string }[]>`SELECT "clinicId" FROM "patients" WHERE "id" = ${patientId}`;
  const clinicId = p[0]?.clinicId;
  if (!clinicId) return [];
  const filas = await prisma.$queryRaw<{ estado: string; odontogramaHecho: unknown }[]>`
    SELECT i."estado", i."odontogramaHecho"
      FROM "treatment_plan_items" i
      JOIN "treatment_plans" t ON t."id" = i."planId" AND t."clinicId" = i."clinicId"
     WHERE i."clinicId" = ${clinicId} AND t."patientId" = ${patientId}
       AND i."odontogramaHecho" IS NOT NULL`;
  const out = new Map<string, EntradaOdontograma>();
  const poner = (e: EntradaOdontograma) =>
    out.set(`${e.toothNumber}:${e.surface ?? "_"}:${e.conditionId}`, { toothNumber: e.toothNumber, surface: e.surface, conditionId: e.conditionId, notes: null });
  for (const f of filas) {
    const r = leerRegistro(f.odontogramaHecho);
    if (!r || (r.patientId && r.patientId !== patientId)) continue;
    if (r.deshecho) {
      if (despuesDe(r.deshecho.en, desde)) r.deshecho.devueltas.forEach(poner);
    } else if (f.estado === "hecho" && despuesDe(r.en, desde)) {
      r.altas.forEach(poner);
      r.cubre.forEach(poner);
    }
  }
  return [...out.values()];
}
