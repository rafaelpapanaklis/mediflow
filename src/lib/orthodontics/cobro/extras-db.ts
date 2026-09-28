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

import { Prisma } from "@prisma/client";
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

/** Los estados de una factura de extra que todavía se debe. */
const ESTADOS_QUE_DEBEN = ["PENDING", "PARTIAL", "OVERDUE"];

export interface ExtrasPendientes {
  /** Lo que falta por cobrar de los extras de UN caso, en pesos. */
  monto: number;
  cantidad: number;
}

/**
 * ws1-t4 #80 — lo que cada caso debe en EXTRAS (reposición de bracket,
 * retenedores…), en UNA consulta para todos. La cobranza del caso mira solo las
 * mensualidades: un caso con un extra de $350 sin pagar salía «Al corriente».
 * Sin la columna, o si la consulta falla: vacío (lo de antes), nunca lanza.
 */
export async function extrasPendientesPorCasos(clinicId: string, treatmentPlanIds: string[]): Promise<Map<string, ExtrasPendientes>> {
  const out = new Map<string, ExtrasPendientes>();
  if (!clinicId || treatmentPlanIds.length === 0) return out;
  if (!(await columnaExiste())) return out;
  try {
    const filas = await prisma.$queryRaw<{ plan: string; total: unknown; paid: unknown }[]>`
      SELECT "orthodonticTreatmentPlanId" AS plan, "total", "paid"
        FROM "invoices"
       WHERE "clinicId" = ${clinicId}
         AND "orthodonticTreatmentPlanId" IN (${Prisma.join(treatmentPlanIds)})
         AND "status" IN (${Prisma.join(ESTADOS_QUE_DEBEN)})`;
    for (const f of filas) {
      const falta = Math.max(0, Math.round(((Number(f.total) || 0) - (Number(f.paid) || 0)) * 100)) / 100;
      if (falta <= 0) continue;
      const previo = out.get(f.plan) ?? { monto: 0, cantidad: 0 };
      out.set(f.plan, { monto: Math.round((previo.monto + falta) * 100) / 100, cantidad: previo.cantidad + 1 });
    }
  } catch (e) {
    console.warn("[ortodoncia:extras] no se pudieron leer los extras pendientes:", e);
  }
  return out;
}
