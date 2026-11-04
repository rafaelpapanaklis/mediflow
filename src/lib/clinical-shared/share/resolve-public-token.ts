// clinical-shared/share — vista pública de un PatientShareLink (/share/p/[token], sin sesión).
//
// Seguridad (lead 11 de la ola 2, opción a): antes vivía en el módulo "use server" de
// `@/app/actions/clinical-shared/share-links`, así que la página pública, al importarla, quedaba
// registrada para TODAS las server actions de ese archivo (crear, revocar y listar links). Ahora es un
// módulo de servidor normal: la página no expone ninguna action y esta función tampoco es una action
// invocable por POST. La lógica no cambia.
import "server-only";
import type { ClinicalModule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fail, ok, type ActionResult } from "@/lib/clinical-shared/result";
import { buildShortOrthoSummary, type OrthoShareStats } from "@/lib/clinical-shared/share/summary-orthodontics";

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
