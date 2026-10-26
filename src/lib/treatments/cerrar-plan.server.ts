// «Cerrar plan» — el ejecutor. Las decisiones están en `cerrar-plan.ts`.
//
// En UNA transacción, con el plan BLOQUEADO (FOR UPDATE, el mismo candado de «Aceptar el plan», «Cobrar
// hoy»→nota y borrar) y cada nota también (el candado de siempre de cobro/reembolso/cancelar):
//  1. cada nota viva del plan (`invoices."treatmentPlanId"`) se queda en lo hecho;
//  2. lo pagado de más pasa a SALDO A FAVOR con el trío de siempre (abono.server.ts, ortodoncia):
//     un Payment «refund» con `refundMethod = saldo_a_favor` (no sale dinero de caja, no resta ingresos)
//     + filas POSITIVAS en `patient_credits` que dicen de dónde vino cada peso;
//  3. las filas por hacer se cancelan (con quién y cuándo; ninguna se borra) y las hechas se reanotan
//     en su nueva línea;
//  4. el plan pasa a ABANDONED.
// Después, la bitácora: una fila por nota ajustada y una del plan, con el motivo.
//
// Una nota TIMBRADA entera (cfdiUuid) no se toca: sus conceptos ya están ante el SAT; se contesta
// `nota_timbrada` y no se cierra nada (se ajusta en Facturación). Toda consulta lleva el `clinicId` de
// la sesión de quien llama.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { round2 } from "@/lib/invoice-totals";
import { FUENTE_DEVUELTO, FUENTE_EXCEDENTE } from "@/lib/patient-credit-core";
import { anticipoDeLaFactura, partesDeDevolucion } from "@/lib/patient-credit-aplicar";
import { REEMBOLSO_A_SALDO_A_FAVOR } from "@/lib/dinero/reembolsos";
import { bloquearPlan, columnaNotaDelPlanExiste, tablaDeFilasExiste } from "./items-db";
import { ajustarNotaAlCerrar, origenDelSaldoAFavor } from "./cerrar-plan";
import type { EstadoDeFila } from "./items";
import type { FilaParaDeuda } from "./por-cobrar";

type Tx = Prisma.TransactionClient;

const dinero = (v: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);

export interface NotaCerrada {
  invoiceId: string;
  invoiceNumber: string;
  antes: { total: number; paid: number; status: string };
  despues: { total: number; paid: number; status: string };
  quitadas: Array<{ nombre: string; importe: number }>;
  aFavor: number;
}

export type ResultadoCierre =
  | {
      ok: true;
      /** `ya_cerrado`: el plan ya estaba cerrado (o terminado) y no había nada que ajustar; no se escribió nada. */
      estado: "cerrado" | "ya_cerrado";
      notas: NotaCerrada[];
      /** Filas por hacer que se cancelaron. */
      filasCanceladas: number;
      /** Total que quedó como saldo a favor del paciente. */
      saldoAFavor: number;
      /** Facturas de la vía de antes (presupuesto) con filas por hacer: esas se ajustan a mano. */
      sinAjustar: string[];
    }
  | { ok: false; codigo: "sin_plan" | "nota_timbrada"; folios?: string[] };

interface NotaSql {
  id: string;
  invoiceNumber: string;
  patientId: string;
  status: string;
  total: unknown;
  paid: unknown;
  discount: unknown;
  taxRate: unknown;
  taxIncluded: boolean | null;
  items: unknown;
  cfdiUuid: string | null;
  createdAt: Date | string;
  paidAt: Date | string | null;
}

interface FilaSql {
  id: string;
  estado: string;
  hechoEn: Date | string | null;
  nombre: string;
  invoiceId: string | null;
  invoiceLinea: number | null;
}

const fecha = (x: Date | string | null): Date | null => (x == null ? null : x instanceof Date ? x : new Date(x));

async function leerFilas(tx: Tx, clinicId: string, planId: string): Promise<FilaSql[]> {
  if (!(await tablaDeFilasExiste())) return [];
  return tx.$queryRaw<FilaSql[]>`
    SELECT "id", "estado", "hechoEn", "nombre", "invoiceId", "invoiceLinea"
      FROM "treatment_plan_items"
     WHERE "clinicId" = ${clinicId} AND "planId" = ${planId}`;
}

async function leerNotas(tx: Tx, clinicId: string, planId: string): Promise<NotaSql[]> {
  if (!(await columnaNotaDelPlanExiste())) return [];
  // Bloqueadas en orden de id: el mismo orden que el cobro con abono, sin abrazos mortales.
  return tx.$queryRaw<NotaSql[]>`
    SELECT "id", "invoiceNumber", "patientId", "status"::text AS "status", "total", "paid", "discount", "taxRate",
           "taxIncluded", "items", "cfdiUuid", "createdAt", "paidAt"
      FROM "invoices"
     WHERE "clinicId" = ${clinicId} AND "treatmentPlanId" = ${planId} AND "status"::text NOT IN ('CANCELLED', 'DRAFT')
     ORDER BY "id"
       FOR UPDATE`;
}

export async function cerrarPlan(args: { clinicId: string; planId: string; userId: string; motivo: string; ahora?: Date }): Promise<ResultadoCierre> {
  const { clinicId, planId, userId, motivo } = args;
  if (!clinicId || !planId) throw new Error("plan:cerrar: clinicId o planId ausente — se corta antes de consultar");
  const ahora = args.ahora ?? new Date();

  const plan = await prisma.treatmentPlan.findFirst({ where: { id: planId, clinicId }, select: { id: true, name: true, status: true, patientId: true } });
  if (!plan) return { ok: false, codigo: "sin_plan" };

  type Hecho = Extract<ResultadoCierre, { ok: true }> & { estadoAntes: string };
  const r: Hecho | Extract<ResultadoCierre, { ok: false }> = await prisma.$transaction(
    async (tx) => {
      if (!(await bloquearPlan(tx, clinicId, planId))) return { ok: false as const, codigo: "sin_plan" as const };
      const actual = await tx.treatmentPlan.findFirst({ where: { id: planId, clinicId }, select: { status: true } });
      const filasSql = await leerFilas(tx, clinicId, planId);
      const filas = new Map<string, FilaParaDeuda>(
        filasSql.map((f) => [f.id, {
          id: f.id, estado: f.estado as EstadoDeFila, hechoEn: fecha(f.hechoEn), nombre: f.nombre,
          invoiceId: f.invoiceId, invoiceLinea: f.invoiceLinea == null ? null : Number(f.invoiceLinea),
        }]),
      );
      const notasSql = await leerNotas(tx, clinicId, planId);

      const ajustes = notasSql
        .map((n) => ({
          n,
          a: ajustarNotaAlCerrar(
            {
              id: n.id, total: Number(n.total) || 0, paid: Number(n.paid) || 0, createdAt: fecha(n.createdAt) ?? ahora,
              items: n.items, discount: Number(n.discount) || 0, taxRate: n.taxRate == null ? null : Number(n.taxRate),
              taxIncluded: n.taxIncluded !== false,
            },
            filas,
          ),
        }))
        .filter((x) => x.a !== null);

      const timbradas = ajustes.filter((x) => !!x.n.cfdiUuid).map((x) => x.n.invoiceNumber);
      if (timbradas.length) return { ok: false as const, codigo: "nota_timbrada" as const, folios: timbradas };

      // Las filas por hacer: de una nota del plan (se ajusta) o sin nota. Las que cobra una factura de
      // la vía de antes (presupuesto) no se tocan: esa factura no es del plan y se ajusta a mano.
      const deNotas = new Set(notasSql.map((n) => n.id));
      const porHacer = filasSql.filter((f) => f.estado === "pendiente" || f.estado === "en_curso");
      const cancelables = porHacer.filter((f) => !f.invoiceId || deNotas.has(f.invoiceId));
      const ajenas = Array.from(new Set(porHacer.filter((f) => f.invoiceId && !deNotas.has(f.invoiceId)).map((f) => f.invoiceId!)));
      const sinAjustar = ajenas.length
        ? (await tx.invoice.findMany({ where: { clinicId, id: { in: ajenas }, status: { not: "CANCELLED" } }, select: { invoiceNumber: true } })).map((i) => i.invoiceNumber)
        : [];
      const estadoAntes = String(actual?.status ?? plan.status);

      // Revisión t5 (A7): un plan TERMINADO no se cierra, y uno ya cerrado sin nada que ajustar (segundo
      // clic, otra pestaña, reintento) tampoco: `ya_cerrado`, sin escribir nada ni dejar bitácora.
      if (estadoAntes === "COMPLETED" || (estadoAntes === "ABANDONED" && ajustes.length === 0 && cancelables.length === 0)) {
        return { ok: true as const, estado: "ya_cerrado" as const, notas: [], filasCanceladas: 0, saldoAFavor: 0, sinAjustar, estadoAntes };
      }

      const notas: NotaCerrada[] = [];
      let saldoAFavor = 0;
      for (const { n, a } of ajustes) {
        const aj = a!;
        const cancelada = aj.status === "CANCELLED";
        if (aj.aFavor > 0) {
          const pagos = await tx.payment.findMany({
            // La nota ya se leyó y bloqueó con el `clinicId` de quien llama (Payment no tiene clinicId).
            where: { invoiceId: n.id },
            select: { id: true, amount: true, method: true, paidAt: true },
          });
          const ant = pagos.some((p) => p.method === "anticipo") ? await anticipoDeLaFactura(tx, clinicId, n.id) : { neto: 0, aplicaciones: [] };
          // Un cobro que ya es origen de otro saldo a favor no se repite (`paymentId` es único en el libro).
          const usados = new Set(
            (await tx.patientCredit.findMany({ where: { clinicId, paymentId: { in: pagos.map((p) => p.id) } }, select: { paymentId: true } }))
              .map((c) => c.paymentId),
          );
          const origen = origenDelSaldoAFavor(
            aj.aFavor,
            ant.neto,
            pagos.filter((p) => !usados.has(p.id)).map((p) => ({ id: p.id, amount: Number(p.amount) || 0, method: p.method, paidAt: p.paidAt })),
          );
          const texto = `Pagado de más al cerrar el plan «${plan.name}» (nota ${n.invoiceNumber}): queda a favor del paciente`;
          if (origen.deAnticipo > 0) {
            for (const parte of partesDeDevolucion(ant.aplicaciones, origen.deAnticipo)) {
              await tx.patientCredit.create({
                data: {
                  clinicId, patientId: n.patientId, amount: parte.monto, source: FUENTE_DEVUELTO, invoiceId: n.id,
                  reversesId: parte.id, createdById: userId, creditDate: ahora, description: texto,
                },
              });
            }
          }
          for (const c of origen.deCobros) {
            await tx.patientCredit.create({
              data: {
                clinicId, patientId: n.patientId, amount: c.monto, source: FUENTE_EXCEDENTE, invoiceId: n.id,
                paymentId: c.paymentId, createdById: userId, creditDate: ahora, description: texto,
              },
            });
          }
          await tx.payment.create({
            data: {
              invoiceId: n.id,
              amount: aj.aFavor,
              method: "refund",
              refundMethod: REEMBOLSO_A_SALDO_A_FAVOR,
              notes: `Plan «${plan.name}» cerrado: lo pagado de más que lo hecho pasa al saldo a favor del paciente (no sale dinero de caja).`,
              paidAt: ahora,
            },
          });
          saldoAFavor = round2(saldoAFavor + aj.aFavor);
        }

        // Sin nada hecho, la nota se cancela tal cual (sus conceptos se quedan como registro).
        const data: Prisma.InvoiceUpdateManyMutationInput = cancelada
          ? { status: "CANCELLED", paid: 0, balance: 0 }
          : {
              items: aj.items as Prisma.InputJsonValue,
              subtotal: aj.subtotal,
              discount: aj.discount,
              total: aj.total,
              paid: aj.paid,
              balance: aj.balance,
              status: aj.status,
              ...(aj.status === "PAID" && !n.paidAt ? { paidAt: ahora } : {}),
            };
        await tx.invoice.updateMany({ where: { id: n.id, clinicId }, data });
        notas.push({
          invoiceId: n.id,
          invoiceNumber: n.invoiceNumber,
          antes: { total: Number(n.total) || 0, paid: Number(n.paid) || 0, status: n.status },
          despues: cancelada ? { total: Number(n.total) || 0, paid: 0, status: "CANCELLED" } : { total: aj.total, paid: aj.paid, status: aj.status },
          quitadas: aj.quitadas.map((q) => ({ nombre: q.nombre, importe: q.importe })),
          aFavor: aj.aFavor,
        });
        // Las hechas que se quedan, en su nueva línea.
        if (!cancelada && aj.lineaNueva.size) {
          const valores = Array.from(aj.lineaNueva, ([id, linea]) => Prisma.sql`(${id}, ${linea}::int)`);
          await tx.$executeRaw`
            UPDATE "treatment_plan_items" AS t
               SET "invoiceLinea" = v."linea", "updatedAt" = now()
              FROM (VALUES ${Prisma.join(valores)}) AS v("id", "linea")
             WHERE t."id" = v."id" AND t."clinicId" = ${clinicId} AND t."planId" = ${planId} AND t."invoiceId" = ${n.id}`;
        }
      }

      let filasCanceladas = 0;
      if (cancelables.length) {
        filasCanceladas = await tx.$executeRaw`
          UPDATE "treatment_plan_items"
             SET "estado" = 'cancelado', "canceladoEn" = ${ahora.toISOString()}::timestamptz, "canceladoPor" = ${userId},
                 "invoiceId" = NULL, "invoiceLinea" = NULL, "updatedAt" = now()
           WHERE "clinicId" = ${clinicId} AND "planId" = ${planId}
             AND "id" IN (${Prisma.join(cancelables.map((f) => f.id))})
             AND "estado" IN ('pendiente', 'en_curso')`;
      }
      await tx.treatmentPlan.updateMany({ where: { id: planId, clinicId }, data: { status: "ABANDONED" } });
      return { ok: true as const, estado: "cerrado" as const, notas, filasCanceladas, saldoAFavor, sinAjustar, estadoAntes };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );

  if (!r.ok) return r;
  if (r.estado === "ya_cerrado") {
    const { estadoAntes: _y, ...igual } = r;
    return igual;
  }

  for (const n of r.notas) {
    const quitadas = n.quitadas.map((q) => `${q.nombre} (${dinero(q.importe)})`).join(", ");
    await logAudit({
      clinicId,
      userId,
      patientId: plan.patientId,
      texto:
        `Cerró el plan «${plan.name}»: la nota ${n.invoiceNumber} queda en lo hecho (${dinero(n.despues.status === "CANCELLED" ? 0 : n.despues.total)}). ` +
        `Quitó lo no hecho: ${quitadas}.` +
        (n.aFavor > 0 ? ` ${dinero(n.aFavor)} pagados de más quedan como saldo a favor.` : "") +
        ` Motivo: ${motivo}`,
      entityType: "invoice",
      entityId: n.invoiceId,
      action: "update",
      changes: {
        total: { before: n.antes.total, after: n.despues.total },
        paid: { before: n.antes.paid, after: n.despues.paid },
        status: { before: n.antes.status, after: n.despues.status },
        lineasQuitadas: { before: n.quitadas, after: null },
        ...(n.aFavor > 0 ? { saldoAFavor: { before: null, after: n.aFavor } } : {}),
        motivoCierre: { before: null, after: motivo },
      },
    });
  }
  await logAudit({
    clinicId,
    userId,
    patientId: plan.patientId,
    texto:
      `Cerró el plan de tratamiento «${plan.name}» (abandonado). ` +
      (r.filasCanceladas ? `${r.filasCanceladas} procedimiento${r.filasCanceladas === 1 ? "" : "s"} sin hacer cancelado${r.filasCanceladas === 1 ? "" : "s"}. ` : "") +
      (r.saldoAFavor > 0 ? `Saldo a favor: ${dinero(r.saldoAFavor)}. ` : "") +
      (r.sinAjustar.length ? `Sin ajustar (factura de antes del plan, se ajusta en Facturación): ${r.sinAjustar.join(", ")}. ` : "") +
      `Motivo: ${motivo}`,
    entityType: "treatment",
    entityId: planId,
    action: "update",
    changes: {
      status: { before: r.estadoAntes, after: "ABANDONED" },
      motivoCierre: { before: null, after: motivo },
      filasCanceladas: { before: null, after: r.filasCanceladas },
      ...(r.saldoAFavor > 0 ? { saldoAFavor: { before: null, after: r.saldoAFavor } } : {}),
      ...(r.sinAjustar.length ? { facturasSinAjustar: { before: null, after: r.sinAjustar } } : {}),
    },
  });

  const { estadoAntes: _e, ...salida } = r;
  return salida;
}
