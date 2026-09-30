// Clinical-shared — generador de summary clínico orto para hojas de referencia.
// Pediatrics tiene su builder en summary.ts; aquí solo Ortodoncia.

import { prisma } from "@/lib/prisma";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { techniqueLabel } from "@/lib/orthodontics/consent-texts";
import { cargarDiagnosticoDetalle } from "@/lib/orthodontics/diagnostico-detalle-db";
import { medidaSinCapturar } from "@/lib/orthodontics/diagnostico-detalle";

const ANGLE_CLASS_LABELS: Record<string, string> = {
  CLASS_I: "Clase I",
  CLASS_II_DIV_1: "Clase II div. 1",
  CLASS_II_DIV_2: "Clase II div. 2",
  CLASS_III: "Clase III",
};

/**
 * Pre-llena el summary ortodóntico con: dx (Angle Class, overbite,
 * overjet, crowding mm), técnica del plan, fase actual, mes en
 * tratamiento, duración estimada total. El médico lo edita libre.
 */
export async function buildOrthoSummary(args: {
  patientId: string;
  clinicId: string;
}): Promise<string> {
  const dx = await prisma.orthodonticDiagnosis.findFirst({
    where: { patientId: args.patientId, clinicId: args.clinicId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { patientId: args.patientId, clinicId: args.clinicId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      phases: { orderBy: { orderIndex: "asc" } },
    },
  });

  const lines: string[] = [];

  if (dx) {
    const angleR = ANGLE_CLASS_LABELS[dx.angleClassRight] ?? dx.angleClassRight;
    const angleL = ANGLE_CLASS_LABELS[dx.angleClassLeft] ?? dx.angleClassLeft;
    // Las medidas que no se capturaron (un 0 de relleno) no se dicen como dato: «sin capturar».
    const detalle = await cargarDiagnosticoDetalle(args.clinicId, dx.id).catch(() => null);
    const oj = medidaSinCapturar(detalle, "overjetMm") ? "sin capturar" : `${dx.overjetMm.toString()} mm`;
    const ob = medidaSinCapturar(detalle, "overbiteMm") ? "sin capturar" : `${dx.overbiteMm.toString()} mm`;
    lines.push(
      `Diagnóstico ortodóntico: Angle ${angleR} (derecha) / ${angleL} (izquierda). ` +
        `Overjet ${oj}, overbite ${ob}. ` +
        `Apiñamiento maxilar: ${
          dx.crowdingUpperMm != null ? dx.crowdingUpperMm.toString() : "—"
        } mm; mandibular: ${
          dx.crowdingLowerMm != null ? dx.crowdingLowerMm.toString() : "—"
        } mm.`,
    );
    if (dx.clinicalSummary) {
      lines.push(`Resumen del caso: ${dx.clinicalSummary}`);
    }
  } else {
    lines.push(
      "Sin diagnóstico ortodóntico capturado todavía. Pendiente de evaluación inicial.",
    );
  }

  if (plan) {
    const inProgress = plan.phases.find((p) => p.status === "IN_PROGRESS");
    const totalMonths = plan.estimatedDurationMonths;
    const installedAt = plan.installedAt
      ? new Date(plan.installedAt)
      : plan.startDate
        ? new Date(plan.startDate)
        : null;
    const monthsElapsed = installedAt
      ? Math.max(
          0,
          Math.round((Date.now() - installedAt.getTime()) / (30.44 * 24 * 3600 * 1000)),
        )
      : 0;
    const remaining = Math.max(0, totalMonths - monthsElapsed);

    // ws1-t10: la técnica propia de la clínica, si el caso la trae.
    // ws1-t4 (5e): en español, no el enum en crudo («metal brackets»).
    const tecnica = techniqueLabel(plan.technique, await cargarNombreDeTecnica(args.clinicId, plan.id));
    lines.push(
      `Plan activo: técnica ${tecnica}. Fase actual: ${
        inProgress ? inProgress.phaseKey : "no iniciada"
      }. Mes ${monthsElapsed}/${totalMonths}, restan aprox. ${remaining} meses.`,
    );
  } else {
    lines.push("Plan ortodóntico aún no formulado.");
  }

  lines.push(
    "Se solicita valoración / coordinación interdisciplinaria. Adjunta esta hoja " +
      "el resumen clínico relevante para continuar el caso.",
  );

  return lines.join("\n\n");
}
