import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { diaAdmin, inicioDeHaceDias } from "@/lib/admin/zona-horaria";
import { agruparActividad, ultimoAccesoPorUsuario, type SesionPanel } from "@/lib/admin/ultimo-acceso";


export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    sesionesPanel,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, lastLogin: true },
    }),
    prisma.appointment.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, startsAt: true, type: true, createdAt: true, patient: { select: { firstName: true, lastName: true } } },
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
    // Por usuario Y por tipo de actor: userId NULL = bot / paciente / reserva web.
    prisma.auditLog.groupBy({
      by: ["userId", "actorType"],
      where: { clinicId, createdAt: { gte: since } },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    // Último acceso REAL: sesiones de panel (User.lastLogin no lo escribe nadie).
    prisma.analyticsSession.groupBy({
      by: ["userId"],
      where: { clinicId, surface: "dashboard", userId: { not: null } },
      _max: { lastSeenAt: true },
    }).catch(() => [] as any[]),
  ]);

  // Agrupa auditLog por día (YYYY-MM-DD) EN LA ZONA DEL PANEL.
  // Antes esto usaba `toISOString()`, que SIEMPRE devuelve UTC: a las 23:00 de
  // Mérida ya son las 05:00 UTC del día siguiente, así que el eje pintaba un
  // día que aquí no había empezado y los eventos de la tarde caían en el día
  // equivocado. Los DOS sitios —el agrupado y el eje— tienen que usar el mismo
  // criterio; si solo se arregla uno, las barras se mueven de columna.
  const byDay = new Map<string, number>();
  for (const row of dailyAudit as { createdAt: Date }[]) {
    const key = diaAdmin(new Date(row.createdAt));
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    // `inicioDeHaceDias` da la medianoche de ese día de Mérida, así que cada
    // paso cae en un día distinto sin depender de la zona del runtime.
    const key = diaAdmin(inicioDeHaceDias(i));
    days.push({ date: key, count: byDay.get(key) ?? 0 });
  }

  const userIds = (userActivity as any[]).map(u => u.userId).filter(Boolean) as string[];
  const userMap = userIds.length
    ? Object.fromEntries(
        (await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })).map(u => [u.id, u]),
      )
    : {};

  const actividad = agruparActividad(
    (userActivity as any[]).map(r => ({ userId: r.userId ?? null, actorType: r.actorType ?? null, count: r._count?._all ?? 0 })),
    userMap as any,
  );

  return NextResponse.json({
    users: ultimoAccesoPorUsuario(
      users,
      (sesionesPanel as any[]).map((r): SesionPanel => ({ userId: r.userId, lastSeenAt: r._max?.lastSeenAt })),
    ),
    timeline: {
      lastAppointment,
      lastInvoice,
      lastRecord,
      lastPatient,
      lastFile,
      lastAudit,
    },
    dailyActivity: days,
    userActivity: actividad.map(a => ({
      userId: a.userId,
      label: a.etiqueta,
      count: a.count,
      user: a.userId ? (userMap as any)[a.userId] ?? null : null,
    })),
  });
}
