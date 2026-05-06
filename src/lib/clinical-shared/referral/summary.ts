// Clinical-shared — generación del resumen clínico para hojas de referencia.
//
// El summary se pre-llena en el form para que el médico solo lo edite
// (no que lo escriba desde cero). Cada módulo aporta un builder; aquí
// solo Pediatría — los demás agentes pondrán los suyos.

import { prisma } from "@/lib/prisma";
import { calculateAge } from "@/lib/pediatrics/age";
import { FRANKL_LABELS, isFranklValue } from "@/lib/pediatrics/frankl";

export interface PediatricSummaryArgs {
  patientId: string;
  clinicId: string;
}

/**
 * Construye un resumen multilinea con: edad, género, conducta Frankl
 * vigente, hábitos orales activos, alergias y categoría CAMBRA.
 * Devuelve string vacío si no se encuentra el paciente o no es pediátrico.
 */
export async function buildPediatricSummary(args: PediatricSummaryArgs): Promise<string> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: {
      firstName: true,
      lastName: true,
      dob: true,
      gender: true,
      allergies: true,
      clinicId: true,
      deletedAt: true,
    },
  });
  if (!patient || patient.deletedAt) return "";
  if (patient.clinicId !== args.clinicId) return "";

  const age = patient.dob ? calculateAge(patient.dob, new Date()) : null;
  const lines: string[] = [];

  // Datos de identificación clínica
  lines.push(
    `Paciente pediátrico ${patient.firstName} ${patient.lastName}, ${
      age ? age.long : "edad sin registrar"
    }${patient.gender ? `, ${humanizeGender(patient.gender)}` : ""}.`,
  );

  // Conducta — última Frankl
  const lastBehavior = await prisma.behaviorAssessment.findFirst({
    where: { patientId: args.patientId, clinicId: args.clinicId, deletedAt: null },
    orderBy: { recordedAt: "desc" },
    select: { scale: true, value: true, recordedAt: true },
  });
  if (lastBehavior) {
    const v = lastBehavior.value;
    if (lastBehavior.scale === "frankl" && isFranklValue(v)) {
      lines.push(`Conducta Frankl ${v} (${FRANKL_LABELS[v]}).`);
    } else if (lastBehavior.scale === "venham") {
      lines.push(`Conducta Venham ${v}/5.`);
    }
  }

  // Riesgo cariogénico CAMBRA
  const lastCambra = await prisma.cariesRiskAssessment.findFirst({
    where: { patientId: args.patientId, clinicId: args.clinicId, deletedAt: null },
    orderBy: { scoredAt: "desc" },
    select: { category: true },
  });
  if (lastCambra) {
    lines.push(`Riesgo cariogénico CAMBRA: ${lastCambra.category}.`);
  }

  // Hábitos orales activos (sin endedAt)
  const habits = await prisma.oralHabit.findMany({
    where: {
      patientId: args.patientId,
      clinicId: args.clinicId,
      endedAt: null,
      deletedAt: null,
    },
    select: { habitType: true, frequency: true },
  });
  if (habits.length > 0) {
    const items = habits.map((h) => `${h.habitType} (${h.frequency})`).join(", ");
    lines.push(`Hábitos orales activos: ${items}.`);
  }

  // Alergias
  if (patient.allergies.length > 0) {
    lines.push(`Alergias declaradas: ${patient.allergies.join(", ")}.`);
  } else {
    lines.push("Sin alergias declaradas.");
  }

  // Tratamientos pediátricos relevantes resumidos
  const sealants = await prisma.sealant.count({
    where: { patientId: args.patientId, clinicId: args.clinicId },
  });
  const fluorides = await prisma.fluorideApplication.count({
    where: { patientId: args.patientId, clinicId: args.clinicId },
  });
  if (sealants > 0 || fluorides > 0) {
    const summary: string[] = [];
    if (sealants > 0) summary.push(`${sealants} sellante(s) aplicado(s)`);
    if (fluorides > 0) summary.push(`${fluorides} aplicación(es) de flúor`);
    lines.push(`Historial preventivo: ${summary.join(", ")}.`);
  }

  return lines.join("\n\n");
}

function humanizeGender(g: string): string {
  switch (g) {
    case "MALE":
      return "masculino";
    case "FEMALE":
      return "femenino";
    case "OTHER":
      return "otro";
    default:
      return g.toLowerCase();
  }
}
