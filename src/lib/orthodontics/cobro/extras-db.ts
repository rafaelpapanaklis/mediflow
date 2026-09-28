// ═══════════════════════════════════════════════════════════════════════════
// Extras del caso (F5): facturas APARTE de la mensualidad — reposición de
// bracket, retenedores, microtornillo… — con conceptos del catálogo de la
// clínica. La factura la crea el editor de facturas de siempre (POST
// /api/invoices, sin tocarlo); aquí solo se LIGA de vuelta al caso, por
// `invoices.orthodonticTreatmentPlanId` (sql/ortodoncia-cobro.sql).
//
// SQL crudo + sonda `to_regclass`: sin la columna aplicada, un extra se
// crea igual (es una factura normal) pero no aparece listado bajo el caso.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";

export interface ExtraDelCaso {
  invoiceId: string;
  invoiceNumber: string | null;
  total: number;
  paid: number;
  status: string;
  createdAt: string;
}

let columna: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function columnaExiste(): Promise<boolean> {
  const t = Date.now();
  if (columna && (columna.existe || t - columna.at < TTL_MS)) return columna.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'invoices' AND column_name = 'orthodonticTreatmentPlanId'
      ) AS existe`;
    columna = { existe: filas[0]?.existe === true, at: t };
    return columna.existe;
  } catch (e) {
    console.warn("[ortodoncia:extras] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la columna. */
export function _olvidarColumnaExtras(): void {
  columna = null;
}

/** Liga una factura ya creada (POST /api/invoices) de vuelta al caso. */
export async function vincularExtraAlCaso(args: {
  invoiceId: string;
  treatmentPlanId: string;
  clinicId: string;
}): Promise<{ ok: boolean; sinColumna: boolean }> {
  const { invoiceId, treatmentPlanId, clinicId } = args;
  if (!invoiceId || !treatmentPlanId || !clinicId) return { ok: false, sinColumna: false };
  if (!(await columnaExiste())) return { ok: false, sinColumna: true };
  try {
    const filas = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "invoices"
         SET "orthodonticTreatmentPlanId" = ${treatmentPlanId}
       WHERE "id" = ${invoiceId} AND "clinicId" = ${clinicId}
       RETURNING "id"`;
    return { ok: filas.length > 0, sinColumna: false };
  } catch (e) {
    console.warn("[ortodoncia:extras] no se pudo vincular:", e);
    return { ok: false, sinColumna: false };
  }
}

/** Los extras ya cobrados (o pendientes) de un caso, más recientes primero. */
export async function listarExtrasDelCaso(treatmentPlanId: string, clinicId: string): Promise<ExtraDelCaso[]> {
  if (!treatmentPlanId || !clinicId) return [];
  if (!(await columnaExiste())) return [];
  try {
    const filas = await prisma.$queryRaw<
      { id: string; invoiceNumber: string | null; total: unknown; paid: unknown; status: string; createdAt: Date }[]
    >`
      SELECT "id", "invoiceNumber", "total", "paid", "status", "createdAt"
        FROM "invoices"
       WHERE "orthodonticTreatmentPlanId" = ${treatmentPlanId} AND "clinicId" = ${clinicId}
       ORDER BY "createdAt" DESC
       LIMIT 50`;
    return filas.map((f) => ({
      invoiceId: f.id,
      invoiceNumber: f.invoiceNumber,
      total: Number(f.total) || 0,
      paid: Number(f.paid) || 0,
      status: f.status,
      createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
    }));
  } catch (e) {
    console.warn("[ortodoncia:extras] no se pudo listar:", e);
    return [];
  }
}
