import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { dateISOInTz, timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { patientVisibilityAnd, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";

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

  const clinicTz = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { timezone: true },
  });
  const tz = clinicTz?.timezone ?? "America/Mexico_City";

  // Visibilidad por paciente: la búsqueda global es una puerta lateral que
  // listaba pacientes/citas/facturas de TODA la clínica, restringidos incluidos.
  // Va en AND (nunca en OR) porque el OR de cada query ya lo ocupa el texto —
  // meterlo ahí lo volvería permisivo. Vacío para admins (no filtra).
  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const patientVis = patientVisibilityAnd(viewer);
  const relatedVis = relatedPatientVisibilityAnd(viewer);

  // Folio escrito sin prefijo: "72" tiene que traer MF-0072 como PRIMER
  // resultado y no perderse entre los `contains` (que también matchean 1720,
  // 720…). Los generadores del repo rellenan a 4 dígitos — MF-#### y
  // INV-AAAA-#### — así que probamos el crudo, el de 4 y el de 6 (por si el
  // padding crece). El `endsWith` se afina luego en JS comparando la cola
  // numérica exacta, para que "72" NO se quede con MF-10072.
  const numericQ = /^\d+$/.test(q) ? q : null;
  const folioVariants = numericQ
    ? Array.from(new Set([numericQ, numericQ.padStart(4, "0"), numericQ.padStart(6, "0")]))
    : [];

  const invoiceSelect = {
    id: true, invoiceNumber: true, total: true, status: true, createdAt: true,
    patient: { select: { firstName: true, lastName: true } },
  } as const;

  // Mismo clinicId y mismo relatedVis que la query de facturas de abajo: esto
  // solo reordena/complementa, no abre ninguna puerta de visibilidad.
  const folioPromise = numericQ
    ? prisma.invoice.findMany({
        where: {
          clinicId: ctx.clinicId,
          OR: folioVariants.map((v) => ({ invoiceNumber: { endsWith: v } })),
          ...(relatedVis.length ? { AND: relatedVis } : {}),
        },
        select: invoiceSelect,
        take: 5,
        orderBy: { createdAt: "desc" as const },
      })
    : Promise.resolve([]);

  const [patients, appointments, invoices, folioHits] = await Promise.all([
    prisma.patient.findMany({
      where: {
        clinicId: ctx.clinicId,
        OR: [
          { firstName: ci }, { lastName: ci },
          { patientNumber: { contains: q } },
          { phone: { contains: q } },
          { email: ci },
        ],
        ...(patientVis.length ? { AND: patientVis } : {}),
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
        ...(relatedVis.length ? { AND: relatedVis } : {}),
      },
      select: {
        id: true, startsAt: true, status: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor:  { select: { firstName: true, lastName: true } },
      },
      take: 5,
      orderBy: { startsAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: {
        clinicId: ctx.clinicId,
        OR: [
          { invoiceNumber: { contains: q, mode: "insensitive" } },
          { patient: { firstName: ci } },
          { patient: { lastName: ci } },
        ],
        ...(relatedVis.length ? { AND: relatedVis } : {}),
      },
      select: invoiceSelect,
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    folioPromise,
  ]);

  // Solo los que de verdad SON ese folio (cola numérica == número escrito).
  const exactFolio = folioHits.filter((i) => {
    const tail = /(\d+)$/.exec(i.invoiceNumber ?? "")?.[1];
    return tail != null && numericQ != null && Number(tail) === Number(numericQ);
  });

  const seenInvoice = new Set<string>();
  const rankedInvoices: typeof invoices = [];
  for (const inv of [...exactFolio, ...invoices]) {
    if (seenInvoice.has(inv.id)) continue;
    seenInvoice.add(inv.id);
    rankedInvoices.push(inv);
    if (rankedInvoices.length === 5) break;
  }

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
      date: dateISOInTz(a.startsAt, tz),
      startTime: timeHHMMInTz(a.startsAt, tz),
      patientName: `${a.patient.firstName} ${a.patient.lastName}`,
      doctorName: `${a.doctor.firstName} ${a.doctor.lastName}`,
      status: a.status,
    })),
    invoices: rankedInvoices.map(i => ({
      id: i.id,
      folio: i.invoiceNumber,
      amount: Number(i.total),
      status: i.status,
      date: i.createdAt.toISOString(),
      patientName: `${i.patient.firstName} ${i.patient.lastName}`,
    })),
  });
}
