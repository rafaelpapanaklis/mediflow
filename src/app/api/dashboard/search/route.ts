import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 30);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ patients: [], appointments: [], invoices: [] });
  }

  const ci = { contains: q, mode: "insensitive" as const };
  const [patients, appointments, invoices] = await Promise.all([
    prisma.patient.findMany({
      where: {
        clinicId: ctx.clinicId,
        OR: [
          { firstName: ci }, { lastName: ci },
          { patientNumber: { contains: q } },
          { phone: { contains: q } },
          { email: ci },
        ],
      },
      select: { id: true, firstName: true, lastName: true, patientNumber: true, phone: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    prisma.appointment.findMany({
      where: {
        clinicId: ctx.clinicId,
        OR: [
          { patient: { firstName: ci } },
          { patient: { lastName: ci } },
        ],
      },
      select: {
        id: true, date: true, startTime: true, status: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor:  { select: { firstName: true, lastName: true } },
      },
      take: 5,
      orderBy: { date: "desc" },
    }),
    prisma.invoice.findMany({
      where: {
        clinicId: ctx.clinicId,
        OR: [
          { invoiceNumber: { contains: q, mode: "insensitive" } },
          { patient: { firstName: ci } },
          { patient: { lastName: ci } },
        ],
      },
      select: {
        id: true, invoiceNumber: true, total: true, status: true, createdAt: true,
        patient: { select: { firstName: true, lastName: true } },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    patients: patients.map(p => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      patientNumber: p.patientNumber,
      phone: p.phone,
    })),
    appointments: appointments.map(a => ({
      id: a.id,
      date: a.date.toISOString(),
      startTime: a.startTime,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`,
      doctorName: `${a.doctor.firstName} ${a.doctor.lastName}`,
      status: a.status,
    })),
    invoices: invoices.map(i => ({
      id: i.id,
      folio: i.invoiceNumber,
      amount: Number(i.total),
      status: i.status,
      date: i.createdAt.toISOString(),
      patientName: `${i.patient.firstName} ${i.patient.lastName}`,
    })),
  });
}
