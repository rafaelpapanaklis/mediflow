// GET /api/appointment-change-requests?status=PENDING|ALL   (WS1-T5, lado clínica)
// Lista de solicitudes de cambio de cita hechas por pacientes desde el portal.
// DOCTOR solo ve solicitudes de sus citas; demás roles ven toda la clínica.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";

export const dynamic = "force-dynamic";

function fullName(u: { firstName?: string | null; lastName?: string | null } | null | undefined): string | null {
  if (!u) return null;
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || null;
}

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "SUPER_ADMIN",
    "ADMIN",
    "RECEPTIONIST",
    "DOCTOR",
    "READONLY",
  ]);
  if (forbidden) return forbidden;

  const statusParam = (req.nextUrl.searchParams.get("status") || "PENDING").toUpperCase();

  const where: any = { clinicId: session.clinic.id };
  if (statusParam !== "ALL") {
    where.status = "PENDING";
  }
  // DOCTOR: solo solicitudes de SUS citas.
  if (session.user.role === "DOCTOR") {
    where.appointment = { doctorId: session.user.id };
  }

  try {
    const rows = await prisma.appointmentChangeRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        patient: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        appointment: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            type: true,
            status: true,
            doctorId: true,
            doctor: { select: { firstName: true, lastName: true } },
          },
        },
        resolvedBy: { select: { firstName: true, lastName: true } },
      },
    });

    const requests = rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      reason: r.reason ?? null,
      proposedStartsAt: r.proposedStartsAt ? r.proposedStartsAt.toISOString() : null,
      proposedEndsAt: r.proposedEndsAt ? r.proposedEndsAt.toISOString() : null,
      autoApproved: r.autoApproved,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolutionNote: r.resolutionNote ?? null,
      resolvedByName: fullName(r.resolvedBy),
      patient: {
        id: r.patient.id,
        firstName: r.patient.firstName,
        lastName: r.patient.lastName,
        phone: r.patient.phone,
      },
      appointment: {
        id: r.appointment.id,
        startsAt: r.appointment.startsAt.toISOString(),
        endsAt: r.appointment.endsAt.toISOString(),
        type: r.appointment.type,
        status: r.appointment.status,
        doctorId: r.appointment.doctorId,
        doctorName: fullName(r.appointment.doctor) ?? "—",
      },
    }));

    return NextResponse.json({ requests });
  } catch (err) {
    console.error("[GET /api/appointment-change-requests] error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
