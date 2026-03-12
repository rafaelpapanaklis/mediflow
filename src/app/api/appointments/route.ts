import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { appointmentSchema } from "@/lib/validations";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.user.findUnique({ where: { supabaseId: user.id } });
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date  = searchParams.get("date");
  const month = searchParams.get("month");

  const where: any = { clinicId: dbUser.clinicId };

  if (date) {
    const d = new Date(date + "T00:00:00"); const end = new Date(date + "T23:59:59");
    where.date = { gte: d, lte: end };
  }
  if (month) {
    const [y, m] = month.split("-").map(Number);
    where.date = { gte: new Date(y, m-1, 1), lte: new Date(y, m, 0, 23, 59, 59) };
  }

  const appointments = await prisma.appointment.findMany({
    where,
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return NextResponse.json(appointments);
}

export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const data = appointmentSchema.parse(body);
    const appointment = await prisma.appointment.create({
      data: { ...data, clinicId: dbUser.clinicId, date: new Date(data.date), status: "PENDING" },
      include: { patient: true, doctor: true },
    });
    return NextResponse.json(appointment, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
