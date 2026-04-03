import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const dbUser = await prisma.user.findUnique({ where: { supabaseId: user.id } });
    if (!dbUser) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const clinicId = dbUser.clinicId;
    const today = new Date(); today.setHours(0,0,0,0);
    const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const [todayAppts, monthPatients, monthRevenue] = await Promise.all([
      prisma.appointment.findMany({ where: { clinicId, date: { gte: today, lte: todayEnd } }, include: { patient: true, doctor: true }, orderBy: { startTime: "asc" } }),
      prisma.patient.count({ where: { clinicId, createdAt: { gte: firstOfMonth } } }),
      prisma.invoice.aggregate({ where: { clinicId, status: { in: ["PAID","PARTIAL"] }, createdAt: { gte: firstOfMonth } }, _sum: { paid: true } }),
    ]);
    return NextResponse.json({ todayAppointments: todayAppts, monthPatients, monthRevenue: monthRevenue._sum.paid ?? 0 });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
