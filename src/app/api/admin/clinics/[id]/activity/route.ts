import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = params.id;
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [
    users,
    lastAppointment,
    lastInvoice,
    lastRecord,
    lastPatient,
    lastFile,
    lastAudit,
    dailyAudit,
    userActivity,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId },
      orderBy: { lastLogin: "desc" },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, lastLogin: true },
    }),
    prisma.appointment.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, date: true, type: true, createdAt: true, patient: { select: { firstName: true, lastName: true } } },
    }),
    prisma.invoice.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, invoiceNumber: true, total: true, createdAt: true },
    }),
    prisma.medicalRecord.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, visitDate: true, createdAt: true, patient: { select: { firstName: true, lastName: true } }, doctor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.patient.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, firstName: true, lastName: true, createdAt: true },
    }),
    prisma.patientFile.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, category: true, createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, action: true, entityType: true, createdAt: true },
    }),
    // Raw timestamps últimos 30 días — agrupamos por día en memoria
    prisma.auditLog.findMany({
      where: { clinicId, createdAt: { gte: since } },
      select: { createdAt: true },
    }).catch(() => [] as { createdAt: Date }[]),
    // Actividad por usuario
    prisma.auditLog.groupBy({
      by: ["userId"],
      where: { clinicId, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
    }).catch(() => [] as any[]),
  ]);

  // Agrupa auditLog por día (YYYY-MM-DD)
  const byDay = new Map<string, number>();
  for (const row of dailyAudit as { createdAt: Date }[]) {
    const key = new Date(row.createdAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: byDay.get(key) ?? 0 });
  }

  const userIds = (userActivity as any[]).map(u => u.userId).filter(Boolean);
  const userMap = userIds.length
    ? Object.fromEntries(
        (await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })).map(u => [u.id, u]),
      )
    : {};

  return NextResponse.json({
    users,
    timeline: {
      lastAppointment,
      lastInvoice,
      lastRecord,
      lastPatient,
      lastFile,
      lastAudit,
    },
    dailyActivity: days,
    userActivity: (userActivity as any[]).map(row => ({
      userId: row.userId,
      count: row._count?._all ?? 0,
      user: userMap[row.userId] ?? null,
    })),
  });
}
