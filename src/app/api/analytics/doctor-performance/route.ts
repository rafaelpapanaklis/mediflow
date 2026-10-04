import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { filasDeDoctores } from "@/lib/analytics/doctores.server";
import { mesDeLaClinica } from "@/lib/agenda/citas-del-periodo";
import { ventanaDelPedido } from "@/lib/agenda/citas-por-doctor";

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
 *
 * ws1-t2 (C-11, segunda vuelta): `periodo=mes` = el mes ENTERO de la clínica;
 * las citas son las del periodo sin canceladas (`citasDelPeriodoWhere`), sobre
 * la misma lista de personas que Inicio. La columna suma las citas del mes.
 * El cálculo vive en lib/analytics/doctores.server.ts (lo comparte la nómina).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;
  if (!clinicId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
  const zona = clinic?.timezone || "America/Mexico_City";
  const { desde, hasta } = ventanaDelPedido(
    { periodo: url.searchParams.get("periodo"), from: url.searchParams.get("from"), to: url.searchParams.get("to") },
    () => mesDeLaClinica(zona),
  );

  const doctors = await filasDeDoctores(clinicId, { desde, hasta }, zona, url.searchParams.get("doctorId"));

  return NextResponse.json({
    from: desde.toISOString(),
    to: new Date(hasta.getTime() - 1).toISOString(),
    doctors,
  });
}
