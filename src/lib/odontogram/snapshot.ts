import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { cobrosAlMarcar } from "@/lib/treatments/sugerir-procedimiento";
import { marcasQueNoSeCobran } from "@/lib/treatments/aplicar-hecho-db";
import { esEstadoMarca, type EstadoMarca } from "./estado-marca";
import { columnaEstadoExiste, leerEstados } from "./estado-db";

/* ─────── Tipos ───────────────────────────────────────────── */

export type SurfaceKey = "M" | "D" | "V" | "L" | "O";

export interface SnapshotEntry {
  toothNumber: number;
  /** null = condición a nivel diente completo. */
  surface: SurfaceKey | null;
  /** id del catálogo de hallazgos (caries, restoration, crown, rct, …). */
  conditionId: string;
  notes?: string | null;
  /** Rojo/azul (ws1-t6); ausente = lo de antes (o la base sin la columna). */
  estado?: EstadoMarca | null;
}

export interface SnapshotChange {
  toothNumber: number;
  surface: SurfaceKey | null;
  conditionId: string;
  /** "added" = condición nueva vs. el snapshot anterior; "removed" = ya no está. */
  type: "added" | "removed";
  /** El rojo/azul de la marca (ws1-t6): una marca POR HACER o PREVIA no es trabajo hecho hoy. */
  estado?: EstadoMarca | null;
}

export interface SuggestedTreatment {
  code: string;
  name: string;
  toothNumber: number;
  surface: SurfaceKey | null;
  unitPrice: number;
  procedureCatalogId: string | null;
}

/** conditionId reservado para la nota por diente — nunca entra al snapshot. */
const NOTE_CONDITION = "__note__";

/* ─────── Lectura del estado vigente ───────────────────────── */

/**
 * Lee odontogram_entries del paciente (excluye la nota por diente), con su rojo/azul si la base lo
 * guarda. Si no se puede saber si lo guarda, LANZA (sonda estricta): quien la llama para cobrar
 * («Completar consulta») lo atrapa y esa vez no propone nada, en vez de cobrar lo que está en rojo.
 * Quien solo lo enseña (la IA de la consulta) pasa `estricta: false`: sin estados, pero con el
 * odontograma (v2, m6).
 */
export async function readCurrentEntries(patientId: string, opciones: { estricta?: boolean } = {}): Promise<SnapshotEntry[]> {
  const rows = await prisma.odontogramEntry.findMany({
    where: { patientId, conditionId: { not: NOTE_CONDITION } },
    orderBy: [{ toothNumber: "asc" }, { surface: "asc" }],
    select: {
      id: true,
      toothNumber: true,
      surface: true,
      conditionId: true,
      notes: true,
    },
  });
  const estados = (await columnaEstadoExiste({ estricta: opciones.estricta !== false })) ? await leerEstados(prisma, patientId) : new Map<string, EstadoMarca>();
  return rows.map((r) => ({
    toothNumber: r.toothNumber,
    surface: (r.surface ?? null) as SurfaceKey | null,
    conditionId: r.conditionId,
    notes: r.notes,
    ...(estados.has(r.id) ? { estado: estados.get(r.id)! } : {}),
  }));
}

/* ─────── Diff entre snapshots ─────────────────────────────── */

/**
 * La llave de una marca para comparar fotos. Una marca EN ROJO es otra marca que la misma en azul
 * (ws1-t6): si en esta consulta pasó de rojo a azul, aparece como «added» (trabajo hecho hoy).
 */
function keyOf(e: {
  toothNumber: number;
  surface: SurfaceKey | null;
  conditionId: string;
  estado?: EstadoMarca | null;
}): string {
  return `${e.toothNumber}:${e.surface ?? "_"}:${e.conditionId}${e.estado === "por_hacer" ? ":por_hacer" : ""}`;
}

/**
 * Compara dos sets de entries y devuelve los cambios por condición. Cada
 * (diente, cara) puede tener VARIAS condiciones; cada una se trata como un
 * toggle independiente: aparece ("added") o desaparece ("removed").
 */
export function diffSnapshots(prev: SnapshotEntry[], curr: SnapshotEntry[]): SnapshotChange[] {
  const prevKeys = new Set(prev.map(keyOf));
  const currKeys = new Set(curr.map(keyOf));
  const changes: SnapshotChange[] = [];

  for (const c of curr) {
    if (!prevKeys.has(keyOf(c))) {
      changes.push({
        toothNumber: c.toothNumber, surface: c.surface,
        conditionId: c.conditionId, type: "added",
        ...(c.estado ? { estado: c.estado } : {}),
      });
    }
  }
  for (const p of prev) {
    if (!currKeys.has(keyOf(p))) {
      changes.push({
        toothNumber: p.toothNumber, surface: p.surface,
        conditionId: p.conditionId, type: "removed",
        ...(p.estado ? { estado: p.estado } : {}),
      });
    }
  }
  return changes;
}

/* ─────── Catálogo de procedimientos dentales ──────────────── */

export interface CatalogSeedItem {
  code: string;
  name: string;
  category: string;
  basePrice: number;
  duration?: number;
}

/** Catálogo dental por defecto (placeholder MXN). La clínica puede
 *  editar precios desde /dashboard/procedures. */
export const DENTAL_CATALOG_SEED: CatalogSeedItem[] = [
  { code: "ODO_CARIES_DIAG",  name: "Diagnóstico de caries",      category: "dental", basePrice: 0 },
  { code: "ODO_RESINA",       name: "Restauración con resina",    category: "dental", basePrice: 1500, duration: 45 },
  { code: "ODO_CORONA",       name: "Corona dental",              category: "dental", basePrice: 4500, duration: 60 },
  { code: "ODO_ENDODONCIA",   name: "Endodoncia",                 category: "dental", basePrice: 4000, duration: 90 },
  { code: "ODO_IMPLANTE",     name: "Implante dental",            category: "dental", basePrice: 18000, duration: 120 },
  { code: "ODO_EXTRACCION",   name: "Extracción dental",          category: "dental", basePrice: 1200, duration: 30 },
  { code: "ODO_LIMPIEZA",     name: "Limpieza profilaxis",        category: "dental", basePrice: 800, duration: 30 },
  { code: "ODO_BLANQUEAMIENTO", name: "Blanqueamiento",           category: "dental", basePrice: 3500, duration: 60 },
];

/** Mapping conditionId → código del catálogo facturable. Los diagnósticos
 *  (caries, …) y los ~37 hallazgos nuevos no facturan (devuelven null). Sale
 *  de LA lista compartida con el plan (`CONDICIONES_CLINICAS`, ws1-t5). Desde
 *  el 21-oct (decisión 6 de Rafael) «Ausente» NO se cobra: un diente que ya
 *  faltaba no es una extracción hecha hoy. Solo «Extracción realizada»
 *  (`ext_done`) propone «Extracción dental». */
const CONDITION_TREATMENT_CODE: Record<string, string> = cobrosAlMarcar();

/** conditionId → código del catálogo. null = no facturable. */
export function conditionToTreatmentCode(conditionId: string): string | null {
  return CONDITION_TREATMENT_CODE[conditionId] ?? null;
}

/** Garantiza que la clínica tenga el catálogo dental sembrado. Idempotente. */
export async function ensureDentalCatalog(clinicId: string): Promise<void> {
  const existing = await prisma.procedureCatalog.findMany({
    where: { clinicId, code: { in: DENTAL_CATALOG_SEED.map((s) => s.code) } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((p) => p.code));
  const toCreate = DENTAL_CATALOG_SEED.filter((s) => !existingCodes.has(s.code));
  if (toCreate.length === 0) return;
  await prisma.procedureCatalog.createMany({
    data: toCreate.map((s) => ({
      clinicId,
      code: s.code,
      name: s.name,
      category: s.category,
      basePrice: s.basePrice,
      duration: s.duration ?? null,
    })),
    skipDuplicates: true,
  });
}

/**
 * Mapea cambios → tratamientos sugeridos cruzando con el catálogo de la
 * clínica. Solo las condiciones AÑADIDAS y facturables generan sugerencia;
 * quitar una marca nunca factura. Si el código no existe en el catálogo
 * (e.g. clínica eliminó la fila), procedureCatalogId queda null y unitPrice
 * cae al precio default del seed.
 */
export async function changesToTreatments(
  changes: SnapshotChange[],
  clinicId: string,
): Promise<SuggestedTreatment[]> {
  const catalog = await prisma.procedureCatalog.findMany({
    where: { clinicId, isActive: true, category: "dental" },
    select: { id: true, code: true, name: true, basePrice: true },
  });
  const byCode = new Map(catalog.filter((c) => c.code).map((c) => [c.code!, c]));
  const seedByCode = new Map(DENTAL_CATALOG_SEED.map((s) => [s.code, s]));

  const out: SuggestedTreatment[] = [];
  for (const ch of changes) {
    if (ch.type !== "added") continue;
    // Rojo = por hacer (aún no se hizo) y previo = lo hizo otra clínica: ninguno es trabajo de hoy (ws1-t6).
    if (ch.estado === "por_hacer" || ch.estado === "previo") continue;
    const code = conditionToTreatmentCode(ch.conditionId);
    if (!code) continue;
    const cat = byCode.get(code);
    const seed = seedByCode.get(code);
    if (!cat && !seed) continue;
    out.push({
      code,
      name: cat?.name ?? seed?.name ?? code,
      toothNumber: ch.toothNumber,
      surface: ch.surface,
      unitPrice: cat?.basePrice ?? seed?.basePrice ?? 0,
      procedureCatalogId: cat?.id ?? null,
    });
  }
  return out;
}

/** Crea (o actualiza si ya existe por appointmentId) el snapshot. */
export async function createOrUpdateSnapshot(
  patientId: string,
  appointmentId: string,
  entries: SnapshotEntry[],
): Promise<{ id: string }> {
  const existing = await prisma.odontogramSnapshot.findUnique({
    where: { appointmentId },
    select: { id: true },
  });
  if (existing) {
    const updated = await prisma.odontogramSnapshot.update({
      where: { id: existing.id },
      data: { entries: entries as unknown as Prisma.InputJsonValue, snapshotAt: new Date() },
      select: { id: true },
    });
    return { id: updated.id };
  }
  const created = await prisma.odontogramSnapshot.create({
    data: {
      patientId,
      appointmentId,
      entries: entries as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/* ─────── Snapshot anterior (con compat legacy `state`) ─────── */

/** Migración de los snapshots viejos: el JSON guardaba `state` (8 enum). */
const LEGACY_STATE_TO_CONDITION: Record<string, string> = {
  CARIES: "caries",
  RESINA: "restoration",
  CORONA: "crown",
  ENDODONCIA: "rct",
  IMPLANTE: "implant",
  AUSENTE: "missing",
  EXTRACCION: "ext_done",
};

/**
 * Normaliza una entry de snapshot: soporta el formato nuevo (con conditionId)
 * y el legacy (con `state`). Descarta SANO y la nota por diente para que el
 * diff/facturación no las trate como hallazgos.
 */
function normalizeSnapshotEntry(e: Record<string, unknown>): SnapshotEntry | null {
  const toothNumber = Number(e.toothNumber);
  const surface = (e.surface ?? null) as SurfaceKey | null;
  let conditionId = typeof e.conditionId === "string" ? e.conditionId : null;
  if (!conditionId && typeof e.state === "string") {
    conditionId = LEGACY_STATE_TO_CONDITION[e.state] ?? e.state.toLowerCase();
  }
  if (!conditionId || conditionId === "sano" || conditionId === NOTE_CONDITION) {
    return null;
  }
  return {
    toothNumber, surface, conditionId, notes: (e.notes ?? null) as string | null,
    ...(esEstadoMarca(e.estado) ? { estado: e.estado } : {}),
  };
}

/**
 * La base contra la que «Completar consulta» compara para proponer cobros
 * («Tratamientos detectados»): la foto de la consulta anterior MÁS lo que el
 * plan de tratamiento ya resolvió desde entonces (ws1-t5 · P7): lo que «hecho»
 * puso o cubre (lo cobra la nota del plan) y lo que un «deshacer» devolvió (ya
 * estaba antes). Así nada de eso aparece como «added» ni se propone cobrar.
 * Sin foto anterior y sin nada del plan devuelve null (primera consulta: lo de
 * siempre); sin foto pero CON algo del plan, devuelve solo eso (la ruta compara
 * contra ello en vez de tomar todo como nuevo).
 *
 * Si no puede leer lo del plan, LANZA: la ruta lo atrapa y esa vez no propone
 * nada, en vez de proponer cobros que pueden estar repetidos.
 */
export async function findPreviousSnapshot(
  patientId: string,
  beforeDate: Date,
  excludeAppointmentId?: string,
): Promise<SnapshotEntry[] | null> {
  const anterior = await fotoAnterior(patientId, beforeDate, excludeAppointmentId);
  const delPlan = await marcasQueNoSeCobran(patientId, anterior?.snapshotAt ?? null);
  if (delPlan.length === 0) return anterior?.entries ?? null;
  const base = anterior?.entries ?? [];
  const ya = new Set(base.map(keyOf));
  const extra: SnapshotEntry[] = [];
  for (const e of delPlan) {
    if (ya.has(keyOf(e))) continue;
    ya.add(keyOf(e));
    extra.push({ ...e, notes: null });
  }
  return [...base, ...extra];
}

/** La foto de la consulta inmediatamente anterior a una fecha dada, con su fecha. */
async function fotoAnterior(
  patientId: string,
  beforeDate: Date,
  excludeAppointmentId?: string,
): Promise<{ entries: SnapshotEntry[]; snapshotAt: Date } | null> {
  const prev = await prisma.odontogramSnapshot.findFirst({
    where: {
      patientId,
      snapshotAt: { lt: beforeDate },
      ...(excludeAppointmentId ? { appointmentId: { not: excludeAppointmentId } } : {}),
    },
    orderBy: { snapshotAt: "desc" },
    select: { entries: true, snapshotAt: true },
  });
  if (!prev) return null;
  const raw = (prev.entries as unknown as Record<string, unknown>[]) ?? [];
  return {
    entries: raw.map(normalizeSnapshotEntry).filter((e): e is SnapshotEntry => e !== null),
    snapshotAt: prev.snapshotAt,
  };
}
