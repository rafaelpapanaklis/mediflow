import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/* ─────── Tipos ───────────────────────────────────────────── */

export type ToothState =
  | "SANO" | "CARIES" | "RESINA" | "CORONA"
  | "ENDODONCIA" | "IMPLANTE" | "AUSENTE" | "EXTRACCION";

export type SurfaceKey = "M" | "D" | "V" | "L" | "O";

export interface SnapshotEntry {
  toothNumber: number;
  /** null = estado a nivel diente completo. */
  surface: SurfaceKey | null;
  state: ToothState;
  notes?: string | null;
}

export interface SnapshotChange {
  toothNumber: number;
  surface: SurfaceKey | null;
  prevState: ToothState | null; // null si no existía antes
  newState: ToothState;
}

export interface SuggestedTreatment {
  code: string;
  name: string;
  toothNumber: number;
  surface: SurfaceKey | null;
  unitPrice: number;
  procedureCatalogId: string | null;
}

/* ─────── Lectura del estado vigente ───────────────────────── */

/** Lee odontogram_entries del paciente y devuelve array serializable. */
export async function readCurrentEntries(patientId: string): Promise<SnapshotEntry[]> {
  const rows = await prisma.odontogramEntry.findMany({
    where: { patientId },
    orderBy: [{ toothNumber: "asc" }, { surface: "asc" }],
    select: {
      toothNumber: true,
      surface: true,
      state: true,
      notes: true,
    },
  });
  return rows.map((r) => ({
    toothNumber: r.toothNumber,
    surface: (r.surface ?? null) as SurfaceKey | null,
    state: r.state as ToothState,
    notes: r.notes,
  }));
}

/* ─────── Diff entre snapshots ─────────────────────────────── */

function keyOf(e: { toothNumber: number; surface: SurfaceKey | null }): string {
  return `${e.toothNumber}:${e.surface ?? "_"}`;
}

/**
 * Compara dos sets de entries y devuelve los cambios.
 * Una entry "borrada" (estaba antes y ya no) cuenta como vuelta a SANO.
 * Una entry "nueva" (no estaba antes) tiene prevState=null.
 */
export function diffSnapshots(prev: SnapshotEntry[], curr: SnapshotEntry[]): SnapshotChange[] {
  const prevMap = new Map(prev.map((e) => [keyOf(e), e]));
  const currMap = new Map(curr.map((e) => [keyOf(e), e]));
  const changes: SnapshotChange[] = [];

  // Entries en curr (nuevas o cambiadas).
  currMap.forEach((c, k) => {
    const p = prevMap.get(k);
    if (!p) {
      changes.push({
        toothNumber: c.toothNumber, surface: c.surface,
        prevState: null, newState: c.state,
      });
    } else if (p.state !== c.state) {
      changes.push({
        toothNumber: c.toothNumber, surface: c.surface,
        prevState: p.state, newState: c.state,
      });
    }
  });

  // Entries que estaban antes y ya no (vuelta a SANO).
  prevMap.forEach((p, k) => {
    if (!currMap.has(k)) {
      changes.push({
        toothNumber: p.toothNumber, surface: p.surface,
        prevState: p.state, newState: "SANO",
      });
    }
  });

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

/** Mapping estado → código del catálogo. null = no facturable. */
export function stateToTreatmentCode(change: SnapshotChange): string | null {
  const { prevState, newState } = change;
  // Diagnósticos (no facturables): aparecer/quitar caries.
  if (newState === "CARIES" && prevState !== "RESINA") return null;
  if (newState === "SANO") return null; // undo / corrección de marca

  if (newState === "RESINA" && prevState === "CARIES") return "ODO_RESINA";
  if (newState === "RESINA" && prevState !== "CARIES") return "ODO_RESINA";
  if (newState === "CORONA") return "ODO_CORONA";
  if (newState === "ENDODONCIA") return "ODO_ENDODONCIA";
  if (newState === "IMPLANTE") return "ODO_IMPLANTE";
  if (newState === "AUSENTE") return "ODO_EXTRACCION";
  if (newState === "EXTRACCION") return "ODO_EXTRACCION";
  return null;
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
 * clínica. Cambios sin código mapeable se ignoran. Si el código no existe
 * en el catálogo (e.g. clínica eliminó la fila), procedureCatalogId queda
 * null y unitPrice cae al precio default del seed.
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
    const code = stateToTreatmentCode(ch);
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
  return prev.entries as unknown as SnapshotEntry[];
}
