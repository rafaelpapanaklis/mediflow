// «Guardar y presentar» (ws1-t12 · P4): el plan ES el presupuesto (decisión de Rafael, 20-oct-2026).
//
// Del plan sale su presupuesto —los mismos conceptos, con el precio EXACTO de cada fila— y se
// presenta: liga pública de firma de siempre (`/presupuesto/[token]`, `presentQuote`) y su PDF de
// siempre (`/api/quotes/[id]/pdf`). Sin abrir el editor del presupuesto ni volver a capturar.
//
//  · Sin presupuesto vivo → se crea (`createQuoteWithFolio`) y, si se pide, se presenta.
//  · Con uno en BORRADOR o PRESENTADO y sin factura ligada → si las filas cambiaron, se reescriben sus
//    conceptos (`replaceQuoteContent`, la misma liga y el mismo folio; su descuento se conserva) y se
//    presenta. El paciente que ya tenía la liga ve el plan de hoy.
//  · ACEPTADO (o con factura ligada) → no se toca: lo firmado es un hecho. Lo que crezca el plan va a
//    su nota de cobro (cobro.server.ts).
// Cada concepto queda anotado en su fila (`quoteItemId`): así al aceptarlo se sabe qué fila se aceptó.
//
// clinicId y userId SIEMPRE de la sesión de quien llama; el plan ya lo cargó la ruta con su scope.

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { armarPresupuestoDePlan, ESTADOS_QUE_YA_CUENTAN, type ConceptoDePlan } from "@/lib/quotes/desde-plan";
import { createQuoteWithFolio, parseValidUntil, replaceQuoteContent } from "@/lib/quotes/service";
import { presentQuote } from "@/lib/quotes/present";
import { repoFilas } from "./items-db";
import { leerPlan } from "./leer-plan";

export interface PlanParaPresentar {
  id: string;
  patientId: string;
  name: string;
  description: string | null;
  totalCost: unknown;
}

export interface PresupuestoDelPlanDto {
  id: string;
  folio: string;
  status: string;
  total: number;
  title: string;
  /** Ruta de la liga pública de firma (la pantalla le antepone su origen). null si no está presentado. */
  liga: string | null;
}

export interface ResultadoPresentar {
  /** Ya existía un presupuesto vivo del plan. */
  already: boolean;
  /** Sus conceptos se reescribieron con las filas de hoy. */
  regenerado: boolean;
  presentado: boolean;
  quote: PresupuestoDelPlanDto;
  /** Por qué no se presentó (aceptado, factura ligada…), si se pidió presentar. */
  aviso: "ya_aceptado" | "factura_ligada" | null;
  /** El plan salió de sus filas (true) o de su texto (plan de antes). */
  deFilas: boolean;
  error?: { http: number; mensaje: string };
}

export async function tarifarioDeLaClinica(clinicId: string) {
  return prisma.procedureCatalog.findMany({
    where: { clinicId, isActive: true },
    select: { id: true, name: true, basePrice: true },
    take: 2000,
  });
}

/** Lo vivo del plan (borrador, presentado o aceptado), el más reciente. */
export async function presupuestoVivoDelPlan(clinicId: string, planId: string) {
  return prisma.quote.findFirst({
    where: { clinicId, treatmentPlanId: planId, status: { in: [...ESTADOS_QUE_YA_CUENTAN] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, folio: true, status: true, total: true, title: true, acceptToken: true, validUntil: true,
      invoiceId: true, discountPct: true, discountAmount: true, notes: true,
      items: { select: { name: true, toothFdi: true, quantity: true, unitPrice: true, discount: true, phase: true }, orderBy: { sortOrder: "asc" } },
    },
  });
}

const dto = (q: { id: string; folio: string; status: string; total: unknown; title: string; acceptToken?: string | null }): PresupuestoDelPlanDto => ({
  id: q.id,
  folio: q.folio,
  status: q.status,
  total: Number(q.total) || 0,
  title: q.title,
  liga: q.acceptToken && q.status !== "DRAFT" ? `/presupuesto/${q.acceptToken}` : null,
});

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** ¿Los conceptos del presupuesto ya son los de las filas? (nombre, dientes, cantidad, precio, fase) */
export function mismosConceptos(
  actuales: Array<{ name: string; toothFdi: string | null; quantity: unknown; unitPrice: unknown; discount?: unknown; phase?: unknown }>,
  nuevos: ConceptoDePlan[],
): boolean {
  if (actuales.length !== nuevos.length) return false;
  return actuales.every((a, i) => {
    const n = nuevos[i];
    return (
      a.name === n.name &&
      (a.toothFdi ?? null) === (n.toothFdi ?? null) &&
      Number(a.quantity) === n.quantity &&
      r2(a.unitPrice) === r2(n.unitPrice) &&
      r2(a.discount) === r2(n.discount ?? 0) &&
      (a.phase == null ? null : Number(a.phase)) === (n.phase ?? null)
    );
  });
}

/** Anota en cada fila el concepto que salió de ella (mismo orden: `sortOrder` = índice del concepto). */
async function ligarFilas(clinicId: string, planId: string, conceptos: ConceptoDePlan[], quoteId: string) {
  const items = await prisma.quoteItem.findMany({ where: { quoteId }, select: { id: true }, orderBy: { sortOrder: "asc" } });
  if (items.length !== conceptos.length) return; // el saneo quitó algo: sin liga (el cobro reconoce por nombre)
  const ligas = conceptos
    .map((c, i) => (c.filaId ? { filaId: c.filaId, quoteItemId: items[i].id } : null))
    .filter((x): x is { filaId: string; quoteItemId: string } => !!x);
  await repoFilas.ligarAConceptos(prisma, { clinicId, planId, ligas });
}

/**
 * El presupuesto del plan, desde sus filas (o su texto, si es un plan de antes). `presentar`: además
 * lo presenta (liga de firma). Quien llama ya comprobó permisos, visibilidad y el scope del plan.
 */
export async function presupuestoDesdeElPlan(args: {
  clinicId: string;
  userId: string;
  plan: PlanParaPresentar;
  presentar: boolean;
}): Promise<ResultadoPresentar> {
  const { clinicId, userId, plan } = args;
  const leido = leerPlan(plan, await repoFilas.leer(clinicId, plan.id));
  const deFilas = leido.fuente === "filas";
  const armar = async () =>
    armarPresupuestoDePlan(
      { name: plan.name, description: plan.description, totalCost: Number(plan.totalCost) || 0 },
      await tarifarioDeLaClinica(clinicId),
      deFilas ? { renglones: leido.renglones } : { textoRedondeado: leido.textoRedondeado },
    );

  const existente = await presupuestoVivoDelPlan(clinicId, plan.id);
  if (existente && !args.presentar) {
    return { already: true, regenerado: false, presentado: existente.status === "PRESENTED", quote: dto(existente), aviso: null, deFilas };
  }

  if (existente) {
    if (existente.status === "ACCEPTED") {
      return { already: true, regenerado: false, presentado: false, quote: dto(existente), aviso: "ya_aceptado", deFilas };
    }
    let actual: { id: string; status: string; acceptToken: string | null; validUntil: Date | null; folio: string; total: unknown; title: string } = existente;
    let regenerado = false;
    if (deFilas) {
      const armado = await armar();
      if (!mismosConceptos(existente.items, armado.conceptos)) {
        if (existente.invoiceId) {
          return { already: true, regenerado: false, presentado: false, quote: dto(existente), aviso: "factura_ligada", deFilas };
        }
        // Con el presupuesto BLOQUEADO y releído: si el paciente lo firmó (o se facturó) en medio, no se
        // reescribe lo firmado — se contesta como aceptado. Mismo candado que aceptarPresupuesto.
        const q = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "quotes" WHERE id = ${existente.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
          const fresco = await tx.quote.findFirst({ where: { id: existente.id, clinicId }, select: { status: true, invoiceId: true } });
          if (!fresco || (fresco.status !== "DRAFT" && fresco.status !== "PRESENTED") || fresco.invoiceId) return null;
          return replaceQuoteContent({
            quoteId: existente.id,
            clinicId,
            title: existente.title,
            items: armado.conceptos,
            discountPct: existente.discountPct == null ? null : Number(existente.discountPct),
            discountAmount: existente.discountAmount == null ? null : Number(existente.discountAmount),
            validUntil: existente.validUntil ?? parseValidUntil(null),
            notes: existente.notes,
            tx,
          });
        });
        if (!q) return { already: true, regenerado: false, presentado: false, quote: dto(existente), aviso: "ya_aceptado", deFilas };
        await ligarFilas(clinicId, plan.id, armado.conceptos, q.id);
        await logAudit({
          patientId: plan.patientId,
          texto: `Actualizó el presupuesto ${existente.folio} con los procedimientos del plan de tratamiento «${plan.name}»`,
          clinicId, userId, entityType: "quote", entityId: existente.id, action: "update",
          changes: { total: { before: Number(existente.total), after: Number(q.total) }, desdePlan: { before: null, after: plan.id } },
        });
        actual = { ...actual, total: q.total };
        regenerado = true;
      }
    }
    if (actual.status === "PRESENTED") {
      return { already: true, regenerado, presentado: true, quote: dto(actual), aviso: null, deFilas };
    }
    const p = await presentQuote({ current: actual, clinicId, userId });
    if (!p.ok) return { already: true, regenerado, presentado: false, quote: dto(actual), aviso: null, deFilas, error: { http: p.httpStatus ?? 409, mensaje: p.error ?? "" } };
    return { already: true, regenerado, presentado: true, quote: dto(p.quote), aviso: null, deFilas };
  }

  const armado = await armar();
  const quote = await createQuoteWithFolio({
    clinicId,
    patientId: plan.patientId,
    createdById: userId,
    title: plan.name.trim().slice(0, 160) || "Presupuesto",
    items: armado.conceptos,
    validUntil: parseValidUntil(null),
    notes: null,
    treatmentPlanId: plan.id,
  });
  if (deFilas) await ligarFilas(clinicId, plan.id, armado.conceptos, quote.id);
  await logAudit({
    patientId: quote.patientId,
    texto: `Creó el presupuesto ${quote.folio} (borrador) desde el plan de tratamiento «${plan.name}»`,
    clinicId, userId, entityType: "quote", entityId: quote.id, action: "create",
    changes: {
      folio: { before: null, after: quote.folio },
      total: { before: null, after: Number(quote.total) },
      treatmentPlanId: { before: null, after: plan.id },
    },
  });
  if (!args.presentar) return { already: false, regenerado: false, presentado: false, quote: dto(quote), aviso: null, deFilas };
  const p = await presentQuote({ current: { id: quote.id, status: quote.status, acceptToken: quote.acceptToken, validUntil: quote.validUntil }, clinicId, userId });
  if (!p.ok) return { already: false, regenerado: false, presentado: false, quote: dto(quote), aviso: null, deFilas, error: { http: p.httpStatus ?? 409, mensaje: p.error ?? "" } };
  return { already: false, regenerado: false, presentado: true, quote: dto(p.quote), aviso: null, deFilas };
}
