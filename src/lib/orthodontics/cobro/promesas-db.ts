// ═══════════════════════════════════════════════════════════════════════════
// Promesas de pago (F12): "el papá dice 'pago el viernes'" — se anota fecha y
// monto, y recepción la revisa desde la lista de vencidas al día siguiente.
// No hay recordatorio automático (eso es W-block, portal/WhatsApp, fuera del
// bloque de Cobro): esto es SOLO el registro y la lista visible.
//
// Tabla `orthodontic_payment_promises` (sql/ortodoncia-cobro.sql). SQL crudo
// + sonda `to_regclass`: sin el SQL aplicado, no se puede crear una promesa
// (se avisa) pero nada más se rompe.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export interface PromesaDePago {
  id: string;
  amount: number;
  promisedDate: string;
  note: string | null;
  createdAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
}

let tabla: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function tablaExiste(): Promise<boolean> {
  const t = Date.now();
  if (tabla && (tabla.existe || t - tabla.at < TTL_MS)) return tabla.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.orthodontic_payment_promises') IS NOT NULL AS existe`;
    tabla = { existe: filas[0]?.existe === true, at: t };
    return tabla.existe;
  } catch (e) {
    console.warn("[ortodoncia:promesas] no se pudo comprobar la tabla:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la tabla. */
export function _olvidarTablaPromesas(): void {
  tabla = null;
}

interface Fila {
  id: string;
  amount: unknown;
  promisedDate: Date;
  note: string | null;
  createdAt: Date;
  fulfilledAt: Date | null;
  cancelledAt: Date | null;
}

function fechaSolo(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function deFila(f: Fila): PromesaDePago {
  return {
    id: f.id,
    amount: Number(f.amount) || 0,
    promisedDate: fechaSolo(f.promisedDate),
    note: f.note,
    createdAt: f.createdAt.toISOString(),
    fulfilledAt: f.fulfilledAt ? f.fulfilledAt.toISOString() : null,
    cancelledAt: f.cancelledAt ? f.cancelledAt.toISOString() : null,
  };
}

/** Las promesas del caso, más recientes primero. */
export async function listarPromesasDelCaso(treatmentPlanId: string, clinicId: string): Promise<PromesaDePago[]> {
  if (!treatmentPlanId || !clinicId) return [];
  if (!(await tablaExiste())) return [];
  try {
    const filas = await prisma.$queryRaw<Fila[]>`
      SELECT "id", "amount", "promisedDate", "note", "createdAt", "fulfilledAt", "cancelledAt"
        FROM "orthodontic_payment_promises"
       WHERE "treatmentPlanId" = ${treatmentPlanId} AND "clinicId" = ${clinicId}
       ORDER BY "createdAt" DESC
       LIMIT 50`;
    return filas.map(deFila);
  } catch (e) {
    console.warn("[ortodoncia:promesas] no se pudo listar:", e);
    return [];
  }
}

export interface CrearPromesaResultado {
  ok: boolean;
  sinTabla: boolean;
  promesa: PromesaDePago | null;
}

export async function crearPromesaDePago(args: {
  treatmentPlanId: string;
  clinicId: string;
  amount: number;
  promisedDate: string;
  note: string | null;
  createdByUserId: string | null;
}): Promise<CrearPromesaResultado> {
  const { treatmentPlanId, clinicId, amount, promisedDate, note, createdByUserId } = args;
  if (!treatmentPlanId || !clinicId || !(amount > 0) || !promisedDate) return { ok: false, sinTabla: false, promesa: null };
  if (!(await tablaExiste())) return { ok: false, sinTabla: true, promesa: null };
  try {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "orthodontic_payment_promises"
        ("id", "treatmentPlanId", "clinicId", "amount", "promisedDate", "note", "createdByUserId")
      VALUES
        (${id}, ${treatmentPlanId}, ${clinicId}, ${amount}::numeric, ${promisedDate}::date, ${note}, ${createdByUserId})`;
    return {
      ok: true,
      sinTabla: false,
      promesa: { id, amount, promisedDate, note, createdAt: new Date().toISOString(), fulfilledAt: null, cancelledAt: null },
    };
  } catch (e) {
    console.warn("[ortodoncia:promesas] no se pudo crear:", e);
    return { ok: false, sinTabla: false, promesa: null };
  }
}

/** Marca una promesa como cumplida o cancelada. Nunca sobre una ya resuelta. */
export async function resolverPromesaDePago(args: {
  id: string;
  clinicId: string;
  resultado: "cumplida" | "cancelada";
}): Promise<{ ok: boolean; sinTabla: boolean }> {
  const { id, clinicId, resultado } = args;
  if (!id || !clinicId) return { ok: false, sinTabla: false };
  if (!(await tablaExiste())) return { ok: false, sinTabla: true };
  try {
    const filas = resultado === "cumplida"
      ? await prisma.$queryRaw<{ id: string }[]>`
          UPDATE "orthodontic_payment_promises" SET "fulfilledAt" = CURRENT_TIMESTAMP
           WHERE "id" = ${id} AND "clinicId" = ${clinicId} AND "fulfilledAt" IS NULL AND "cancelledAt" IS NULL
           RETURNING "id"`
      : await prisma.$queryRaw<{ id: string }[]>`
          UPDATE "orthodontic_payment_promises" SET "cancelledAt" = CURRENT_TIMESTAMP
           WHERE "id" = ${id} AND "clinicId" = ${clinicId} AND "fulfilledAt" IS NULL AND "cancelledAt" IS NULL
           RETURNING "id"`;
    return { ok: filas.length > 0, sinTabla: false };
  } catch (e) {
    console.warn("[ortodoncia:promesas] no se pudo resolver:", e);
    return { ok: false, sinTabla: false };
  }
}
