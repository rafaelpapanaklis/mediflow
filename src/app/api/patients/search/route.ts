import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ hits: [] });
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const where = {
    clinicId: session.clinic.id,
    AND: tokens.map((t) => ({
      OR: [
        { firstName: { contains: t, mode: "insensitive" as const } },
        { lastName:  { contains: t, mode: "insensitive" as const } },
        { phone:     { contains: t } },
        { email:     { contains: t, mode: "insensitive" as const } },
      ],
    })),
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

  return NextResponse.json({ hits });
}
