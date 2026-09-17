// GET /api/invoices/condiciones?ids=a,b,c  — lo que la FICHA de una factura
// necesita y la lista de facturas no trae: las condiciones de pago (para la
// frase en violeta) y si el paciente tiene correo y teléfono (para deshabilitar
// «Enviar» con un motivo, en vez de dejar que falle al pulsarlo).
//
// GET /api/invoices/condiciones?patientId=x — lo mismo, pero del paciente que se
// acaba de elegir en el popup de Nueva factura, antes de que exista la factura.
//
// Solo lectura. Multi-tenant: `clinicId` de la sesión. Los ids que manda el
// cliente se vuelven a filtrar por clínica Y por visibilidad de paciente antes
// de leer nada: un id ajeno o de un paciente restringido no devuelve ni la frase
// ni el «tiene teléfono».
//
// Del contacto se devuelve SOLO si existe (booleanos), no el dato.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { relatedPatientVisibilityAnd, assertPatientVisible } from "@/lib/patient-visibility";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";

export const dynamic = "force-dynamic";

/** La lista de Facturación trae como mucho 100 facturas. */
const MAX_IDS = 100;

const tiene = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  // Regla de la casa: `clinicId: undefined` no filtra nada. Se corta antes.
  if (!ctx.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const patientId = (searchParams.get("patientId") ?? "").trim();
  if (patientId) {
    const deniedPatient = await assertPatientVisible(patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (deniedPatient) return deniedPatient;
    const p = await prisma.patient.findFirst({
      where: { id: patientId, clinicId: ctx.clinicId },
      select: { email: true, phone: true },
    });
    if (!p) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    return NextResponse.json({ contacto: { correo: tiene(p.email), telefono: tiene(p.phone) } });
  }

  const ids = Array.from(new Set(
    (searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  )).slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ condiciones: {}, contacto: {}, sinTabla: false, fallo: false });
  }

  const visibility = relatedPatientVisibilityAnd({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  const propias = await prisma.invoice.findMany({
    where: {
      id: { in: ids },
      clinicId: ctx.clinicId,
      ...(visibility.length ? { AND: visibility } : {}),
    },
    select: { id: true, patient: { select: { email: true, phone: true } } },
  });

  const contacto: Record<string, { correo: boolean; telefono: boolean }> = {};
  propias.forEach((inv) => {
    contacto[inv.id] = { correo: tiene(inv.patient?.email), telefono: tiene(inv.patient?.phone) };
  });

  const leido = await leerCondicionesDeFacturas(prisma, {
    clinicId: ctx.clinicId,
    invoiceIds: propias.map((i) => i.id),
  });
  const condiciones: Record<string, CondicionesPago> = {};
  leido.porFactura.forEach((c, id) => { condiciones[id] = c; });

  return NextResponse.json({ condiciones, contacto, sinTabla: leido.sinTabla, fallo: leido.fallo });
}
