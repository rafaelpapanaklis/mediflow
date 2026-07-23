import "server-only";
import { prisma } from "@/lib/prisma";
import { readCurrentEntries } from "@/lib/odontogram/snapshot";
import { SURFACE_NAMES, COND_BY_ID } from "@/components/dashboard/odontogram-v2/data";

interface Args {
  patientId: string;
  clinicId: string;
  userId: string;
  currentInput: { subjective?: string; objective?: string };
}

const MAX_CHARS = 12000;

function genderEs(g: any): string {
  if (g === "M") return "masculino";
  if (g === "F") return "femenino";
  return "no especificado";
}

/**
 * Arma un texto clínico compacto en español desde la BD, filtrado por clinicId.
 * El caller (route) YA validó que el paciente pertenece a la clínica y es visible,
 * así que las tablas sin clinicId (odontograma) se consultan por patientId con seguridad.
 */
export async function buildConsultContext(args: Args): Promise<string> {
  const { patientId, clinicId, userId, currentInput } = args;
  const L: string[] = [];

  // 1) Paciente
  const p = await prisma.patient.findFirst({
    where: { id: patientId, clinicId },
    select: {
      dob: true, gender: true, isChild: true, bloodType: true,
      allergies: true, chronicConditions: true, currentMedications: true,
      familyHistory: true, personalNonPathologicalHistory: true,
    },
  });
  if (p) {
    const age = p.dob ? new Date().getFullYear() - new Date(p.dob).getFullYear() : null;
    L.push("== PACIENTE ==");
    L.push(`Edad: ${age ?? "?"}${p.isChild ? " (pediátrico)" : ""} · Sexo: ${genderEs(p.gender)}${p.bloodType ? ` · Tipo de sangre: ${p.bloodType}` : ""}`);
    if (p.allergies?.length) L.push(`Alergias: ${p.allergies.join(", ")}`);
    if (p.chronicConditions?.length) L.push(`Padecimientos/condiciones: ${p.chronicConditions.join(", ")}`);
    if (p.currentMedications?.length) L.push(`Medicación actual: ${p.currentMedications.join(", ")}`);
    if (p.personalNonPathologicalHistory) L.push(`Antec. personales no patológicos: ${p.personalNonPathologicalHistory}`);
    if (p.familyHistory) L.push(`Antec. familiares: ${p.familyHistory}`);
  }

  // 2) Motivo / borrador de HOY
  const s = (currentInput?.subjective ?? "").trim();
  const o = (currentInput?.objective ?? "").trim();
  if (s || o) {
    L.push("\n== MOTIVO / HALLAZGOS DE HOY ==");
    if (s) L.push(`Subjetivo: ${s}`);
    if (o) L.push(`Objetivo: ${o}`);
  }

  // 3) Odontograma actual
  try {
    const entries = await readCurrentEntries(patientId);
    if (entries.length) {
      L.push("\n== ODONTOGRAMA ACTUAL ==");
      const byTooth: Record<number, string[]> = {};
      entries.forEach((e) => {
        const cond = COND_BY_ID[e.conditionId]?.es ?? e.conditionId;
        const surf = e.surface ? ` (${SURFACE_NAMES[e.surface as "M" | "D" | "V" | "L" | "O"]?.es ?? e.surface})` : "";
        (byTooth[e.toothNumber] ||= []).push(`${cond}${surf}`);
      });
      Object.keys(byTooth)
        .map(Number)
        .sort((a, b) => a - b)
        .forEach((t) => L.push(`Diente ${t}: ${byTooth[t].join("; ")}`));
    }
    // Notas por diente (__note__) — readCurrentEntries las excluye
    const notes = await prisma.odontogramEntry.findMany({
      where: { patientId, conditionId: "__note__" },
      select: { toothNumber: true, notes: true },
    });
    const withNote = notes.filter((n) => n.notes);
    if (withNote.length) {
      L.push("Notas por diente:");
      withNote.forEach((n) => L.push(`  Diente ${n.toothNumber}: ${n.notes}`));
    }
  } catch (e) {
    console.error("consult-context odontograma:", e);
  }

  // 4) Últimas 5 consultas (respeta isPrivate: públicas + propias del doctor)
  const records = await prisma.medicalRecord.findMany({
    where: { clinicId, patientId, OR: [{ isPrivate: false }, { doctorId: userId }] },
    orderBy: { visitDate: "desc" },
    take: 5,
    select: {
      visitDate: true, subjective: true, objective: true, assessment: true, plan: true,
      diagnoses_v2: { select: { isPrimary: true, cie10: { select: { code: true, description: true } } } },
    },
  });
  if (records.length) {
    L.push("\n== ÚLTIMAS CONSULTAS ==");
    records.forEach((r) => {
      const dx = (r.diagnoses_v2 ?? []).map((d) => `${d.cie10.code} ${d.cie10.description}`).join("; ");
      L.push(`[${new Date(r.visitDate).toLocaleDateString("es-MX")}]${dx ? ` · Dx: ${dx}` : ""}`);
      if (r.subjective) L.push(`  S: ${r.subjective}`);
      if (r.objective) L.push(`  O: ${r.objective}`);
      if (r.assessment) L.push(`  A: ${r.assessment}`);
      if (r.plan) L.push(`  P: ${r.plan}`);
    });
  }

  // 5) Recetas activas (nombre legible vía cums.descripcion)
  const rx = await prisma.prescription.findMany({
    where: { clinicId, patientId, status: "ACTIVE" },
    orderBy: { issuedAt: "desc" },
    take: 5,
    select: { issuedAt: true, items: { select: { dosage: true, cums: { select: { descripcion: true } } } } },
  });
  if (rx.length) {
    L.push("\n== RECETAS ACTIVAS ==");
    rx.forEach((r) => {
      const meds = (r.items ?? [])
        .map((i) => `${i.cums?.descripcion ?? "?"}${i.dosage ? ` (${i.dosage})` : ""}`)
        .join(", ");
      if (meds) L.push(`- ${meds}`);
    });
  }

  // 6) Tratamientos activos
  const tx = await prisma.treatmentPlan.findMany({
    where: { clinicId, patientId, status: "ACTIVE" },
    orderBy: { startDate: "desc" },
    take: 5,
    select: { name: true, description: true },
  });
  if (tx.length) {
    L.push("\n== TRATAMIENTOS ACTIVOS ==");
    tx.forEach((t) => L.push(`- ${t.name}${t.description ? `: ${t.description}` : ""}`));
  }

  // 7) Último análisis de radiografía
  const xray = await prisma.xrayAnalysis.findFirst({
    where: { clinicId, patientId },
    orderBy: { createdAt: "desc" },
    select: { summary: true },
  });
  if (xray?.summary) {
    L.push("\n== ÚLTIMO ANÁLISIS DE RADIOGRAFÍA ==");
    L.push(xray.summary.slice(0, 800));
  }

  // 8) Cuestionario de salud más reciente
  const hq = await prisma.healthQuestionnaire.findFirst({
    where: { clinicId, patientId },
    orderBy: { filledAt: "desc" },
    select: { answers: true },
  });
  if (hq?.answers) {
    L.push("\n== CUESTIONARIO DE SALUD ==");
    L.push(JSON.stringify(hq.answers).slice(0, 800));
  }

  let text = L.join("\n").trim();
  if (!text) text = "Sin datos clínicos registrados para este paciente.";
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n…(contexto recortado)";
  return text;
}
