// Orthodontics — endpoint de contexto para integraciones (modal de cita,
// SOAP pre-fill, badge en odontograma). SPEC §8.10.

import { NextResponse, type NextRequest } from "next/server";
import { differenceInMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { suggestOrthoAppointmentDuration } from "@/lib/orthodontics/appointment-durations";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { loadOrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patientId = req.nextUrl.searchParams.get("patientId");
  const reason = req.nextUrl.searchParams.get("reason") ?? "";

  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ orthodontics: false });
  }
  // Ola 1 (ws1-t3, A1): guarda REAL (ClinicModule activo), no el atajo de
  // trial de canAccessModule/evaluateAccess — ver src/lib/orthodontics/access.ts.
  // Este endpoint alimenta los chips de motivo de new-appointment-dialog.tsx:
  // con el atajo de trial, cualquier clínica dental en prueba los vería sin
  // haber contratado el módulo.
  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
    return NextResponse.json({ orthodontics: false });
  }

  // Sin patientId, devolvemos flag + catálogo de tipos de cita (C7) +
  // suggestion de duración — es lo que pide new-appointment-dialog.tsx.
  if (!patientId) {
    const settings = await loadOrthoClinicSettings(ctx.clinicId);
    return NextResponse.json({
      orthodontics: true,
      moduleActive: true,
      appointmentTypes: settings.appointmentTypes.map((t) => t.label),
      // Sección I: los minutos que la clínica fijó por tipo en Configuración,
      // para que «Nueva cita» proponga la duración al elegir el motivo
      // (`duracionSugeridaDeOrtodoncia`). `null` = sin valor propio.
      appointmentTypeDurations: settings.appointmentTypes.map((t) => ({
        label: t.label,
        durationMin: typeof t.durationMin === "number" && t.durationMin > 0 ? t.durationMin : null,
      })),
      appointmentDuration: suggestOrthoAppointmentDuration(reason),
    });
  }

  // Visibilidad por paciente: solo a partir de aquí se lee data del paciente;
  // sin este gate se expondría su plan ortodóntico con solo su id.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({
      orthodontics: true,
      moduleActive: true,
      hasActivePlan: false,
      appointmentDuration: suggestOrthoAppointmentDuration(reason),
    });
  }

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      patientId,
      clinicId: ctx.clinicId,
      deletedAt: null,
      status: { in: ["IN_PROGRESS", "RETENTION", "ON_HOLD"] },
    },
    include: {
      phases: {
        where: { status: "IN_PROGRESS" },
        select: { phaseKey: true },
      },
      paymentPlan: { select: { status: true } },
    },
  });

  return NextResponse.json({
    orthodontics: true,
    moduleActive: true,
    hasActivePlan: Boolean(plan),
    technique: plan?.technique ?? null,
    currentPhase: plan?.phases[0]?.phaseKey ?? null,
    monthInTreatment: plan?.installedAt
      ? Math.max(0, differenceInMonths(new Date(), plan.installedAt))
      : null,
    paymentStatus: plan?.paymentPlan?.status ?? null,
    appointmentDuration: suggestOrthoAppointmentDuration(reason),
  });
}
