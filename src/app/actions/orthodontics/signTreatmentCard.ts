"use server";
// Orthodontics — signTreatmentCard. DrawerTreatmentCard onSign:
// persiste status SIGNED + signedBy/signedAt + valida SOAP S/O/A/P llenos.
//
// Si la card aún no existe (cardId === null) se crea con todos sus hijos en
// la misma transacción y se firma en un solo paso. Si la card ya existe se
// actualiza in-place y se reemplazan los hijos.
//
// Ola 1 (ws1-t4, Control y agenda, sep-2026): mismo tratamiento que
// saveTreatmentCardDraft.ts para `appointmentId`/`activationsNote`/
// `indications` — columnas nuevas, escritas en una transacción APARTE y
// tolerante a P2021/P2022 para no arriesgar la firma en sí.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { canSignSoap } from "./_predicates";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { esCitaControlOrto } from "@/lib/orthodontics/agenda-constants";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { buscarPrecioControlOrto } from "@/lib/orthodontics/catalog-procedures";
import { crearFacturaDesdeCita } from "@/lib/invoices/crear-desde-cita.server";
import { vincularExtraAlCaso } from "@/lib/orthodontics/cobro/extras-db";

/** Códigos Prisma de "columna inexistente" — mismo patrón que cobranza-db.ts. */
function esColumnaAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

const elasticClassEnum = z.enum([
  "CLASE_I",
  "CLASE_II",
  "CLASE_III",
  "BOX",
  "CRISS_CROSS",
  "SETTLING",
]);
const elasticZoneEnum = z.enum(["ANTERIOR", "POSTERIOR", "INTERMAXILAR"]);
const gingivitisEnum = z.enum(["AUSENTE", "LEVE", "MODERADA", "SEVERA"]);

const inputSchema = z.object({
  cardId: z.string().uuid().nullable(),
  treatmentPlanId: z.string().uuid(),
  cardNumber: z.number().int().positive(),
  visitDate: z.string().min(1),
  durationMin: z.number().int().positive().default(30),
  phaseKey: z.enum([
    "ALIGNMENT",
    "LEVELING",
    "SPACE_CLOSURE",
    "DETAILS",
    "FINISHING",
    "RETENTION",
  ]),
  monthAt: z.number().nonnegative(),
  wireFromId: z.string().uuid().nullable().optional(),
  wireToId: z.string().uuid().nullable().optional(),
  soap: z.object({
    s: z.string(),
    o: z.string(),
    a: z.string(),
    p: z.string(),
  }),
  hygiene: z.object({
    plaquePct: z.number().int().min(0).max(100).nullable(),
    gingivitis: gingivitisEnum.nullable(),
    whiteSpots: z.boolean().default(false),
  }),
  elastics: z
    .array(
      z.object({
        elasticClass: elasticClassEnum,
        config: z.string().min(1),
        zone: elasticZoneEnum,
      }),
    )
    .default([]),
  iprPoints: z
    .array(
      z.object({
        toothA: z.number().int(),
        toothB: z.number().int(),
        amountMm: z.number(),
        done: z.boolean().default(true),
      }),
    )
    .default([]),
  brokenBrackets: z
    .array(
      z.object({
        toothFdi: z.number().int(),
        brokenDate: z.string().min(1),
        reBondedDate: z.string().nullable(),
      }),
    )
    .default([]),
  hasProgressPhoto: z.boolean().default(false),
  photoSetId: z.string().uuid().nullable().optional(),
  nextDate: z.string().nullable().optional(),
  nextDurationMin: z.number().int().positive().nullable().optional(),
  /** C6: la cita de Agenda que originó esta hoja (BotonHojaControl). */
  appointmentId: z.string().nullable().optional(),
  /** C2: activaciones de mecánica auxiliar de ESTA visita. */
  activationsNote: z.string().nullable().optional(),
  /** C3: indicaciones para el paciente de ESTA visita. */
  indications: z.string().nullable().optional(),
});

export type SignTreatmentCardInput = z.input<typeof inputSchema>;

export async function signTreatmentCard(
  input: unknown,
): Promise<ActionResult<{ cardId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  // Regla SPEC: para firmar todos los SOAP deben tener contenido tras trim.
  // (zod normaliza optionals a string vacío gracias a default(""), pero el
  // tipo `z.input` los marca opcionales — copiamos al shape estricto.)
  const soap = {
    s: data.soap.s ?? "",
    o: data.soap.o ?? "",
    a: data.soap.a ?? "",
    p: data.soap.p ?? "",
  };
  if (!canSignSoap(soap)) {
    return fail("SOAP incompleto: S, O, A y P son requeridos para firmar");
  }

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  // Tenant + integridad: si viene un appointmentId, la cita tiene que ser de
  // este mismo paciente y clínica (C6).
  let citaDeControl: { id: string; type: string } | null = null;
  if (data.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: data.appointmentId, clinicId: ctx.clinicId, patientId: plan.patientId },
      select: { id: true, type: true },
    });
    if (!appt) return fail("La cita no pertenece a este paciente");
    citaDeControl = appt;
  }

  const visitDate = new Date(data.visitDate);
  const nextDate = data.nextDate ? new Date(data.nextDate) : null;
  const now = new Date();

  try {
    const cardId = await prisma.$transaction(async (tx) => {
      // Upsert por (treatmentPlanId, cardNumber). Si la card existe se
      // actualiza, si no se crea con cardId fresco.
      const existing = data.cardId
        ? await tx.orthoTreatmentCard.findFirst({
            where: { id: data.cardId, treatmentPlanId: plan.id },
            select: { id: true },
          })
        : null;

      let resolvedId: string;
      if (existing) {
        resolvedId = existing.id;
        await tx.orthoTreatmentCard.update({
          where: { id: existing.id },
          data: {
            cardNumber: data.cardNumber,
            visitDate,
            durationMin: data.durationMin,
            phaseKey: data.phaseKey,
            monthAt: data.monthAt,
            wireFromId: data.wireFromId ?? null,
            wireToId: data.wireToId ?? null,
            soapS: data.soap.s,
            soapO: data.soap.o,
            soapA: data.soap.a,
            soapP: data.soap.p,
            hygienePlaquePct: data.hygiene.plaquePct,
            hygieneGingivitis: data.hygiene.gingivitis,
            hygieneWhiteSpots: data.hygiene.whiteSpots,
            hasProgressPhoto: data.hasProgressPhoto,
            photoSetId: data.photoSetId ?? null,
            nextDate,
            nextDurationMin: data.nextDurationMin ?? null,
            status: "SIGNED",
            signedAt: now,
            signedById: ctx.userId,
          },
        });
        // Reemplaza hijos para reflejar exactamente el último estado del UI.
        await tx.orthoCardElastic.deleteMany({ where: { cardId: existing.id } });
        await tx.orthoCardIprPoint.deleteMany({ where: { cardId: existing.id } });
        await tx.orthoCardBrokenBracket.deleteMany({
          where: { cardId: existing.id },
        });
      } else {
        const created = await tx.orthoTreatmentCard.create({
          data: {
            treatmentPlanId: plan.id,
            patientId: plan.patientId,
            clinicId: plan.clinicId,
            cardNumber: data.cardNumber,
            visitDate,
            durationMin: data.durationMin,
            phaseKey: data.phaseKey,
            monthAt: data.monthAt,
            wireFromId: data.wireFromId ?? null,
            wireToId: data.wireToId ?? null,
            soapS: data.soap.s,
            soapO: data.soap.o,
            soapA: data.soap.a,
            soapP: data.soap.p,
            hygienePlaquePct: data.hygiene.plaquePct,
            hygieneGingivitis: data.hygiene.gingivitis,
            hygieneWhiteSpots: data.hygiene.whiteSpots,
            hasProgressPhoto: data.hasProgressPhoto,
            photoSetId: data.photoSetId ?? null,
            nextDate,
            nextDurationMin: data.nextDurationMin ?? null,
            status: "SIGNED",
            signedAt: now,
            signedById: ctx.userId,
          },
          select: { id: true },
        });
        resolvedId = created.id;
      }

      if (data.elastics.length > 0) {
        await tx.orthoCardElastic.createMany({
          data: data.elastics.map((e) => ({
            cardId: resolvedId,
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            elasticClass: e.elasticClass,
            config: e.config,
            zone: e.zone,
          })),
        });
      }
      if (data.iprPoints.length > 0) {
        await tx.orthoCardIprPoint.createMany({
          data: data.iprPoints.map((p) => ({
            cardId: resolvedId,
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            toothA: p.toothA,
            toothB: p.toothB,
            amountMm: p.amountMm,
            done: p.done,
          })),
        });
      }
      if (data.brokenBrackets.length > 0) {
        await tx.orthoCardBrokenBracket.createMany({
          data: data.brokenBrackets.map((b) => ({
            cardId: resolvedId,
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            toothFdi: b.toothFdi,
            brokenDate: new Date(b.brokenDate),
            reBondedDate: b.reBondedDate ? new Date(b.reBondedDate) : null,
          })),
        });
      }

      return resolvedId;
    });

    // Columnas nuevas (Ola 1), en su PROPIA transacción — separada a
    // propósito de la de arriba, igual que saveTreatmentCardDraft.ts: un
    // P2021/P2022 aquí nunca debe poder revertir una firma ya hecha.
    if (
      data.appointmentId !== undefined ||
      data.activationsNote !== undefined ||
      data.indications !== undefined
    ) {
      try {
        await prisma.orthoTreatmentCard.update({
          where: { id: cardId },
          data: {
            ...(data.appointmentId !== undefined
              ? { appointmentId: data.appointmentId }
              : {}),
            ...(data.activationsNote !== undefined
              ? { activationsNote: data.activationsNote }
              : {}),
            ...(data.indications !== undefined ? { indications: data.indications } : {}),
          },
        });
      } catch (e) {
        if (esColumnaAusente(e)) {
          console.warn(
            "[ortho] signTreatmentCard: columnas C2/C3/C6 aún sin aplicar (sql/ortodoncia-control-agenda.sql, sql/ortodoncia-nucleo.sql) — hoja firmada sin ellas",
          );
        } else if ((e as { code?: string } | null)?.code === "P2002") {
          console.warn("[ortho] signTreatmentCard: la cita ya tenía otra hoja ligada");
        } else {
          throw e;
        }
      }
    }

    // Ola 2 (ws1-t1) — modo PAGO_POR_CONTROL: al firmar la hoja de UN
    // control, factura automáticamente el concepto «Control de ortodoncia»
    // del catálogo (factura normal de la cita, cobrable en Caja como
    // cualquier otra) y la liga al caso. Non-blocking a propósito, igual
    // que el bloque de columnas nuevas de arriba: nada de esto puede
    // revertir una firma ya hecha. Sin catálogo o factura ya existente
    // (re-firma de la misma hoja), no pasa nada — no se duplica.
    if (citaDeControl && esCitaControlOrto(citaDeControl.type)) {
      try {
        const modo = normalizarOrthoBillingMode(await cargarModoDeCobro(plan.clinicId, plan.id));
        if (modo === "PAGO_POR_CONTROL") {
          const precio = await buscarPrecioControlOrto(plan.clinicId);
          if (!precio) {
            console.warn("[ortho] signTreatmentCard: modo PAGO_POR_CONTROL sin \"Control de ortodoncia\" en el catálogo — no se facturó este control");
          } else {
            const factura = await crearFacturaDesdeCita({
              clinicId: plan.clinicId,
              appointmentId: citaDeControl.id,
              patientId: plan.patientId,
              lineItems: [{ description: precio.name, unitPrice: precio.basePrice, quantity: 1 }],
              userId: ctx.userId,
            });
            if (factura.ok && factura.invoice) {
              await vincularExtraAlCaso({ invoiceId: factura.invoice.id, treatmentPlanId: plan.id, clinicId: plan.clinicId });
            } else if (factura.error && factura.error !== "invoice_already_exists") {
              console.warn("[ortho] signTreatmentCard: no se pudo facturar el control (modo PAGO_POR_CONTROL):", factura.error, factura.reason);
            }
          }
        }
      } catch (e) {
        console.warn("[ortho] signTreatmentCard: falló la facturación automática del control (no revierte la firma):", e);
      }
    }

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CARD_SIGNED,
      entityType: "OrthoTreatmentCard",
      entityId: cardId,
      after: {
        status: "SIGNED",
        cardNumber: data.cardNumber,
        phaseKey: data.phaseKey,
        signedById: ctx.userId,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
    return ok({ cardId });
  } catch (e) {
    console.error("[ortho] signTreatmentCard failed:", e);
    return fail("No se pudo firmar la cita");
  }
}
