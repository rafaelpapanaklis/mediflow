"use server";
// Clinical-shared — server actions para PatientShareLink (tokens públicos
// con expiración para que el paciente vea un resumen del módulo).

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ClinicalModule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared, guardPatient } from "@/lib/clinical-shared/auth/guard";
import { fail, isFailure, ok, type ActionResult } from "@/lib/clinical-shared/result";
import {
  buildShortOrthoSummary,
  type OrthoShareStats,
} from "@/lib/clinical-shared/share/summary-orthodontics";

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

// ── API pública para /share/p/[token] (sin auth) ─────────────────────

export interface PublicShareView {
  module: ClinicalModule;
  patientFirstName: string;
  clinicName: string;
  generatedAt: string;
  /** Resumen del módulo origen — string libre, sin PII fuera de lo necesario. */
  summary: string;
  /**
   * Stats pediátricos. Para módulos no-pediatrics se devuelven en cero
   * para no romper consumidores que asumen el shape.
   */
  stats: {
    sealants: number;
    fluorides: number;
    behaviorAssessments: number;
    consents: number;
  };
  /** Stats orto-específicos (sólo presente cuando module=orthodontics). */
  orthoStats?: OrthoShareStats;
}

const ZERO_STATS = {
  sealants: 0,
  fluorides: 0,
  behaviorAssessments: 0,
  consents: 0,
};

/**
 * Resuelve un token público y devuelve la vista mínima necesaria.
 * Incrementa viewCount + lastViewed sin bloquear el response.
 */
export async function resolvePublicShareToken(
  token: string,
): Promise<ActionResult<PublicShareView>> {
  if (!token || token.length < 16) return fail("Token inválido");

  const link = await prisma.patientShareLink.findUnique({
    where: { token },
    select: {
      id: true,
      module: true,
      patientId: true,
      clinicId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!link) return fail("Link no encontrado");
  if (link.revokedAt) return fail("Link revocado");
  if (link.expiresAt.getTime() < Date.now()) return fail("Link expirado");

  // Incrementa viewCount sin bloquear el response (ignorando errores).
  void prisma.patientShareLink
    .update({
      where: { token },
      data: { viewCount: { increment: 1 }, lastViewed: new Date() },
    })
    .catch(() => undefined);

  if (link.module === "orthodontics") {
    const [patient, clinic] = await Promise.all([
      prisma.patient.findUnique({
        where: { id: link.patientId },
        select: { firstName: true, deletedAt: true },
      }),
      prisma.clinic.findUnique({
        where: { id: link.clinicId },
        select: { name: true },
      }),
    ]);
    if (!patient || patient.deletedAt) return fail("Paciente no disponible");
    if (!clinic) return fail("Clínica no disponible");

    const built = await buildShortOrthoSummary({
      patientId: link.patientId,
      clinicId: link.clinicId,
    });
    return ok({
      module: link.module,
      patientFirstName: patient.firstName,
      clinicName: clinic.name,
      generatedAt: new Date().toISOString(),
      summary: built.summary,
      stats: ZERO_STATS,
      orthoStats: built.stats,
    });
  }

  // Pediatrics (default)
  const [patient, clinic, sealants, fluorides, behavior, consents] = await Promise.all([
    prisma.patient.findUnique({
      where: { id: link.patientId },
      select: { firstName: true, deletedAt: true },
    }),
    prisma.clinic.findUnique({
      where: { id: link.clinicId },
      select: { name: true },
    }),
    prisma.sealant.count({ where: { patientId: link.patientId, deletedAt: null } }),
    prisma.fluorideApplication.count({
      where: { patientId: link.patientId, deletedAt: null },
    }),
    prisma.behaviorAssessment.count({
      where: { patientId: link.patientId, deletedAt: null },
    }),
    prisma.pediatricConsent.count({ where: { patientId: link.patientId } }),
  ]);

  if (!patient || patient.deletedAt) return fail("Paciente no disponible");
  if (!clinic) return fail("Clínica no disponible");

  let summary = "";
  if (link.module === "pediatrics") {
    summary = await buildShortPediatricSummary({
      patientId: link.patientId,
      clinicId: link.clinicId,
    });
  }

  return ok({
    module: link.module,
    patientFirstName: patient.firstName,
    clinicName: clinic.name,
    generatedAt: new Date().toISOString(),
    summary,
    stats: {
      sealants,
      fluorides,
      behaviorAssessments: behavior,
      consents,
    },
  });
}

async function buildShortPediatricSummary(args: {
  patientId: string;
  clinicId: string;
}): Promise<string> {
  // Solo info que el paciente/tutor querría ver. Sin notas internas.
  const lastBehavior = await prisma.behaviorAssessment.findFirst({
    where: { patientId: args.patientId, clinicId: args.clinicId, deletedAt: null },
    orderBy: { recordedAt: "desc" },
    select: { scale: true, value: true },
  });
  const lastCambra = await prisma.cariesRiskAssessment.findFirst({
    where: { patientId: args.patientId, clinicId: args.clinicId, deletedAt: null },
    orderBy: { scoredAt: "desc" },
    select: { category: true, recommendedRecallMonths: true },
  });
  const habitsActive = await prisma.oralHabit.count({
    where: {
      patientId: args.patientId,
      clinicId: args.clinicId,
      endedAt: null,
      deletedAt: null,
    },
  });

  const lines: string[] = [];
  lines.push(
    "Tu pediatra dental llevó a cabo este resumen como referencia rápida del progreso.",
  );
  if (lastBehavior) {
    if (lastBehavior.scale === "frankl") {
      lines.push(
        `Tu hijo(a) mostró una conducta Frankl ${lastBehavior.value}/4 en la última visita.`,
      );
    } else {
      lines.push(
        `Tu hijo(a) mostró una respuesta Venham ${lastBehavior.value}/5 en la última visita.`,
      );
    }
  }
  if (lastCambra) {
    lines.push(
      `Riesgo cariogénico: ${lastCambra.category}. Recomendamos revisión cada ${lastCambra.recommendedRecallMonths} mes(es).`,
    );
  }
  if (habitsActive > 0) {
    lines.push(`Hábitos en seguimiento: ${habitsActive}.`);
  }
  return lines.join("\n\n");
}
