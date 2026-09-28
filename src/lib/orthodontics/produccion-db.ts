// ═══════════════════════════════════════════════════════════════════════════
// CARGADOR de la producción de ortodoncia (ws1-t5, ronda 6 — filas 88, 89 y
// 90). El I/O que alimenta `produccion.ts` (puro).
//
// Qué facturas son «de un caso»:
//   1. la factura del tratamiento (`orthodontic_treatment_plans.invoiceId`): el
//      plan a plazos, o la colocación/enganche en modo «pago por control»;
//   2. las que se ligaron al caso por `invoices.orthodonticTreatmentPlanId`
//      (sql/ortodoncia-cobro.sql): cada control cobrado en modo «pago por
//      control» y los extras (retenedor, reposición de bracket…).
// Antes solo contaba la primera: una clínica que cobra por control veía en
// «Producción del mes» la colocación y nada más.
//
// `clinicId` SIEMPRE de la sesión. Todo filtra por él, también el SQL crudo
// (primer valor de la consulta). Solo LEE. Tolera que la columna de (2) o la
// bitácora no estén: se queda con lo que sí pudo leer, sin tumbar la pantalla.
// Tres consultas como mucho por llamada, en fila (regla del pooler).
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ORTHO_AUDIT_ACTIONS } from "@/app/actions/orthodontics/audit-actions";
import {
  cambioDeDoctorDesdeBitacora,
  type CambioDeDoctor,
  type PagoDeCaso,
} from "./produccion";

export interface CasoParaProduccion {
  planId: string;
  /** `orthodontic_treatment_plans.invoiceId`. */
  invoiceId: string | null;
  treatingDoctorId: string | null;
}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022" || code === "P2010";
}

/** Trozos de 500 ids: un `IN (...)` de miles de valores es lento y, en el límite, revienta. */
function enTrozos<T>(lista: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/**
 * Las facturas ligadas a cada caso por `invoices.orthodonticTreatmentPlanId`
 * (controles cobrados y extras). Sin la columna, o si la consulta falla,
 * devuelve un mapa vacío: la producción sale solo con la factura del
 * tratamiento, como antes.
 */
async function facturasLigadas(clinicId: string, planIds: string[]): Promise<Map<string, string>> {
  const planPorFactura = new Map<string, string>();
  if (!clinicId || planIds.length === 0) return planPorFactura;
  try {
    for (const trozo of enTrozos(planIds)) {
      const filas = await prisma.$queryRaw<{ planId: string; invoiceId: string; status: string }[]>`
        SELECT i."orthodonticTreatmentPlanId" AS "planId", i."id" AS "invoiceId", i."status"
          FROM "invoices" i
         WHERE i."clinicId" = ${clinicId}
           AND i."orthodonticTreatmentPlanId" IN (${Prisma.join(trozo)})`;
      for (const f of filas) {
        if (f.status === "CANCELLED" || !f.planId || !f.invoiceId) continue;
        planPorFactura.set(f.invoiceId, f.planId);
      }
    }
  } catch (e) {
    if (!esRelacionAusente(e)) console.warn("[ortodoncia:produccion] no se pudieron leer las facturas ligadas:", e);
    return new Map();
  }
  return planPorFactura;
}

/**
 * Todos los movimientos de dinero (cobros y reembolsos) de las facturas de
 * esos casos, con `paidAt` dentro de `[desde, hasta)`. Fuera los de facturas
 * canceladas, igual que `revenuePaymentWhere` (src/lib/caja.ts).
 */
export async function cargarPagosDeCasos(
  clinicId: string,
  casos: CasoParaProduccion[],
  rango: { desde: Date; hasta: Date },
): Promise<PagoDeCaso[]> {
  if (!clinicId || casos.length === 0) return [];

  const planPorFactura = await facturasLigadas(clinicId, casos.map((c) => c.planId));
  // La factura del tratamiento manda: si además está ligada por la columna, es la misma factura y el mismo caso.
  for (const c of casos) if (c.invoiceId) planPorFactura.set(c.invoiceId, c.planId);
  if (planPorFactura.size === 0) return [];

  const pagos: PagoDeCaso[] = [];
  for (const trozo of enTrozos(Array.from(planPorFactura.keys()))) {
    const filas = await prisma.payment.findMany({
      where: {
        invoiceId: { in: trozo },
        paidAt: { gte: rango.desde, lt: rango.hasta },
        invoice: { clinicId, status: { notIn: ["CANCELLED"] } },
      },
      select: { invoiceId: true, amount: true, method: true, paidAt: true },
    });
    for (const f of filas) {
      const planId = planPorFactura.get(f.invoiceId);
      if (!planId) continue;
      pagos.push({ planId, invoiceId: f.invoiceId, amount: Number(f.amount) || 0, method: f.method ?? null, paidAt: f.paidAt });
    }
  }
  return pagos;
}

/**
 * Las reasignaciones de doctor tratante de esos casos desde `desde` (las
 * anteriores no cambian a quién se atribuye un pago posterior a `desde`).
 * Sin bitácora legible devuelve lista vacía: todo se atribuye al doctor actual.
 */
export async function cargarCambiosDeDoctor(
  clinicId: string,
  planIds: string[],
  desde: Date,
): Promise<CambioDeDoctor[]> {
  if (!clinicId || planIds.length === 0) return [];
  try {
    const cambios: CambioDeDoctor[] = [];
    for (const trozo of enTrozos(planIds)) {
      const filas = await prisma.auditLog.findMany({
        where: {
          clinicId,
          entityType: "OrthodonticTreatmentPlan",
          entityId: { in: trozo },
          action: { in: [ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED, ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_STATUS_CHANGED] },
          createdAt: { gte: desde },
        },
        select: { entityId: true, createdAt: true, changes: true },
        orderBy: { createdAt: "asc" },
        take: 2000,
      });
      for (const f of filas) {
        const c = cambioDeDoctorDesdeBitacora(f);
        if (c) cambios.push(c);
      }
    }
    return cambios;
  } catch (e) {
    console.warn("[ortodoncia:produccion] no se pudo leer el historial de doctor tratante:", e);
    return [];
  }
}

/** Nombre de cada doctor por id, solo de usuarios de ESTA clínica. */
export async function cargarNombresDeDoctores(clinicId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!clinicId || unicos.length === 0) return new Map();
  const usuarios = await prisma.user.findMany({
    where: { clinicId, id: { in: unicos } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(usuarios.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "—"]));
}
