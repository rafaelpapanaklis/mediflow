import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { filasDeDoctores } from "@/lib/analytics/doctores.server";
import { mesDeLaClinica } from "@/lib/agenda/citas-del-periodo";
import { ventanaDelPedido } from "@/lib/agenda/citas-por-doctor";
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
 *
 * ws1-t2 (C-11, segunda vuelta): las MISMAS filas que Analítica › Doctores
 * (lib/analytics/doctores.server.ts): `periodo=mes` = el mes entero de la
 * clínica y las citas sin canceladas, así «N citas · M completadas» del pie
 * es «Citas del mes» de Inicio (decía «75 citas · 22 completadas» contra 88).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;
  if (!clinicId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, timezone: true } });
  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });
  const timezone = clinic.timezone || "America/Mexico_City";
  const { desde, hasta } = ventanaDelPedido(
    { periodo: url.searchParams.get("periodo"), from: url.searchParams.get("from"), to: url.searchParams.get("to") },
    () => mesDeLaClinica(timezone),
  );
  const from = desde;
  const to = new Date(hasta.getTime() - 1);

  const filas = await filasDeDoctores(clinicId, { desde, hasta }, timezone);
  const rows: PayrollRow[] = filas.map((f) => ({
    name: f.name,
    apptsTotal: f.apptsTotal,
    apptsCompleted: f.apptsCompleted,
    apptsPerDay: f.apptsPerDay,
    apptsNoShow: f.apptsNoShow,
    noShowRate: f.noShowRate,
    avgConsultMin: f.avgConsultMin,
    avgSatisfaction: f.avgSatisfaction,
    satisfactionCount: f.satisfactionCount,
    revenueGenerated: f.revenueGenerated,
    ...(f.sinDoctor ? { sinDoctor: true } : {}),
  }));

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
