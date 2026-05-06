// Periodontics — server actions: PatientShareLink. SPEC §11, COMMIT 8.

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  defaultShareExpiry,
  generateShareToken,
} from "@/lib/periodontics/share-token";
import {
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  loadPatientForPerio,
  ok,
  type ActionResult,
} from "./_helpers";

const createSchema = z.object({
  patientId: z.string().min(1),
  /** Override opcional. Si no, default 30 días. */
  expiresAt: z.coerce.date().optional(),
});

const MAX_RETRIES = 5;

export async function createPerioShareLink(
  input: unknown,
): Promise<ActionResult<{ id: string; token: string; expiresAt: Date }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const patient = await loadPatientForPerio({
    ctx,
    patientId: parsed.data.patientId,
  });
  if (isFailure(patient)) return patient;

  const expiresAt = parsed.data.expiresAt ?? defaultShareExpiry();
  if (expiresAt.getTime() <= Date.now()) {
    return fail("La fecha de expiración debe ser futura");
  }

  // Reintentos por colisión de token (probabilidad ~0 con 192 bits, pero
  // defensivo). El @unique de la tabla garantiza la rareza.
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const token = generateShareToken();
    try {
      const created = await prisma.patientShareLink.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: parsed.data.patientId,
          module: "periodontics",
          token,
          expiresAt,
          createdBy: ctx.userId,
        },
        select: { id: true, token: true, expiresAt: true },
      });

      await auditPerio({
        ctx,
        action: "perio.shareLink.created",
        entityType: "PatientShareLink",
        entityId: created.id,
        after: {
          expiresAt: created.expiresAt.toISOString(),
        },
      });

      revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
      return ok(created);
    } catch (e) {
      // Reintenta solo si fue por unique constraint sobre token.
      const isUniqueViolation =
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code?: unknown }).code === "P2002";
      if (!isUniqueViolation) {
        console.error("[perio share] create failed:", e);
        return fail("No se pudo crear el enlace");
      }
    }
  }
  return fail("No se pudo generar un token único, intenta de nuevo");
}

const revokeSchema = z.object({ shareLinkId: z.string().min(1) });

export async function revokePerioShareLink(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const link = await prisma.patientShareLink.findFirst({
    where: {
      id: parsed.data.shareLinkId,
      clinicId: ctx.clinicId,
      module: "periodontics",
    },
    select: { id: true, patientId: true, revokedAt: true },
  });
  if (!link) return fail("Enlace no encontrado");
  if (link.revokedAt) return ok({ id: link.id });

  try {
    await prisma.patientShareLink.update({
      where: { id: link.id },
      data: { revokedAt: new Date() },
    });
    await auditPerio({
      ctx,
      action: "perio.shareLink.revoked",
      entityType: "PatientShareLink",
      entityId: link.id,
    });
    revalidatePath(`/dashboard/specialties/periodontics/${link.patientId}`);
    return ok({ id: link.id });
  } catch (e) {
    console.error("[perio share] revoke failed:", e);
    return fail("No se pudo revocar el enlace");
  }
}
