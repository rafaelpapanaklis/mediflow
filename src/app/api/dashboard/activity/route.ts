import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface ActivityEvent {
  id: string;
  type: "payment" | "patient_new" | "appointment_completed";
  title: string;
  subtitle?: string;
  amount?: number;
  href: string;
  at: Date;
}

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 20);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [paidInvoices, newPatients, doneAppointments] = await Promise.all([
    prisma.invoice.findMany({
      where: { clinicId: ctx.clinicId, status: { in: ["PAID", "PARTIAL"] } },
      select: { id: true, paid: true, paymentMethod: true, paidAt: true, updatedAt: true,
        patient: { select: { firstName: true, lastName: true } } },
      orderBy: { paidAt: "desc" },
      take: 10,
    }),
    prisma.patient.findMany({
      where: { clinicId: ctx.clinicId },
      select: { id: true, firstName: true, lastName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.appointment.findMany({
      where: { clinicId: ctx.clinicId, status: "COMPLETED" },
      select: { id: true, updatedAt: true,
        patient: { select: { firstName: true, lastName: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  const events: ActivityEvent[] = [
    ...paidInvoices.map(i => ({
      id: `inv-${i.id}`,
      type: "payment" as const,
      title: `Pago recibido — ${i.patient.firstName} ${i.patient.lastName}`,
      subtitle: `$${Number(i.paid).toLocaleString("es-MX")}${i.paymentMethod ? ` · ${i.paymentMethod}` : ""}`,
      amount: Number(i.paid),
      href: `/dashboard/billing?focus=${i.id}`,
      at: i.paidAt ?? i.updatedAt,
    })),
    ...newPatients.map(p => ({
      id: `pat-${p.id}`,
      type: "patient_new" as const,
      title: `Nuevo paciente — ${p.firstName} ${p.lastName}`,
      href: `/dashboard/patients/${p.id}`,
      at: p.createdAt,
    })),
    ...doneAppointments.map(a => ({
      id: `app-${a.id}`,
      type: "appointment_completed" as const,
      title: `Cita completada — ${a.patient.firstName} ${a.patient.lastName}`,
      href: `/dashboard/appointments?focus=${a.id}`,
      at: a.updatedAt,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 20);

  const lastSeenRaw = cookies().get("notifLastSeen")?.value;
  const lastSeen = lastSeenRaw ? new Date(lastSeenRaw) : null;
  const unreadCount = lastSeen
    ? events.filter(e => e.at > lastSeen).length
    : events.length;

  return NextResponse.json({
    events: events.map(e => ({ ...e, at: e.at.toISOString() })),
    unreadCount,
  });
}
