"use server";
// Orthodontics — saveTreatmentCardDraft. DrawerTreatmentCard onSave:
// persiste status DRAFT con todos los hijos (elastics/IPR/brokenBrackets)
// SIN exigir SOAP completo. La card solo se firma vía signTreatmentCard.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

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
  nextDate: z.string().nullable().optional(),
  nextDurationMin: z.number().int().positive().nullable().optional(),
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

  const visitDate = new Date(data.visitDate);
  const nextDate = data.nextDate ? new Date(data.nextDate) : null;

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

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CARD_DRAFT_SAVED,
      entityType: "OrthoTreatmentCard",
      entityId: cardId,
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
