import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { appointmentToDTO } from "@/lib/agenda/server";
import {
  canTransition,
  sideEffectsOf,
  timelineFieldFor,
} from "@/lib/agenda/transitions";
import type { StatusChangeInput } from "@/lib/agenda/types";

const APPT_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  doctor:  { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  let body: StatusChangeInput;
  try {
    body = (await req.json()) as StatusChangeInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.status) {
    return NextResponse.json({ error: "missing_status" }, { status: 400 });
  }

  const existing = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, status: true, startsAt: true, doctorId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (
    session.user.role === "DOCTOR" &&
    existing.doctorId !== session.user.id
  ) {
    return NextResponse.json({ error: "not_your_appointment" }, { status: 403 });
  }

  const now = new Date();
  if (existing.status === "PENDING") {
    return NextResponse.json(
      { error: "legacy_status", reason: "Status PENDING ya no soportado. Migrá a SCHEDULED." },
      { status: 409 },
    );
  }
  const check = canTransition(
    existing.status as Exclude<typeof existing.status, "PENDING">,
    body.status,
    session.user.role,
    now,
    existing.startsAt,
  );
  if (!check.ok) {
    return NextResponse.json(
      { error: "invalid_transition", reason: check.error },
      { status: 409 },
    );
  }

  const sideEffects = sideEffectsOf(body.status, now);

  const updated = await prisma.appointment.update({
    where: { id: params.id },
    data: {
      status: body.status,
      ...sideEffects,
    },
    include: APPT_INCLUDE,
  });

  // Instrumentación de tiempos para analytics. Cada transición de status
  // upsert el campo correspondiente del AppointmentTimeline. Si la cita
  // recién entra al ciclo (no había timeline aún), creamos el row con
  // appointmentId + el primer campo. En transiciones siguientes, update.
  // Calculamos totalWaitMin/totalConsultMin cuando ambos extremos existen.
  const timelineField = timelineFieldFor(body.status);
  if (timelineField) {
    const existing = await prisma.appointmentTimeline.findUnique({
      where: { appointmentId: params.id },
    });
    const next = { ...(existing ?? {}), [timelineField]: now };
    const totalWaitMin =
      next.arrivedAt && next.inChairAt
        ? Math.max(0, Math.round((next.inChairAt.getTime() - next.arrivedAt.getTime()) / 60_000))
        : next.arrivedAt && next.consultStartAt
          ? Math.max(0, Math.round((next.consultStartAt.getTime() - next.arrivedAt.getTime()) / 60_000))
          : null;
    const totalConsultMin =
      next.consultStartAt && next.consultEndAt
        ? Math.max(0, Math.round((next.consultEndAt.getTime() - next.consultStartAt.getTime()) / 60_000))
        : null;
    await prisma.appointmentTimeline.upsert({
      where: { appointmentId: params.id },
      create: {
        appointmentId: params.id,
        [timelineField]: now,
        totalWaitMin,
        totalConsultMin,
      },
      update: {
        [timelineField]: now,
        ...(totalWaitMin !== null ? { totalWaitMin } : {}),
        ...(totalConsultMin !== null ? { totalConsultMin } : {}),
      },
    });
  }

  return NextResponse.json(
    { appointment: appointmentToDTO(updated, session.clinic.category) },
  );
}
