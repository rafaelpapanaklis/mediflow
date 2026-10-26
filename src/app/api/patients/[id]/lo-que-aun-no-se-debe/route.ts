// GET /api/patients/[id]/lo-que-aun-no-se-debe — de las facturas del paciente, cuánto de su saldo
// todavía no se debe (decisiones de Rafael, 26-oct-2026): lo aceptado sin hacer de sus notas de plan
// y lo que no vence de su ortodoncia «Precio total a plazos». La cabecera de la ficha lo resta de la
// suma de saldos y «Estado de cuenta» lo dice aparte («de esto, $X aún no se debe»). Solo lectura.
//
// `clinicId` de la sesión; el paciente se valida por clínica Y visibilidad antes de leer nada.
// Permiso: `billing.view` (es dinero). La regla es la de Caja y Finanzas (`loQueAunNoSeDebe`).

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { receivableInvoiceWhere } from "@/lib/caja";
import { loQueAunNoSeDebe } from "@/lib/dinero/lo-que-se-debe.server";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  const patientId = String(params?.id ?? "").trim();
  if (!patientId || !esIdDeLaBase(patientId)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });
  const paciente = await prisma.patient.findFirst({ where: { id: patientId, clinicId: ctx.clinicId }, select: { id: true } });
  if (!paciente) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  const deniedPatient = await assertPatientVisible(paciente.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (deniedPatient) return deniedPatient;

  const facturas = await prisma.invoice.findMany({
    where: { ...receivableInvoiceWhere(ctx.clinicId), patientId: paciente.id },
    select: { id: true },
    take: 500,
  });
  const r = await loQueAunNoSeDebe(ctx.clinicId, { ids: facturas.map((f) => f.id) });
  return NextResponse.json({ total: r.total, porHacer: r.porHacer, porVencer: r.porVencer, porFactura: r.porFactura });
}
