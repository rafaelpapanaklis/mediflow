import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/* ─────── Tipos ───────────────────────────────────────────── */

export type SurfaceKey = "M" | "D" | "V" | "L" | "O";

export interface SnapshotEntry {
  toothNumber: number;
  /** null = condición a nivel diente completo. */
  surface: SurfaceKey | null;
  /** id del catálogo de hallazgos (caries, restoration, crown, rct, …). */
  conditionId: string;
  notes?: string | null;
}

export interface SnapshotChange {
  toothNumber: number;
  surface: SurfaceKey | null;
  conditionId: string;
  /** "added" = condición nueva vs. el snapshot anterior; "removed" = ya no está. */
  type: "added" | "removed";
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

/** Lee odontogram_entries del paciente (excluye la nota por diente). */
export async function readCurrentEntries(patientId: string): Promise<SnapshotEntry[]> {
  const rows = await prisma.odontogramEntry.findMany({
    where: { patientId, conditionId: { not: NOTE_CONDITION } },
    orderBy: [{ toothNumber: "asc" }, { surface: "asc" }],
    select: {
      toothNumber: true,
      surface: true,
      conditionId: true,
      notes: true,
    },
  });
  return rows.map((r) => ({
    toothNumber: r.toothNumber,
    surface: (r.surface ?? null) as SurfaceKey | null,
    conditionId: r.conditionId,
    notes: r.notes,
  }));
}

/* ─────── Diff entre snapshots ─────────────────────────────── */

function keyOf(e: {
  toothNumber: number;
  surface: SurfaceKey | null;
  conditionId: string;
}): string {
  return `${e.toothNumber}:${e.surface ?? "_"}:${e.conditionId}`;
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
      });
    }
  }
  for (const p of prev) {
    if (!currKeys.has(keyOf(p))) {
      changes.push({
        toothNumber: p.toothNumber, surface: p.surface,
        conditionId: p.conditionId, type: "removed",
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
 *  (caries, …) y los ~37 hallazgos nuevos no facturan (devuelven null). */
const CONDITION_TREATMENT_CODE: Record<string, string> = {
  restoration: "ODO_RESINA",
  crown: "ODO_CORONA",
  rct: "ODO_ENDODONCIA",
  implant: "ODO_IMPLANTE",
  missing: "ODO_EXTRACCION",
  ext_done: "ODO_EXTRACCION",
};

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
  return { toothNumber, surface, conditionId, notes: (e.notes ?? null) as string | null };
}

/** Busca el snapshot inmediatamente anterior a una fecha dada. */
export async function findPreviousSnapshot(
  patientId: string,
  beforeDate: Date,
  excludeAppointmentId?: string,
): Promise<SnapshotEntry[] | null> {
  const prev = await prisma.odontogramSnapshot.findFirst({
    where: {
      patientId,
      snapshotAt: { lt: beforeDate },
      ...(excludeAppointmentId ? { appointmentId: { not: excludeAppointmentId } } : {}),
    },
    orderBy: { snapshotAt: "desc" },
    select: { entries: true },
  });
  if (!prev) return null;
  const raw = (prev.entries as unknown as Record<string, unknown>[]) ?? [];
  return raw
    .map(normalizeSnapshotEntry)
    .filter((e): e is SnapshotEntry => e !== null);
}
