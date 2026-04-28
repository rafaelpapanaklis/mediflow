import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { chat } from "@/lib/integrations/claude";

export const dynamic = "force-dynamic";

/**
 * POST /api/analytics/no-shows/predict
 * Body: { appointmentId: string }
 *
 * Genera predicción de no-show para una cita futura. Recolecta factores
 * (historial paciente, día/hora, tipo, gap desde última cita) y se los
 * pasa a Claude Sonnet 4.6 con un system prompt structured-output.
 *
 * Persiste resultado en NoShowPrediction (upsert por appointmentId).
 *
 * Multi-tenant: validamos que el appointment pertenezca a la clínica del
 * usuario antes de tocar IA o persistir.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  let body: { appointmentId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.appointmentId) {
    return NextResponse.json({ error: "missing_appointmentId" }, { status: 400 });
  }

  // Tenant scope: el appointment DEBE pertenecer al clinicId del usuario.
  const appt = await prisma.appointment.findFirst({
    where: { id: body.appointmentId, clinicId },
    select: {
      id: true,
      type: true,
      startsAt: true,
      patientId: true,
      patient: {
        select: { firstName: true, lastName: true, dob: true },
      },
    },
  });
  if (!appt) {
    return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });
  }

  // Histórico del paciente (mismo clinicId por defecto vía where).
  const patientHistory = await prisma.appointment.findMany({
    where: {
      clinicId,
      patientId: appt.patientId,
      startsAt: { lt: appt.startsAt },
    },
    select: { status: true, startsAt: true },
    orderBy: { startsAt: "desc" },
    take: 20,
  });

  const totalPast = patientHistory.length;
  const pastNoShows = patientHistory.filter((a) => a.status === "NO_SHOW").length;
  const pastCancelled = patientHistory.filter((a) => a.status === "CANCELLED").length;
  const pastCompleted = patientHistory.filter(
    (a) => a.status === "COMPLETED" || a.status === "CHECKED_OUT",
  ).length;
  const lastVisit = patientHistory[0]?.startsAt ?? null;
  const daysSinceLastVisit = lastVisit
    ? Math.round((appt.startsAt.getTime() - lastVisit.getTime()) / 86400000)
    : null;

  const dayOfWeek = (appt.startsAt.getDay() + 6) % 7;
  const dowLabel = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"][dowIndexSafe(dayOfWeek)];
  const hour = appt.startsAt.getHours();

  // No-show rate de la clínica para el día/hora (contexto comparativo).
  const sameSlotAppts = await prisma.appointment.findMany({
    where: {
      clinicId,
      startsAt: { lt: appt.startsAt },
    },
    select: { status: true, startsAt: true },
    take: 500,
  });
  const sameSlotMatch = sameSlotAppts.filter((a) => {
    const d = new Date(a.startsAt);
    return (d.getDay() + 6) % 7 === dayOfWeek && d.getHours() === hour;
  });
  const clinicSlotNoShowRate = sameSlotMatch.length > 0
    ? sameSlotMatch.filter((a) => a.status === "NO_SHOW").length / sameSlotMatch.length
    : null;

  // Heurística baseline (fallback si IA falla).
  const factors: Array<{ label: string; weight: number; reason: string }> = [];
  let baselineProb = 0.1;

  if (totalPast >= 3) {
    const personalRate = pastNoShows / totalPast;
    factors.push({
      label: "Historial del paciente",
      weight: 0.4,
      reason: `${pastNoShows}/${totalPast} no-shows previos (${Math.round(personalRate * 100)}%)`,
    });
    baselineProb += personalRate * 0.4;
  } else {
    factors.push({
      label: "Historial del paciente",
      weight: 0.05,
      reason: `Solo ${totalPast} citas previas — datos insuficientes`,
    });
  }

  if (clinicSlotNoShowRate != null && sameSlotMatch.length >= 5) {
    factors.push({
      label: `${dowLabel} ${hour}:00 en esta clínica`,
      weight: 0.25,
      reason: `${Math.round(clinicSlotNoShowRate * 100)}% no-shows históricos en ese slot`,
    });
    baselineProb += clinicSlotNoShowRate * 0.25;
  }

  if (daysSinceLastVisit != null && daysSinceLastVisit > 180) {
    factors.push({
      label: "Tiempo desde última visita",
      weight: 0.15,
      reason: `${daysSinceLastVisit} días sin venir — paciente reactivado, riesgo medio`,
    });
    baselineProb += 0.10;
  } else if (daysSinceLastVisit == null) {
    factors.push({
      label: "Primera cita registrada",
      weight: 0.10,
      reason: "Paciente nuevo o sin historial — riesgo base",
    });
    baselineProb += 0.05;
  }

  if (pastCancelled >= 2) {
    factors.push({
      label: "Cancelaciones previas",
      weight: 0.15,
      reason: `${pastCancelled} cancelaciones registradas`,
    });
    baselineProb += 0.05 * Math.min(3, pastCancelled);
  }

  baselineProb = Math.min(0.95, Math.max(0.02, baselineProb));

  // IA refinement (opcional, si key disponible). Si Claude falla
  // mantenemos baseline.
  const aiResult = await chat({
    system: AI_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          patient: {
            ageYears: appt.patient?.dob
              ? Math.floor((Date.now() - appt.patient.dob.getTime()) / (365.25 * 86400000))
              : null,
            totalPastAppointments: totalPast,
            pastNoShows,
            pastCancelled,
            pastCompleted,
            daysSinceLastVisit,
          },
          appointment: {
            type: appt.type,
            dayOfWeek: dowLabel,
            hour,
            daysFromNow: Math.round((appt.startsAt.getTime() - Date.now()) / 86400000),
          },
          clinicSlotNoShowRate,
          baselineProb,
        }),
      },
    ],
    maxTokens: 300,
  });

  let probability = baselineProb;
  let aiFactors: Array<{ label: string; weight: number; reason: string }> = [];
  if (!aiResult.error && aiResult.text) {
    const parsed = parseAIProbability(aiResult.text);
    if (parsed) {
      probability = parsed.probability;
      aiFactors = parsed.factors;
    }
  }

  const finalFactors = aiFactors.length > 0 ? aiFactors : factors;

  // Persist (upsert por appointmentId — único). El where appointment.clinicId
  // ya está garantizado porque validamos arriba que el appointment pertenece
  // a la clínica del usuario.
  const persisted = await prisma.noShowPrediction.upsert({
    where: { appointmentId: appt.id },
    create: {
      appointmentId: appt.id,
      probability,
      factors: finalFactors,
    },
    update: {
      probability,
      factors: finalFactors,
      predictedAt: new Date(),
    },
  });

  return NextResponse.json({
    appointmentId: persisted.appointmentId,
    probability,
    factors: finalFactors,
    aiUsed: !aiResult.error && !aiResult.mock,
    predictedAt: persisted.predictedAt.toISOString(),
  });
}

function dowIndexSafe(idx: number): number {
  return Math.min(6, Math.max(0, idx));
}

const AI_SYSTEM_PROMPT = `Eres un modelo de riesgo de no-show para clínicas.
Recibes un JSON con: paciente (totalPastAppointments, pastNoShows, etc.),
appointment (type, dayOfWeek, hour, daysFromNow), clinicSlotNoShowRate
(opcional), baselineProb (heurística previa).

Responde SOLO con JSON válido en el formato:
{
  "probability": <number 0..1>,
  "factors": [
    { "label": "...", "weight": <0..1>, "reason": "..." }
  ]
}

Reglas:
- factors: 2-4 entries, los más relevantes que justifiquen la probability.
- Si hay pocos datos (totalPastAppointments < 3), probability cercana a baselineProb y declara "datos insuficientes" en algún reason.
- weights aproximados que sumen ~1.0.
- NO inventes datos no presentes en el JSON.
- Responde SOLO con el JSON, sin texto antes o después.`;

function parseAIProbability(text: string): { probability: number; factors: Array<{ label: string; weight: number; reason: string }> } | null {
  try {
    const trimmed = text.trim();
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.probability !== "number") return null;
    if (!Array.isArray(parsed.factors)) return null;
    return {
      probability: Math.min(0.99, Math.max(0.01, parsed.probability)),
      factors: parsed.factors.slice(0, 5).map((f: { label?: unknown; weight?: unknown; reason?: unknown }) => ({
        label: String(f.label ?? ""),
        weight: typeof f.weight === "number" ? f.weight : 0,
        reason: String(f.reason ?? ""),
      })),
    };
  } catch {
    return null;
  }
}
