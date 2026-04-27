import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const users = await prisma.user.findMany({
    where: {
      clinicId: session.clinic.id,
      role: "DOCTOR",
      isActive: true,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      color: true,
      agendaActive: true,
    },
    orderBy: { firstName: "asc" },
  });

  const doctors = users.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    avatarUrl: u.avatarUrl ?? null,
    color: u.color,
    activeInAgenda: u.agendaActive,
  }));

  return NextResponse.json({ doctors });
}
