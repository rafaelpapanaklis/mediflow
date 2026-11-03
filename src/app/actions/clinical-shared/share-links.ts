"use server";
// Clinical-shared — server actions para PatientShareLink (tokens públicos
// con expiración para que el paciente vea un resumen del módulo).

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ClinicalModule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared, guardPatient, sinPermisoClinico } from "@/lib/clinical-shared/auth/guard";
import { fail, isFailure, ok, type ActionResult } from "@/lib/clinical-shared/result";

const moduleEnum = z.nativeEnum(ClinicalModule);

const createSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
  /** TTL en días — default 30, máximo 90. */
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export type CreateShareLinkInput = z.infer<typeof createSchema>;

export async function createPatientShareLink(
  input: CreateShareLinkInput,
): Promise<ActionResult<{ token: string; url: string; expiresAt: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  // M6: permiso de rol de lo clínico (guardia compartido).
  const sinPermiso = sinPermisoClinico(ctx, "editar");
  if (sinPermiso) return sinPermiso;

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  // 32 bytes => 256 bits, base64url-safe (~43 chars). Hard-to-guess.
  const token = randomBytes(32).toString("base64url");
  const days = parsed.data.expiresInDays ?? 30;
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);

  await prisma.patientShareLink.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module,
      token,
      expiresAt,
      createdBy: ctx.userId,
    },
  });

  await auditClinicalShared({
    ctx,
    action: "clinical-shared.share-link.created",
    entityType: "patient-share-link",
    entityId: token,
    patientId: parsed.data.patientId,
    changes: { module: parsed.data.module, expiresInDays: days },
  });

  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return ok({
    token,
    url: `${base}/share/p/${token}`,
    expiresAt: expiresAt.toISOString(),
  });
}

const revokeSchema = z.object({ token: z.string().min(1) });

export async function revokePatientShareLink(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult<{ token: string }>> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  // M6: permiso de rol de lo clínico (guardia compartido).
  const sinPermiso = sinPermisoClinico(ctx, "editar");
  if (sinPermiso) return sinPermiso;

  const link = await prisma.patientShareLink.findUnique({
    where: { token: parsed.data.token },
    select: { id: true, clinicId: true, revokedAt: true, patientId: true },
  });
  if (!link) return fail("Link no encontrado");
  if (link.clinicId !== ctx.clinicId) return fail("Sin acceso");
  if (link.revokedAt) return fail("Link ya revocado");

  await prisma.patientShareLink.update({
    where: { token: parsed.data.token },
    data: { revokedAt: new Date() },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.share-link.revoked",
    entityType: "patient-share-link",
    entityId: parsed.data.token,
    patientId: link.patientId,
  });
  revalidatePath(`/dashboard/patients/${link.patientId}`);
  return ok({ token: parsed.data.token });
}

const listSchema = z.object({
  patientId: z.string().min(1),
});

export async function listPatientShareLinks(
  input: z.infer<typeof listSchema>,
): Promise<
  ActionResult<
    Array<{
      token: string;
      module: ClinicalModule;
      expiresAt: string;
      revokedAt: string | null;
      viewCount: number;
      createdAt: string;
    }>
  >
> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  // M6: permiso de rol de lo clínico (guardia compartido).
  const sinPermiso = sinPermisoClinico(ctx, "ver");
  if (sinPermiso) return sinPermiso;

  // Visibilidad por paciente: no listar los share-links de un paciente restringido.
  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  const rows = await prisma.patientShareLink.findMany({
    where: { clinicId: ctx.clinicId, patientId: parsed.data.patientId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return ok(
    rows.map((r) => ({
      token: r.token,
      module: r.module,
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      viewCount: r.viewCount,
      createdAt: r.createdAt.toISOString(),
    })),
  );
}

// La vista pública (/share/p/[token], sin sesión) vive en `@/lib/clinical-shared/share/resolve-public-token`,
// un módulo de servidor NORMAL. Cuando vivía aquí, la página pública importaba este archivo y eso le registraba
// las server actions de crear, revocar y listar links. No la reexportes desde este módulo "use server".
