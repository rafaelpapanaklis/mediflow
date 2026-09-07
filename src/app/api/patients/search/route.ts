import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { patientSearchTokens } from "@/lib/patients/patient-search-core";
import { findPatientIdsBySearch } from "@/lib/patients/patient-search";

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ hits: [] }, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  }

  // 38 — este es el buscador de «Nueva cita». Tres cosas que no hacía:
  //   a) ignorar ACENTOS: "Perez" no encontraba a "Pérez" (ILIKE arregla las
  //      mayúsculas, no las tildes);
  //   b) normalizar el TELÉFONO: pegar "5512345678" no encontraba a quien está
  //      guardado como "+52 55 1234 5678";
  //   c) buscar por FOLIO: tecleando "P0042" —lo que trae impreso el recibo del
  //      paciente— no salía nadie, porque patientNumber no estaba en el where.
  // Las tres las resuelve la consulta normalizada; si falla, se cae al criterio
  // de siempre (abajo) y el buscador sigue funcionando como hoy.
  const tokens = q.split(/\s+/).filter(Boolean);
  const matchIds = await findPatientIdsBySearch({
    clinicIds: [session.clinic.id],
    tokens: patientSearchTokens(q),
    limit: 200,
  });
  const where = {
    clinicId: session.clinic.id,
    // ARCO (P2): un paciente cancelado (deletedAt ≠ null) no aparece en el
    // buscador — mismo filtro que buildPatientWhere aplica a las listas.
    deletedAt: null,
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
      ...(matchIds !== null
        ? [{ id: { in: matchIds } }]
        : tokens.map((t) => ({
            OR: [
              { firstName: { contains: t, mode: "insensitive" as const } },
              { lastName:  { contains: t, mode: "insensitive" as const } },
              { phone:     { contains: t } },
              { email:     { contains: t, mode: "insensitive" as const } },
              { patientNumber: { contains: t, mode: "insensitive" as const } },
            ],
          }))),
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
