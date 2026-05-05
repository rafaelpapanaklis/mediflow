"use server";
// Implants — createImplantConsent. Spec §10.4.
// El SignaturePad de pediatría devuelve la firma como base64 que se
// guarda en patientSignatureImage (inline) o se sube como archivo y
// se referencia con signedFileId.

import { prisma } from "@/lib/prisma";
import {
  createImplantConsentSchema,
  type CreateImplantConsentInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createImplantConsent(
  input: CreateImplantConsentInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createImplantConsentSchema.safeParse(input);
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
  const before = implantRes.data;

  if (parsed.data.patientId !== before.patientId) {
    return fail("patientId no coincide con el implante");
  }

  try {
    const created = await prisma.implantConsent.create({
      data: {
        implantId: parsed.data.implantId,
        patientId: parsed.data.patientId,
        doctorId: parsed.data.doctorId,
        consentType: parsed.data.consentType,
        text: parsed.data.text,
        acceptedRisks:
          (parsed.data.acceptedRisks as object | undefined) ?? undefined,
        signedAt: parsed.data.signedAt ?? null,
        patientSignatureImage: parsed.data.patientSignatureImage ?? null,
        signedFileId: parsed.data.signedFileId ?? null,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.CONSENT_CREATED,
      entityType: "implant.consent",
      entityId: created.id,
      after: {
        implantId: parsed.data.implantId,
        consentType: parsed.data.consentType,
        signedAt: parsed.data.signedAt?.toISOString() ?? null,
        doctorId: parsed.data.doctorId,
      },
    });

    revalidateImplantPaths({ patientId: before.patientId });
    return ok({ id: created.id });
  } catch (e) {
    console.error("[createImplantConsent]", e);
    return fail("Error al registrar consentimiento");
  }
}
