"use server";
// Implants — enableQrPublicAccess. Spec §1.16, §10.3.
// QR público es OPT-IN (LFPDPPP). Requiere ImplantConsent firmado tipo
// QR_PUBLIC. Genera token único y lo enlaza al passport.

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  enableQrPublicAccessSchema,
  type EnableQrPublicAccessInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function enableQrPublicAccess(
  input: EnableQrPublicAccessInput,
): Promise<ActionResult<{ qrToken: string }>> {
  const parsed = enableQrPublicAccessSchema.safeParse(input);
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

  // Verifica consentimiento tipo QR_PUBLIC firmado.
  const consent = await prisma.implantConsent.findUnique({
    where: { id: parsed.data.qrConsentId },
    select: {
      id: true,
      implantId: true,
      consentType: true,
      signedAt: true,
      revokedAt: true,
    },
  });
  if (!consent) return fail("Consentimiento no encontrado");
  if (consent.implantId !== parsed.data.implantId) {
    return fail("Consentimiento no corresponde a este implante");
  }
  if (consent.consentType !== "QR_PUBLIC") {
    return fail("Consentimiento debe ser de tipo QR_PUBLIC");
  }
  if (!consent.signedAt) {
    return fail("Consentimiento aún no está firmado");
  }
  if (consent.revokedAt) {
    return fail("Consentimiento revocado");
  }

  const passport = await prisma.implantPassport.findUnique({
    where: { implantId: parsed.data.implantId },
    select: { id: true },
  });
  if (!passport) {
    return fail("El implante aún no tiene carnet generado");
  }

  // Token de 22 chars seguro para URL.
  const qrToken = crypto.randomBytes(16).toString("base64url");

  try {
    const updated = await prisma.implantPassport.update({
      where: { id: passport.id },
      data: {
        qrPublicEnabled: true,
        qrPublicConsentId: parsed.data.qrConsentId,
        qrToken,
      },
      select: { id: true, qrToken: true },
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.QR_PUBLIC_ENABLED,
      entityType: "implant.passport",
      entityId: updated.id,
      after: {
        implantId: parsed.data.implantId,
        qrConsentId: parsed.data.qrConsentId,
        qrToken,
      },
    });

    revalidateImplantPaths({ patientId: before.patientId });
    return ok({ qrToken: updated.qrToken ?? qrToken });
  } catch (e) {
    console.error("[enableQrPublicAccess]", e);
    return fail("Error al activar QR público");
  }
}
