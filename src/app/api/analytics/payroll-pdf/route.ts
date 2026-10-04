import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { ingresosPorDoctorDelPeriodo } from "@/lib/dinero/ingresos.server";
import { NOMBRE_SIN_DOCTOR, idsConIngresoFueraDeLista, ingresoSinDoctor } from "@/lib/dinero/por-doctor";
import { diaEnZona, etiquetaDePeriodo } from "@/lib/dinero/fechas-de-reporte";
import { renderToBuffer } from "@react-pdf/renderer";
import { PayrollDocument, type PayrollRow } from "@/lib/pdf/payroll-document";
import { createElement } from "react";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/payroll-pdf?from=&to=
 *
 * Genera un PDF de nómina de doctores con los mismos datos que muestra
 * /dashboard/analytics/doctors.
 *
 * Multi-tenant:
 * - clinicId desde getCurrentUser, scope estricto.
 * - users.findMany filtra clinicId directo.
 * - Subqueries por doctor: appointments + invoices + timelines +
 *   satisfactions, todas con clinicId directo o vía relation.
 *
 * Rol: solo SUPER_ADMIN/ADMIN.
 *
 * ws1-t2 (auditoría de uso C-10): el total del PDF es el ingreso del periodo,
 * la misma cifra que Finanzas: lleva a quien cobró sin estar en la lista
 * (dado de baja, otro rol) y la fila «Sin doctor». Las fechas (periodo y
 * «Generado») van en la zona de la CLÍNICA, no en la del servidor.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getFullYear(), to.getMonth(), 1);

  const [clinic, activos] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, timezone: true } }),
    prisma.user.findMany({
      where: {
        clinicId,
        isActive: true,
        role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] },
      },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });

  // Base de la nómina (ws1-t2): lo COBRADO neto del rango por fecha de cobro,
  // por doctor — la misma función que /api/analytics/doctor-performance y el
  // «Por doctor» de Finanzas (lib/dinero). Incluye lo de casos de ortodoncia
  // sin cita, para quien llevaba el caso ese día.
  const cobradoPorDoctor = await ingresosPorDoctorDelPeriodo(clinicId, { gte: from, lte: to });
  const fuera = idsConIngresoFueraDeLista(activos.map((d) => d.id), cobradoPorDoctor);
  const doctors = fuera.length > 0
    ? [
        ...activos,
        ...(await prisma.user.findMany({
          where: { clinicId, id: { in: fuera } }, // solo usuarios de ESTA clínica
          select: { id: true, firstName: true, lastName: true },
        })),
      ]
    : activos;

  const rows: PayrollRow[] = await Promise.all(
    doctors.map(async (doc) => {
      const [appts, satisfactions, timelines] = await Promise.all([
        prisma.appointment.findMany({
          where: { clinicId, doctorId: doc.id, startsAt: { gte: from, lte: to } },
          select: { id: true, status: true, startsAt: true },
        }),
        prisma.patientSatisfaction.findMany({
          where: { appointment: { doctorId: doc.id, clinicId, startsAt: { gte: from, lte: to } } },
          select: { score: true },
        }),
        prisma.appointmentTimeline.findMany({
          where: {
            appointment: { doctorId: doc.id, clinicId, startsAt: { gte: from, lte: to } },
            totalConsultMin: { not: null },
          },
          select: { totalConsultMin: true },
        }),
      ]);

      const apptsCompleted = appts.filter((a) => a.status === "COMPLETED" || a.status === "CHECKED_OUT").length;
      const apptsNoShow = appts.filter((a) => a.status === "NO_SHOW").length;
      const noShowRate = appts.length > 0 ? Math.round((apptsNoShow / appts.length) * 1000) / 10 : 0;
      const days = new Set(appts.map((a) => a.startsAt.toISOString().slice(0, 10)));
      const apptsPerDay = days.size > 0 ? Math.round((appts.length / days.size) * 10) / 10 : 0;
      const avgSatisfaction =
        satisfactions.length > 0
          ? Math.round((satisfactions.reduce((s, x) => s + x.score, 0) / satisfactions.length) * 10) / 10
          : null;
      const avgConsultMin =
        timelines.length > 0
          ? Math.round(timelines.reduce((s, t) => s + (t.totalConsultMin ?? 0), 0) / timelines.length)
          : null;

      return {
        name: `${doc.firstName} ${doc.lastName}`,
        apptsTotal: appts.length,
        apptsCompleted,
        apptsPerDay,
        apptsNoShow,
        noShowRate,
        avgConsultMin,
        avgSatisfaction,
        satisfactionCount: satisfactions.length,
        revenueGenerated: cobradoPorDoctor.get(doc.id)?.total ?? 0,
      };
    }),
  );

  rows.sort((a, b) => b.revenueGenerated - a.revenueGenerated);

  // Lo que no es de nadie, al final: sin esta fila el total no daba Ingresos.
  const sinDoctor = ingresoSinDoctor(cobradoPorDoctor);
  if (sinDoctor) {
    rows.push({
      name: NOMBRE_SIN_DOCTOR,
      apptsTotal: 0,
      apptsCompleted: 0,
      apptsPerDay: 0,
      apptsNoShow: 0,
      noShowRate: 0,
      avgConsultMin: null,
      avgSatisfaction: null,
      satisfactionCount: 0,
      revenueGenerated: sinDoctor.total,
      sinDoctor: true,
    });
  }

  const timezone = clinic.timezone || "America/Mexico_City";
  const periodLabel = etiquetaDePeriodo(from, to, timezone);

  // renderToBuffer espera un ReactElement<DocumentProps>. PayrollDocument
  // sí retorna <Document>, pero el type system no lo infiere desde el
  // wrapper FC. Cast explícito que sigue siendo type-safe en runtime
  // porque PayrollDocument SIEMPRE retorna <Document>.
  const element = createElement(PayrollDocument, {
    clinicName: clinic.name,
    periodLabel,
    generatedAt: new Date().toISOString(),
    timezone,
    rows,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="nomina-${diaEnZona(from, timezone)}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
