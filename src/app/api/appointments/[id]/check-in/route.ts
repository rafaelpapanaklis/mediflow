import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  const existing = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (
    existing.status === "CHECKED_IN" ||
    existing.status === "IN_PROGRESS" ||
    existing.status === "COMPLETED"
  ) {
    return NextResponse.json(
      { error: "already_checked_in", currentStatus: existing.status },
      { status: 409 },
    );
  }
  if (existing.status === "CANCELLED" || existing.status === "NO_SHOW") {
    return NextResponse.json(
      { error: "invalid_state_for_check_in", currentStatus: existing.status },
      { status: 409 },
    );
  }

  const now = new Date();
  await prisma.appointment.update({
    where: { id: params.id },
    data: {
      status: "CHECKED_IN",
      checkedInAt: now,
    },
  });

  return NextResponse.json({
    ok: true,
    status: "CHECKED_IN",
    checkedInAt: now.toISOString(),
    minutesWaiting: 0,
  });
}
