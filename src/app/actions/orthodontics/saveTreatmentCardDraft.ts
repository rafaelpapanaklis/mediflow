"use server";
// Orthodontics — saveTreatmentCardDraft. DrawerTreatmentCard onSave:
// persiste status DRAFT con todos los hijos (elastics/IPR/brokenBrackets)
// SIN exigir SOAP completo. La card solo se firma vía signTreatmentCard.
//
// Ola 1 (ws1-t4, Control y agenda, sep-2026): además de los campos de Ola 0,
// persiste `appointmentId` (liga la hoja con la cita real de Agenda que la
// originó, C6) y `activationsNote`/`indications` (C2/C3). Las tres columnas
// son nuevas y pueden no estar aplicadas todavía en esta base
// (sql/ortodoncia-control-agenda.sql, sql/ortodoncia-nucleo.sql) — se
// escriben en un UPDATE aparte, tolerante a P2021/P2022, para que un SQL
// pendiente nunca tumbe el guardado del resto de la hoja (SOAP, higiene,
// elásticos…) que ya funciona en producción.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { idDeLaBase } from "@/lib/validation/id";
import { prisma } from "@/lib/prisma";
import type { Pedido } from "@/lib/orthodontics/procedimientos-de-visita";
import { buscarNotaDeHoja, escribirNotaDeHoja, validarPedidos } from "@/lib/orthodontics/procedimientos-de-hoja-db";
import { auditOrtho, getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

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
  cardId: idDeLaBase().nullable(),
  treatmentPlanId: idDeLaBase(),
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
  wireFromId: idDeLaBase().nullable().optional(),
  wireToId: idDeLaBase().nullable().optional(),
  soap: z.object({
    s: z.string().default(""),
    o: z.string().default(""),
    a: z.string().default(""),
    p: z.string().default(""),
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
  photoSetId: idDeLaBase().nullable().optional(),
  nextDate: z.string().nullable().optional(),
  nextDurationMin: z.number().int().positive().nullable().optional(),
  /** C6: la cita de Agenda que originó esta hoja (BotonHojaControl). */
  appointmentId: z.string().nullable().optional(),
  /** C2: activaciones de mecánica auxiliar de ESTA visita. */
  activationsNote: z.string().nullable().optional(),
  /** C3: indicaciones para el paciente de ESTA visita. */
  indications: z.string().nullable().optional(),
  /** «Procedimientos de esta visita»: solo QUÉ y CUÁNTOS (precio y tipo salen del catálogo). */
  procedimientos: z
    .array(z.object({ procedureId: z.string().min(1), quantity: z.number().int().min(1).max(20) }))
    .optional(),
});

export type SaveTreatmentCardDraftInput = z.input<typeof inputSchema>;

export async function saveTreatmentCardDraft(
  input: unknown,
): Promise<ActionResult<{ cardId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");
  // Visibilidad por paciente (la regla de todo el módulo): ver signTreatmentCard.ts.
  const visible = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(visible)) return visible;

  // Tenant + integridad: si viene un appointmentId, la cita tiene que ser de
  // este mismo paciente y clínica — nunca se confía en que el cliente mande
  // el id correcto sin verificar (C6).
  if (data.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: data.appointmentId, clinicId: ctx.clinicId, patientId: plan.patientId },
      select: { id: true },
    });
    if (!appt) return fail("La cita no pertenece a este paciente");
  }

  const visitDate = new Date(data.visitDate);
  const nextDate = data.nextDate ? new Date(data.nextDate) : null;

  // Los procedimientos se validan contra el catálogo ANTES de guardar nada.
  if (data.procedimientos !== undefined) {
    const errorProcedimientos = await validarPedidos({ clinicId: ctx.clinicId, cardId: data.cardId ?? null, pedidos: data.procedimientos as Pedido[] });
    if (errorProcedimientos) return fail(errorProcedimientos);
  }

  try {
    const cardId = await prisma.$transaction(async (tx) => {
      const existing = data.cardId
        ? await tx.orthoTreatmentCard.findFirst({
            where: { id: data.cardId, treatmentPlanId: plan.id },
            select: { id: true, status: true },
          })
        : null;

      // No permitir editar como draft una card ya firmada.
      if (existing?.status === "SIGNED") {
        throw new Error("Card ya firmada — no se puede sobreescribir");
      }

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
            status: "DRAFT",
          },
        });
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
            status: "DRAFT",
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

    // Columnas nuevas (Ola 1, sql/ortodoncia-control-agenda.sql +
    // sql/ortodoncia-nucleo.sql), en su PROPIA transacción — separada a
    // propósito de la de arriba: si el SQL todavía no está pegado en esta
    // base, Postgres aborta cualquier transacción donde falle un UPDATE por
    // columna inexistente, y eso se llevaría entre las patas los hijos
    // (elastics/IPR/brokenBrackets) que sí acaban de guardarse bien. Aparte,
    // P2021/P2022 solo pierde estas tres columnas, nunca el resto de la hoja.
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
            "[ortho] saveTreatmentCardDraft: columnas C2/C3/C6 aún sin aplicar (sql/ortodoncia-control-agenda.sql, sql/ortodoncia-nucleo.sql) — hoja guardada sin ellas",
          );
        } else if ((e as { code?: string } | null)?.code === "P2002") {
          // Esa cita ya tiene otra hoja ligada (índice único appointmentId) —
          // la hoja de esta card ya se guardó bien arriba, solo no quedó
          // ligada a la cita.
          console.warn("[ortho] saveTreatmentCardDraft: la cita ya tenía otra hoja ligada");
        } else {
          throw e;
        }
      }
    }

    // Los procedimientos viajan con la hoja: en borrador quedan en la nota-borrador del
    // expediente. Solo se crea esa nota si hay algo que guardar (o ya existía).
    if (data.procedimientos !== undefined) {
      try {
        const nota = await buscarNotaDeHoja(plan.clinicId, cardId);
        if (data.procedimientos.length > 0 || nota) {
          await escribirNotaDeHoja({
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            planId: plan.id,
            userId: ctx.userId,
            cardId,
            cardNumber: data.cardNumber,
            visitDate: new Date(data.visitDate),
            appointmentId: data.appointmentId ?? null,
            soap: { s: data.soap.s ?? "", o: data.soap.o ?? "", a: data.soap.a ?? "", p: data.soap.p ?? "" },
            pedidos: data.procedimientos as Pedido[] | undefined,
            firmar: false,
          });
        }
      } catch (e) {
        console.warn("[ortho] saveTreatmentCardDraft: no se guardaron los procedimientos en la nota-borrador:", e);
        return fail("El borrador se guardó, pero no se pudieron guardar sus procedimientos. Inténtalo de nuevo.");
      }
    }

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CARD_DRAFT_SAVED,
      entityType: "OrthoTreatmentCard",
      entityId: cardId,
      patientId: plan.patientId,
      after: {
        status: "DRAFT",
        cardNumber: data.cardNumber,
        phaseKey: data.phaseKey,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
    return ok({ cardId });
  } catch (e) {
    console.error("[ortho] saveTreatmentCardDraft failed:", e);
    if (e instanceof Error && e.message.includes("Card ya firmada")) {
      return fail(e.message);
    }
    return fail("No se pudo guardar el borrador");
  }
}
