// Periodontics — endpoint de búsqueda de pacientes para el picker
// "Iniciar sondaje". Devuelve hasta 50 pacientes activos de la clínica
// con su conteo de PeriodontalRecord para que el modal muestre badge
// "Sin sondaje" o "N sondajes".

import { NextResponse, type NextRequest } from "next/server";
import { differenceInYears } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";

export const dynamic = "force-dynamic";

export type SearchablePatient = {
  id: string;
  fullName: string;
  age: number | null;
  phone: string | null;
  perioRecordsCount: number;
};

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ error: "Categoría no válida" }, { status: 403 });
  }
  const access = await canAccessModule(ctx.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Módulo no activo" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const where: import("@prisma/client").Prisma.PatientWhereInput = {
    clinicId: ctx.clinicId,
    deletedAt: null,
    status: "ACTIVE",
  };
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { curp: { contains: q, mode: "insensitive" } },
      { patientNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const patients = await prisma.patient.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
      phone: true,
      _count: {
        select: {
          periodontalRecords: { where: { deletedAt: null } },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 50,
  });

  const now = new Date();
  const out: SearchablePatient[] = patients.map((p) => ({
    id: p.id,
    fullName: `${p.firstName} ${p.lastName}`.trim(),
    age: p.dob ? differenceInYears(now, p.dob) : null,
    phone: p.phone,
    perioRecordsCount: p._count.periodontalRecords,
  }));

  return NextResponse.json({ patients: out });
}
