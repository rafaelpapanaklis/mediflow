import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";

export async function DELETE(
  req: NextRequest,
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

  const existing = await prisma.waitlistEntry.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, resolvedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.resolvedAt) {
    return NextResponse.json({ ok: true });
  }

  const resolvedAppointmentId =
    req.nextUrl.searchParams.get("resolvedAppointmentId");

  await prisma.waitlistEntry.update({
    where: { id: params.id },
    data: {
      resolvedAt: new Date(),
      resolvedAppointmentId: resolvedAppointmentId ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
