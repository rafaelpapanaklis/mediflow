import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/tv/[slug]/operational
 *
 * Endpoint público (sin auth) para que la pantalla TV cargue datos.
 * El slug del path resuelve el TVDisplay y desde ahí derivamos clinicId.
 * SOLO data de la clínica dueña del slug, nunca de otra.
 *
 * Esta es la ÚNICA excepción al patrón "clinicId desde getCurrentUser":
 * aquí viene del TV display row porque es una vista pública sin sesión.
 *
 * Ratelimit implícito: vista TV refresca cada 15s = ~5760 req/día por
 * pantalla. Aceptable. Si abusan, puede agregarse rate limit por IP.
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  // Resuelve clinicId desde el slug (NO confía en query params).
  const display = await prisma.tVDisplay.findUnique({
    where: { publicSlug: params.slug },
    select: { id: true, clinicId: true, active: true },
  });
  if (!display || !display.active) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const clinicId = display.clinicId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const now = new Date();

  // Pulls citas de HOY de la clínica (clinicId scoped, derivado del display).
  const appts = await prisma.appointment.findMany({
    where: {
      clinicId,
      startsAt: { gte: today, lt: tomorrow },
      status: { in: ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] },
    },
    select: {
      id: true,
      startsAt: true,
      type: true,
      status: true,
      patient: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } },
      timeline: { select: { arrivedAt: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  function toItem(a: typeof appts[0]) {
    const patient = a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : "Paciente";
    const initials = a.patient
      ? `${(a.patient.firstName[0] ?? "").toUpperCase()}${(a.patient.lastName[0] ?? "").toUpperCase()}`
      : "—";
    const doctor = a.doctor ? `Dr/a. ${a.doctor.lastName}` : "";
    const arrivedAt = a.timeline?.arrivedAt;
    const waitedMin = arrivedAt
      ? Math.max(0, Math.round((now.getTime() - arrivedAt.getTime()) / 60_000))
      : null;
    return {
      appointmentId: a.id,
      patient,
      initials,
      type: a.type,
      doctor,
      status: a.status,
      waitedMin,
      startsAt: a.startsAt.toISOString(),
    };
  }

  return NextResponse.json({
    now: now.toISOString(),
    inProgress: appts.filter((a) => a.status === "IN_PROGRESS").map(toItem),
    upNext:     appts.filter((a) => a.status === "IN_CHAIR").map(toItem),
    waiting:    appts.filter((a) => a.status === "CHECKED_IN").map(toItem),
  });
}
