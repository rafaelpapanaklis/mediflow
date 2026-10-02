import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { ATIENDE_WHERE } from "@/lib/agenda/roles-que-atienden";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  // ws1-t10 (revisión final, fallo 7): quien ATIENDE y está activo, no `role: "DOCTOR"` a secas. Lo lee el
  // doctor de la factura (invoice-editor-modal): el dueño o administrador que atiende no salía. Sin mirar
  // «Aparece en la agenda» (decisión de Rafael, 2-oct-2026: la casilla solo controla la agenda).
  const users = await prisma.user.findMany({
    where: {
      clinicId: session.clinic.id,
      ...ATIENDE_WHERE,
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
