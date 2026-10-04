import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { ingresosPorDoctorDelPeriodo } from "@/lib/dinero/ingresos.server";
import { ID_SIN_DOCTOR, NOMBRE_SIN_DOCTOR, idsConIngresoFueraDeLista, ingresoSinDoctor } from "@/lib/dinero/por-doctor";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/doctor-performance?from=&to=&doctorId=
 *
 * Devuelve por doctor:
 *  - apptsTotal, apptsCompleted, apptsNoShow
 *  - apptsPerDay (promedio sobre días con al menos una cita)
 *  - revenueGenerated: lo COBRADO neto del rango por FECHA DE COBRO (ws1-t2,
 *    la definición única de lib/dinero y base de comisiones): cada cobro
 *    menos reembolsos va al doctor de la factura, si no al de su cita, y en
 *    casos de ortodoncia sin cita a quien llevaba el caso ese día
 *    (`revenueOrtho` es esa parte). Antes era Invoice.paid de las facturas
 *    ligadas a una cita del rango, por fecha de la cita: no veía las facturas
 *    hechas en Caja con doctor y se re-escribía al pasado con cada abono.
 *  - avgSatisfaction (promedio de PatientSatisfaction.score)
 *  - avgConsultMin (de AppointmentTimeline)
 *
 * Si doctorId presente: solo ese doctor con detalle por mes.
 *
 * ws1-t2 (auditoría de uso C-10): sin `doctorId`, la lista trae TODO el
 * ingreso del rango, como «Por doctor» de Finanzas: además de los activos,
 * quien cobró sin estar en la lista (dado de baja, otro rol) y la fila «Sin
 * doctor» (`id: "sin-doctor"`, sin citas). Antes se omitían y la columna no
 * cuadraba con Ingresos aunque la nota decía «la misma cifra».
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
  const doctorIdFilter = url.searchParams.get("doctorId");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getFullYear(), to.getMonth(), 1);

  const activos = await prisma.user.findMany({
    where: {
      clinicId,
      isActive: true,
      role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] },
      ...(doctorIdFilter ? { id: doctorIdFilter } : {}),
    },
    select: { id: true, firstName: true, lastName: true, color: true, role: true },
  });

  // Lo cobrado neto del rango por doctor (ws1-t2): la misma función que la
  // nómina y el «Por doctor» de Finanzas. `to` es inclusivo aquí.
  const cobradoPorDoctor = await ingresosPorDoctorDelPeriodo(clinicId, { gte: from, lte: to });

  // C-10: quien cobró en el rango sin estar en la lista también sale (solo
  // usuarios de esta clínica). Con `doctorId` se pide UN doctor: no se añade nadie.
  const fuera = doctorIdFilter ? [] : idsConIngresoFueraDeLista(activos.map((d) => d.id), cobradoPorDoctor);
  const doctors = fuera.length > 0
    ? [
        ...activos,
        ...(await prisma.user.findMany({
          where: { clinicId, id: { in: fuera } },
          select: { id: true, firstName: true, lastName: true, color: true, role: true },
        })),
      ]
    : activos;

  const rows = await Promise.all(
    doctors.map(async (doc) => {
      const [appts, satisfactions, timelines] = await Promise.all([
        prisma.appointment.findMany({
          where: { clinicId, doctorId: doc.id, startsAt: { gte: from, lte: to } },
          select: { id: true, status: true, startsAt: true },
        }),
        prisma.patientSatisfaction.findMany({
          where: {
            appointment: { doctorId: doc.id, clinicId, startsAt: { gte: from, lte: to } },
          },
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
      const noShowRate = appts.length > 0 ? (apptsNoShow / appts.length) * 100 : 0;

      // Días únicos con al menos una cita
      const days = new Set(appts.map((a) => a.startsAt.toISOString().slice(0, 10)));
      const apptsPerDay = days.size > 0 ? appts.length / days.size : 0;

      const avgSatisfaction =
        satisfactions.length > 0
          ? satisfactions.reduce((s, x) => s + x.score, 0) / satisfactions.length
          : null;

      const avgConsultMin =
        timelines.length > 0
          ? Math.round(
              timelines.reduce((s, t) => s + (t.totalConsultMin ?? 0), 0) / timelines.length,
            )
          : null;

      return {
        id: doc.id,
        name: `${doc.firstName} ${doc.lastName}`,
        color: doc.color,
        role: doc.role,
        apptsTotal: appts.length,
        apptsCompleted,
        apptsNoShow,
        noShowRate: Math.round(noShowRate * 10) / 10,
        apptsPerDay: Math.round(apptsPerDay * 10) / 10,
        revenueGenerated: cobradoPorDoctor.get(doc.id)?.total ?? 0,
        // Cuánto de `revenueGenerated` es de casos de ortodoncia sin cita (mensualidades, enganche y extras).
        revenueOrtho: cobradoPorDoctor.get(doc.id)?.orto ?? 0,
        avgSatisfaction: avgSatisfaction != null ? Math.round(avgSatisfaction * 10) / 10 : null,
        satisfactionCount: satisfactions.length,
        avgConsultMin,
      };
    }),
  );

  // `role` como texto: la fila «Sin doctor» no tiene rol.
  const salida: Array<Omit<(typeof rows)[number], "role"> & { role: string }> = rows
    .sort((a, b) => b.revenueGenerated - a.revenueGenerated);

  // C-10: lo que no es de nadie, al final (no tiene citas ni encuestas).
  const sinDoctor = doctorIdFilter ? null : ingresoSinDoctor(cobradoPorDoctor);
  if (sinDoctor) {
    salida.push({
      id: ID_SIN_DOCTOR,
      name: NOMBRE_SIN_DOCTOR,
      color: "",
      role: "",
      apptsTotal: 0,
      apptsCompleted: 0,
      apptsNoShow: 0,
      noShowRate: 0,
      apptsPerDay: 0,
      revenueGenerated: sinDoctor.total,
      revenueOrtho: sinDoctor.orto,
      avgSatisfaction: null,
      satisfactionCount: 0,
      avgConsultMin: null,
    });
  }

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    doctors: salida,
  });
}
