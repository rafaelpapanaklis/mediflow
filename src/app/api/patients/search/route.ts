import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { patientVisibilityAnd } from "@/lib/patient-visibility";

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ hits: [] }, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const where = {
    clinicId: session.clinic.id,
    AND: [
      // Visibilidad por paciente: la búsqueda rápida filtraba SOLO por clinicId,
      // así que un paciente restringido se encontraba igual por nombre/teléfono.
      // Se aplica la regla PURA de visibleUserIds (sin las heurísticas de doctor
      // de buildPatientWhere) a propósito: un paciente sin lista se sigue
      // encontrando desde cualquier rol, que es como funciona hoy — agendar
      // exige poder buscar a quien todavía no es "tuyo".
      ...patientVisibilityAnd({
        userId: session.user.id,
        role: session.user.role,
        clinicId: session.clinic.id,
      }),
      ...tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName:  { contains: t, mode: "insensitive" as const } },
          { phone:     { contains: t } },
          { email:     { contains: t, mode: "insensitive" as const } },
        ],
      })),
    ],
  };

  const rows = await prisma.patient.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 12,
  });

  const hits = rows.map((p) => ({
    id: p.id,
    name: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
    phone: p.phone ?? null,
  }));

  return NextResponse.json({ hits }, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
