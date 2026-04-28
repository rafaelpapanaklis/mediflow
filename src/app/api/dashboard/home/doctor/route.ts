import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { fetchAppointmentsForDay } from "@/lib/agenda/server";
import { todayInTz } from "@/lib/agenda/time-utils";
import type { HomeDoctorData, PatientAlerts } from "@/lib/home/types";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const doctorId = session.user.id;
  const dateISO = todayInTz(session.clinic.timezone);

  const [todayAppts, draftNotes, unanalyzedXrays, unsignedConsents, recent] =
    await Promise.all([
      fetchAppointmentsForDay(dateISO, session.timeConfig, {
        clinicId: session.clinic.id,
        clinicCategory: session.clinic.category,
        doctorIdScope: doctorId,
      }),
      countDraftNotes(session.clinic.id, doctorId),
      countUnanalyzedXrays(session.clinic.id, doctorId),
      countUnsignedConsents(session.clinic.id, doctorId),
      fetchRecentPatients(session.clinic.id, doctorId),
    ]);

  // Próxima cita = primera con startsAt >= now y status no terminal
  const now = Date.now();
  const upcoming = todayAppts.filter((a) => {
    if (a.status === "COMPLETED") return false;
    if (a.status === "CANCELLED") return false;
    if (a.status === "NO_SHOW") return false;
    return new Date(a.startsAt).getTime() >= now - 5 * 60_000;
  });
  const nextRaw = upcoming[0] ?? null;

  let nextAppointment: HomeDoctorData["nextAppointment"] = null;
  if (nextRaw) {
    const patient = await prisma.patient.findUnique({
      where: { id: nextRaw.patient.id },
      select: {
        dob: true,
        gender: true,
        allergies: true,
        currentMedications: true,
        chronicConditions: true,
      },
    });

    const age = patient?.dob ? computeAge(patient.dob) : undefined;
    const gender = mapGender(patient?.gender);

    const alerts: PatientAlerts = {
      allergies: cleanArray(patient?.allergies),
      medications: cleanArray(patient?.currentMedications),
      conditions: cleanArray(patient?.chronicConditions),
    };

    nextAppointment = {
      ...nextRaw,
      patientAge: age,
      patientGender: gender,
      patientAlerts: alerts,
    };
  }

  const completedToday = todayAppts.filter((a) => a.status === "COMPLETED").length;

  const data: HomeDoctorData = {
    nextAppointment,
    todayAppointments: todayAppts,
    pendingTasks: {
      draftNotes,
      unanalyzedXrays,
      unsignedConsents,
    },
    recentPatients: recent,
    completedToday,
  };

  return NextResponse.json(data);
}

// ─── Helpers ──────────────────────────────────────────────────────

function computeAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

function mapGender(g: string | null | undefined): "F" | "M" | "O" | undefined {
  if (!g) return undefined;
  const u = g.toUpperCase();
  if (u === "F" || u === "FEMALE" || u === "FEMENINO") return "F";
  if (u === "M" || u === "MALE" || u === "MASCULINO") return "M";
  return "O";
}

function cleanArray(arr: string[] | null | undefined): string[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  const out = arr.map((s) => s.trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

/**
 * Schema no tiene ClinicalNote con status="DRAFT" — MedicalRecord existe
 * pero sin noción de borrador. Degradado a 0 hasta que se agregue el modelo
 * o un campo tipo `signedAt: null` para marcar borrador.
 */
async function countDraftNotes(_clinicId: string, _doctorId: string): Promise<number> {
  return 0;
}

/**
 * "Unanalyzed xrays" = PatientFile con category XRAY_* sin XrayAnalysis
 * relacionado, subido por el doctor (uploadedBy).
 */
async function countUnanalyzedXrays(clinicId: string, doctorId: string): Promise<number> {
  try {
    return await prisma.patientFile.count({
      where: {
        clinicId,
        uploadedBy: doctorId,
        category: {
          in: [
            "XRAY_PERIAPICAL",
            "XRAY_PANORAMIC",
            "XRAY_BITEWING",
            "XRAY_OCCLUSAL",
          ],
        },
        xrayAnalysis: { is: null },
      },
    });
  } catch {
    return 0;
  }
}

/**
 * ConsentForm no tiene requestedById en el schema — sin forma de filtrar
 * por doctor. Degradado a 0.
 */
async function countUnsignedConsents(
  _clinicId: string,
  _doctorId: string,
): Promise<number> {
  return 0;
}

async function fetchRecentPatients(clinicId: string, doctorId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.appointment.findMany({
    where: {
      clinicId,
      doctorId,
      status: "COMPLETED",
      startsAt: { gte: since },
    },
    select: {
      startsAt: true,
      patient: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { startsAt: "desc" },
    take: 30,
  });

  const seen = new Set<string>();
  const out: HomeDoctorData["recentPatients"] = [];
  for (const r of rows) {
    if (seen.has(r.patient.id)) continue;
    seen.add(r.patient.id);
    out.push({
      id: r.patient.id,
      name: [r.patient.firstName, r.patient.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
      lastVisitAt: r.startsAt.toISOString(),
    });
    if (out.length >= 10) break;
  }
  return out;
}
