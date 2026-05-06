"use server";
// Implants — createPatientShareToken: genera un PatientShareLink para
// presentar la cronología del implante al paciente vía /share/p/[token].

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  computeExpiresAt,
  DEFAULT_SHARE_EXPIRES_DAYS,
  generateShareToken,
} from "@/lib/clinical-shared/share-tokens";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const createShareTokenSchema = z.object({
  implantId: z.string().min(1),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(DEFAULT_SHARE_EXPIRES_DAYS),
});

export type CreateImplantShareTokenInput = z.infer<
  typeof createShareTokenSchema
>;

export interface CreateImplantShareTokenResult {
  id: string;
  token: string;
  expiresAt: Date;
  url: string;
}

export async function createImplantShareToken(
  input: CreateImplantShareTokenInput,
): Promise<ActionResult<CreateImplantShareTokenResult>> {
  const parsed = createShareTokenSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const implantRes = await loadImplantForCtx({
    ctx,
    implantId: parsed.data.implantId,
  });
  if (isFailure(implantRes)) return implantRes;
  const implant = implantRes.data;

  const token = generateShareToken();
  const expiresAt = computeExpiresAt(new Date(), parsed.data.expiresInDays);

  const created = await prisma.patientShareLink.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: implant.patientId,
      module: "implants",
      token,
      expiresAt,
      createdBy: ctx.userId,
    },
    select: { id: true, token: true, expiresAt: true },
  });

  await auditImplant({
    ctx,
    action: IMPLANT_AUDIT_ACTIONS.SHARE_TOKEN_CREATED,
    entityType: "PatientShareLink",
    entityId: created.id,
    meta: {
      implantId: implant.id,
      patientId: implant.patientId,
      expiresAt: expiresAt.toISOString(),
    },
  }).catch(() => {});

  revalidatePath(`/dashboard/patients/${implant.patientId}`);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000";
  const normalized = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  const url = `${normalized.replace(/\/$/, "")}/share/p/${created.token}`;

  return ok({
    id: created.id,
    token: created.token,
    expiresAt: created.expiresAt,
    url,
  });
}

const revokeShareTokenSchema = z.object({
  shareTokenId: z.string().min(1),
});

export async function revokeImplantShareToken(input: {
  shareTokenId: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = revokeShareTokenSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }
  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tok = await prisma.patientShareLink.findUnique({
    where: { id: parsed.data.shareTokenId },
    select: { id: true, clinicId: true, patientId: true, revokedAt: true },
  });
  if (!tok) return fail("Token no encontrado");
  if (tok.clinicId !== ctx.clinicId) {
    return fail("Token pertenece a otra clínica");
  }
  if (tok.revokedAt) return ok({ id: tok.id }); // idempotente

  await prisma.patientShareLink.update({
    where: { id: tok.id },
    data: { revokedAt: new Date() },
  });

  await auditImplant({
    ctx,
    action: IMPLANT_AUDIT_ACTIONS.SHARE_TOKEN_REVOKED,
    entityType: "PatientShareLink",
    entityId: tok.id,
    meta: { patientId: tok.patientId },
  }).catch(() => {});

  revalidatePath(`/dashboard/patients/${tok.patientId}`);
  return ok({ id: tok.id });
}
