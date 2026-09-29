import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LectorRaw } from "./tecnicas-de-la-clinica-db";
import {
  esDiagnosticoDetalleVacio,
  normalizarDiagnosticoDetalle,
  seccionesDelDiagnostico,
  type DiagnosticoBase,
  type DiagnosticoDetalle,
  type SeccionLegible,
} from "./diagnostico-detalle";

// Ortodoncia — el «Diagnóstico» completo (ws1-t8). Una columna nueva (sql/ortodoncia-diagnostico-completo.sql),
// NO declarada en schema.prisma a propósito: con una columna de menos, cualquier lectura del diagnóstico
// tiraría P2022. Va por SQL crudo con su sonda, como plan-detalle-db.ts:
//   - orthodontic_diagnoses."diagnosticoDetalle" JSONB → lo nuevo del diagnóstico
// Sin ella, el diagnóstico se ve como siempre y al guardar se avisa que lo nuevo no quedó.
//
// `clinicId` SIEMPRE el de la sesión: cada consulta lo filtra (sin clínica no se consulta).

const TTL_MS = 60_000;
let sonda: { existe: boolean; at: number } | null = null;

async function sondar(db?: LectorRaw): Promise<boolean | null> {
  try {
    const filas = (await (db ?? prisma).$queryRaw(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'orthodontic_diagnoses' AND column_name = 'diagnosticoDetalle'
      ) AS existe`)) as { existe: boolean }[];
    return filas[0]?.existe === true;
  } catch (e) {
    console.warn("[ortodoncia:diagnóstico] no se pudo comprobar la columna diagnosticoDetalle:", e);
    return null;
  }
}

/** `db` = cliente inyectado (Sabina, solo lectura): se comprueba sin la caché global. */
export async function columnaDeDiagnosticoDetalleExiste(db?: LectorRaw): Promise<boolean> {
  if (db) return (await sondar(db)) === true;
  const t = Date.now();
  if (sonda && (sonda.existe || t - sonda.at < TTL_MS)) return sonda.existe;
  const r = await sondar();
  if (r === null) return false;
  sonda = { existe: r, at: t };
  return r;
}

/** Solo para pruebas. */
export function _olvidarSondaDelDiagnostico(): void {
  sonda = null;
}

/** Los detalles de estos diagnósticos, en lote. Uno sin detalle (o sin la columna) no sale. Nunca lanza. */
export async function cargarDiagnosticosDetalle(clinicId: string, diagnosisIds: string[], db?: LectorRaw): Promise<Map<string, DiagnosticoDetalle>> {
  const salida = new Map<string, DiagnosticoDetalle>();
  const ids = [...new Set(diagnosisIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return salida;
  try {
    if (!(await columnaDeDiagnosticoDetalleExiste(db))) return salida;
    const filas = (await (db ?? prisma).$queryRaw(Prisma.sql`
      SELECT "id", "diagnosticoDetalle" FROM "orthodontic_diagnoses"
       WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(ids)}) AND "diagnosticoDetalle" IS NOT NULL`)) as {
      id: string;
      diagnosticoDetalle: unknown;
    }[];
    for (const f of filas) salida.set(f.id, normalizarDiagnosticoDetalle(f.diagnosticoDetalle));
  } catch (e) {
    console.warn("[ortodoncia:diagnóstico] no se pudieron leer los detalles:", e);
  }
  return salida;
}

/** Mismo lector, para UNO. `null` = sin detalle (o sin la columna). */
export async function cargarDiagnosticoDetalle(clinicId: string, diagnosisId: string, db?: LectorRaw): Promise<DiagnosticoDetalle | null> {
  return (await cargarDiagnosticosDetalle(clinicId, [diagnosisId], db)).get(diagnosisId) ?? null;
}

/**
 * Lee (con candado de fila) el detalle actual DENTRO de la transacción de quien guarda. `null` = sin detalle.
 * Quien llama ya comprobó la columna con `columnaDeDiagnosticoDetalleExiste`.
 */
export async function leerDetalleParaGuardar(tx: Prisma.TransactionClient, clinicId: string, diagnosisId: string): Promise<DiagnosticoDetalle | null> {
  const filas = (await tx.$queryRaw(Prisma.sql`
    SELECT "diagnosticoDetalle" FROM "orthodontic_diagnoses"
     WHERE "id" = ${diagnosisId} AND "clinicId" = ${clinicId}
     FOR UPDATE`)) as { diagnosticoDetalle: unknown }[];
  const crudo = filas[0]?.diagnosticoDetalle;
  return crudo === null || crudo === undefined ? null : normalizarDiagnosticoDetalle(crudo);
}

/** Escribe el detalle DENTRO de la transacción de quien guarda. Uno vacío se guarda como NULL de SQL. */
export async function escribirDetalle(tx: Prisma.TransactionClient, clinicId: string, diagnosisId: string, detalle: DiagnosticoDetalle): Promise<void> {
  const json = esDiagnosticoDetalleVacio(detalle) ? null : JSON.stringify(detalle);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "orthodontic_diagnoses"
       SET "diagnosticoDetalle" = ${json}::jsonb
     WHERE "id" = ${diagnosisId} AND "clinicId" = ${clinicId}`);
}

// ─── Para los PDF y Sabina: el diagnóstico completo, ya redactado ───────

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Una fila de `orthodontic_diagnoses` (columnas de siempre) como `DiagnosticoBase`. */
export function baseDesdeFila(d: {
  angleClassRight: unknown;
  angleClassLeft: unknown;
  overbiteMm: unknown;
  overbitePercentage: number | null;
  overjetMm: unknown;
  midlineDeviationMm: unknown;
  crowdingUpperMm: unknown;
  crowdingLowerMm: unknown;
  crossbite: boolean;
  crossbiteDetails: string | null;
  openBite: boolean;
  openBiteDetails: string | null;
  etiologySkeletal: boolean;
  etiologyDental: boolean;
  etiologyFunctional: boolean;
  etiologyNotes: string | null;
  habits: unknown;
  habitsDescription: string | null;
  dentalPhase: unknown;
  skeletalPattern?: unknown;
  tmjPainPresent: boolean;
  tmjClickingPresent: boolean;
  tmjNotes: string | null;
  clinicalSummary: string | null;
}): DiagnosticoBase {
  return {
    angleClassRight: String(d.angleClassRight),
    angleClassLeft: String(d.angleClassLeft),
    overbiteMm: n(d.overbiteMm),
    overbitePercentage: d.overbitePercentage,
    overjetMm: n(d.overjetMm),
    midlineDeviationMm: n(d.midlineDeviationMm),
    crowdingUpperMm: n(d.crowdingUpperMm),
    crowdingLowerMm: n(d.crowdingLowerMm),
    crossbite: d.crossbite,
    crossbiteDetails: d.crossbiteDetails,
    openBite: d.openBite,
    openBiteDetails: d.openBiteDetails,
    etiologySkeletal: d.etiologySkeletal,
    etiologyDental: d.etiologyDental,
    etiologyFunctional: d.etiologyFunctional,
    etiologyNotes: d.etiologyNotes,
    habits: Array.isArray(d.habits) ? (d.habits as string[]) : [],
    habitsDescription: d.habitsDescription,
    dentalPhase: d.dentalPhase ? String(d.dentalPhase) : null,
    skeletalPattern: d.skeletalPattern ? String(d.skeletalPattern) : null,
    tmjPainPresent: d.tmjPainPresent,
    tmjClickingPresent: d.tmjClickingPresent,
    tmjNotes: d.tmjNotes,
    clinicalSummary: d.clinicalSummary,
  };
}

/** Un lector con lo mínimo de Prisma para esto (el `prisma` del repo o el doble de solo lectura de Sabina). */
export interface LectorDelDiagnostico extends LectorRaw {
  orthodonticDiagnosis: { findMany(args: unknown): Promise<unknown[]> };
}

/**
 * El diagnóstico COMPLETO de estos diagnósticos, redactado en secciones (`seccionesDelDiagnostico`), para el PDF
 * del plan, el expediente PDF y Sabina. Sin la columna nueva sale lo de siempre. Nunca lanza.
 */
export async function cargarDiagnosticosLegibles(
  clinicId: string,
  diagnosisIds: string[],
  db?: LectorDelDiagnostico,
): Promise<Map<string, SeccionLegible[]>> {
  const salida = new Map<string, SeccionLegible[]>();
  const ids = [...new Set(diagnosisIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return salida;
  try {
    const cliente = (db ?? prisma) as LectorDelDiagnostico;
    const [filas, detalles] = await Promise.all([
      cliente.orthodonticDiagnosis.findMany({ where: { clinicId, id: { in: ids }, deletedAt: null } }) as Promise<
        Array<Parameters<typeof baseDesdeFila>[0] & { id: string }>
      >,
      cargarDiagnosticosDetalle(clinicId, ids, db),
    ]);
    for (const f of filas) salida.set(f.id, seccionesDelDiagnostico(baseDesdeFila(f), detalles.get(f.id) ?? null));
  } catch (e) {
    console.warn("[ortodoncia:diagnóstico] no se pudo redactar el diagnóstico:", e);
  }
  return salida;
}
