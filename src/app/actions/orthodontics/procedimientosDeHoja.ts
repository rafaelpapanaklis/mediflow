"use server";
// Ortodoncia — «Procedimientos de esta visita» en la hoja de control.
//
//  · cargarProcedimientosDeHoja: el catálogo elegible, las líneas ya guardadas de
//    la hoja (con el estado de su factura) y si quien mira puede cobrar.
//  · cobrarProcedimientoDeHoja: crea la factura del extra (misma factura normal que
//    «Cobrar extra», ligada al caso) de UNA línea con costo aparte de una hoja YA
//    FIRMADA. No duplica: por la línea, por la marca de la factura y por un candado
//    de fila sobre la nota. Exige permiso de cobro; sin él, la línea sigue «por cobrar».
//  · listarExtrasPorCobrar: lo que quedó pendiente (ficha y Cobranza).
//
// ES DINERO: precio y nombre salen de lo GUARDADO en la hoja al firmar (que salió
// del catálogo), nunca de lo que mande el cliente. `clinicId` de la sesión.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import { canSeePatient } from "@/lib/patient-visibility";
import { crearFacturaDesdeCita } from "@/lib/invoices/crear-desde-cita.server";
import { vincularExtraAlCaso } from "@/lib/orthodontics/cobro/extras-db";
import { cargarPlanDetalle } from "@/lib/orthodontics/plan-detalle-db";
import { extraccionesPendientes, ordenarConSugeridosPrimero, procedimientosQueFaltanEnElCatalogo, procedimientosSugeridos } from "@/lib/orthodontics/plan-detalle";
import {
  buscarNotaDeHoja,
  cargarCatalogoElegible,
} from "@/lib/orthodontics/procedimientos-de-hoja-db";
import {
  estadoDeLinea,
  hayPorCobrar,
  lineasDeLaNota,
  marcaDeExtraDeHoja,
  notaDeFacturaDeExtra,
  totalDeLinea,
  type EstadoDeLinea,
  type LineaDeVisita,
} from "@/lib/orthodontics/procedimientos-de-visita";
import { getOrthoActionContext, getOrthoBillingActionContext } from "./_helpers";
import { auditarCobro, loadCasoParaCobro } from "./cobro/_ctx";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface LineaParaVista extends LineaDeVisita {
  estado: EstadoDeLinea;
  total: number;
  /** Estado de la factura del extra, si ya existe. */
  factura: { numero: string | null; pagada: boolean; cancelada: boolean } | null;
}

export interface ProcedimientoElegible {
  id: string;
  name: string;
  price: number;
  incluido: boolean;
  /** ws1-t12: lo propone el plan de tratamiento del caso (microtornillo, barra palatina, disyuntor…): va primero. */
  sugerido?: boolean;
  /** «Del plan: Microtornillos». */
  motivo?: string;
}

async function conEstadoDeFactura(clinicId: string, lineas: LineaDeVisita[]): Promise<LineaParaVista[]> {
  const ids = lineas.map((l) => l.invoiceId).filter((x): x is string => !!x);
  const facturas = ids.length
    ? await prisma.invoice
        .findMany({ where: { id: { in: ids }, clinicId }, select: { id: true, invoiceNumber: true, status: true, balance: true } })
        .catch(() => [])
    : [];
  const porId = new Map(facturas.map((f) => [f.id, f]));
  return lineas.map((l) => {
    const f = l.invoiceId ? porId.get(l.invoiceId) : undefined;
    return {
      ...l,
      estado: estadoDeLinea(l),
      total: totalDeLinea(l),
      factura: f ? { numero: f.invoiceNumber, pagada: f.status === "PAID", cancelada: f.status === "CANCELLED" } : null,
    };
  });
}

export async function cargarProcedimientosDeHoja(input: {
  treatmentPlanId: string;
  cardId: string | null;
}): Promise<
  ActionResult<{
    catalogo: ProcedimientoElegible[];
    lineas: LineaParaVista[];
    puedeCobrar: boolean;
    hojaFirmada: boolean;
    /** ws1-t12: extracciones indicadas en el plan que aún no se marcan como realizadas. */
    extraccionesPendientes: number[];
    /** ws1-t12: lo que el plan eligió y el catálogo no tiene (se avisa con enlace a Configuración → Procedimientos). */
    procedimientosFaltantes: string[];
  }>
> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!input?.treatmentPlanId) return fail("Falta el caso");

  const caso = await loadCasoParaCobro({ ctx, treatmentPlanId: input.treatmentPlanId });
  if (isFailure(caso)) return caso;

  const [catalogo, nota, planDetalle, indicadas] = await Promise.all([
    cargarCatalogoElegible(ctx.clinicId),
    input.cardId ? buscarNotaDeHoja(ctx.clinicId, input.cardId) : Promise.resolve(null),
    // ws1-t12: el plan de tratamiento del caso propone procedimientos y sabe qué extracciones faltan.
    cargarPlanDetalle(ctx.clinicId, caso.data.id).catch(() => null),
    prisma.orthodonticTreatmentPlan
      .findFirst({ where: { id: caso.data.id, clinicId: ctx.clinicId, deletedAt: null }, select: { extractionsTeethFdi: true } })
      .catch(() => null),
  ]);
  // La nota tiene que ser de ESTE caso: el id de la hoja llega del cliente.
  const notaValida = nota && nota.specialtyData.treatmentPlanId === input.treatmentPlanId ? nota : null;
  const lineas = await conEstadoDeFactura(ctx.clinicId, lineasDeLaNota(notaValida?.specialtyData));

  const sugeridos = procedimientosSugeridos(planDetalle, catalogo);
  const motivoPorId = new Map(sugeridos.map((x) => [x.procedureId, x.motivo]));
  return ok({
    catalogo: ordenarConSugeridosPrimero(catalogo, sugeridos).map((c) => ({
      id: c.id,
      name: c.name,
      price: c.basePrice,
      incluido: c.orthoIncludedInTreatment === true,
      ...(motivoPorId.has(c.id) ? { sugerido: true, motivo: motivoPorId.get(c.id) } : {}),
    })),
    extraccionesPendientes: extraccionesPendientes(indicadas?.extractionsTeethFdi ?? [], planDetalle?.extraccionesRealizadas ?? []),
    procedimientosFaltantes: procedimientosQueFaltanEnElCatalogo(planDetalle, catalogo),
    lineas,
    puedeCobrar: hasPermission({ role: ctx.role as never, permissionsOverride: ctx.permissionsOverride }, "billing.charge"),
    hojaFirmada: Boolean(notaValida?.firmada),
  });
}

export async function cobrarProcedimientoDeHoja(input: {
  cardId: string;
  procedureId: string;
}): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string | null; yaExistia: boolean }>> {
  const ctxResult = await getOrthoBillingActionContext("billing.charge");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;
  if (typeof input?.cardId !== "string" || typeof input?.procedureId !== "string" || !input.cardId || !input.procedureId) {
    return fail("Datos inválidos");
  }

  const card = await prisma.orthoTreatmentCard.findFirst({
    where: { id: input.cardId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, treatmentPlanId: true, cardNumber: true, status: true },
  });
  if (!card) return fail("Hoja de control no encontrada");
  if (card.status !== "SIGNED") return fail("Firma la hoja de control antes de cobrar sus procedimientos");

  const caso = await loadCasoParaCobro({ ctx, treatmentPlanId: card.treatmentPlanId });
  if (isFailure(caso)) return caso;

  try {
    const resultado = await prisma.$transaction(
      async (tx) => {
        // Candado de fila sobre la nota: dos cobros a la vez de la MISMA línea se serializan
        // y el segundo ya ve la factura del primero.
        await tx.$queryRaw`
          SELECT "id" FROM "medical_records"
           WHERE "clinicId" = ${ctx.clinicId} AND "specialtyData"->>'treatmentCardId' = ${card.id}
           FOR UPDATE`;
        const nota = await tx.medicalRecord.findFirst({
          where: { clinicId: ctx.clinicId, specialtyData: { path: ["treatmentCardId"], equals: card.id } },
          select: { id: true, specialtyData: true },
        });
        if (!nota) return { error: "La nota de esta hoja no existe" } as const;
        const sd = (nota.specialtyData ?? {}) as Record<string, unknown>;
        const lineas = lineasDeLaNota(sd);
        const linea = lineas.find((l) => l.procedureId === input.procedureId);
        if (!linea) return { error: "Ese procedimiento no está en esta hoja" } as const;
        if (linea.incluido) return { error: "Está incluido en el tratamiento: no se cobra" } as const;

        // 1) La línea ya tiene su factura vigente.
        if (linea.invoiceId) {
          const f = await tx.invoice.findFirst({ where: { id: linea.invoiceId, clinicId: ctx.clinicId }, select: { id: true, invoiceNumber: true, status: true } });
          if (f && f.status !== "CANCELLED") return { invoiceId: f.id, invoiceNumber: f.invoiceNumber, yaExistia: true } as const;
        }
        // 2) Existe una factura vigente con la marca de esta línea (p. ej. se cortó antes de anotarla).
        const marca = marcaDeExtraDeHoja(card.id, linea.procedureId);
        const huerfana = await tx.invoice.findFirst({
          where: { clinicId: ctx.clinicId, patientId: card.patientId, notes: { startsWith: marca }, status: { not: "CANCELLED" } },
          select: { id: true, invoiceNumber: true },
        });
        let invoiceId: string;
        let invoiceNumber: string | null;
        let yaExistia = false;
        if (huerfana) {
          invoiceId = huerfana.id;
          invoiceNumber = huerfana.invoiceNumber;
          yaExistia = true;
        } else {
          const factura = await crearFacturaDesdeCita({
            clinicId: ctx.clinicId,
            appointmentId: null,
            patientId: card.patientId,
            lineItems: [{ description: linea.name, unitPrice: linea.unitPrice, quantity: linea.quantity }],
            notes: notaDeFacturaDeExtra(card.id, linea, card.cardNumber),
            userId: ctx.userId,
          });
          if (!factura.ok || !factura.invoice) return { error: "No se pudo crear la factura del extra. Inténtalo de nuevo o cóbralo con «Cobrar extra»." } as const;
          invoiceId = factura.invoice.id;
          invoiceNumber = factura.invoice.invoiceNumber;
        }

        await vincularExtraAlCaso({ invoiceId, treatmentPlanId: card.treatmentPlanId, clinicId: ctx.clinicId });

        const nuevas = lineas.map((l) =>
          l.procedureId === linea.procedureId ? { ...l, invoiceId, invoiceNumber, facturadoAt: new Date().toISOString() } : l,
        );
        await tx.medicalRecord.update({
          where: { id: nota.id },
          data: { specialtyData: { ...sd, procedimientos: nuevas, hayPorCobrar: hayPorCobrar(nuevas) } as never },
        });
        return { invoiceId, invoiceNumber, yaExistia } as const;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    if ("error" in resultado) return fail(resultado.error);

    await auditarCobro({
      ctx,
      action: "cobrar-procedimiento-de-hoja",
      entityId: card.treatmentPlanId,
      patientId: card.patientId,
      meta: { cardId: card.id, procedureId: input.procedureId, invoiceId: resultado.invoiceId, yaExistia: resultado.yaExistia },
    });
    revalidatePath(`/dashboard/patients/${card.patientId}`);
    revalidatePath("/dashboard/orthodontics/cobranza");
    return ok(resultado);
  } catch (e) {
    console.error("[ortho] cobrarProcedimientoDeHoja:", e);
    return fail("No se pudo cobrar el procedimiento. Inténtalo de nuevo.");
  }
}

export interface ExtraPorCobrar {
  cardId: string;
  treatmentPlanId: string;
  patientId: string;
  patientName: string;
  cardNumber: number | null;
  visitDate: string;
  procedureId: string;
  name: string;
  quantity: number;
  total: number;
}

/** Extras con costo aparte de hojas firmadas que siguen sin factura. Del caso, o de toda la clínica. */
export async function listarExtrasPorCobrar(input?: {
  treatmentPlanId?: string;
}): Promise<ActionResult<{ extras: ExtraPorCobrar[]; puedeCobrar: boolean }>> {
  const auth = await getOrthoBillingActionContext("billing.view");
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  try {
    const notas = await prisma.medicalRecord.findMany({
      where: {
        clinicId: ctx.clinicId,
        AND: [
          { specialtyData: { path: ["hayPorCobrar"], equals: true } },
          ...(input?.treatmentPlanId ? [{ specialtyData: { path: ["treatmentPlanId"], equals: input.treatmentPlanId } }] : []),
        ],
      },
      orderBy: { visitDate: "desc" },
      take: 200,
      select: {
        visitDate: true,
        specialtyData: true,
        patient: { select: { id: true, firstName: true, lastName: true, visibleUserIds: true } },
      },
    });
    const extras: ExtraPorCobrar[] = [];
    for (const n of notas) {
      if (!canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, n.patient.visibleUserIds)) continue;
      const sd = (n.specialtyData ?? {}) as Record<string, unknown>;
      for (const l of lineasDeLaNota(sd)) {
        if (estadoDeLinea(l) !== "por-cobrar") continue;
        extras.push({
          cardId: String(sd.treatmentCardId ?? ""),
          treatmentPlanId: String(sd.treatmentPlanId ?? ""),
          patientId: n.patient.id,
          patientName: `${n.patient.firstName} ${n.patient.lastName}`.trim(),
          cardNumber: typeof sd.cardNumber === "number" ? sd.cardNumber : null,
          visitDate: n.visitDate.toISOString(),
          procedureId: l.procedureId,
          name: l.name,
          quantity: l.quantity,
          total: totalDeLinea(l),
        });
      }
    }
    return ok({
      extras,
      puedeCobrar: hasPermission({ role: ctx.role as never, permissionsOverride: ctx.permissionsOverride }, "billing.charge"),
    });
  } catch (e) {
    console.error("[ortho] listarExtrasPorCobrar:", e);
    return ok({ extras: [], puedeCobrar: false });
  }
}
