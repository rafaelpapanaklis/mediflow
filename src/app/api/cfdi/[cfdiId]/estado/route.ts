import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import { leerCfdi } from "@/lib/invoices/cfdi-cancelacion-db";
import { sincronizarCfdi, vistaDeCfdi } from "@/lib/invoices/cfdi-cancelacion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cfdi/[cfdiId]/estado — «Consultar estado en el SAT» (ws1-t3, F-03).
//
// Pregunta a Facturapi cómo está el CFDI y deja `cfdi_records` al día: lo
// cancelado desde el dashboard de Facturapi, la aceptación (o el rechazo) del
// receptor, una cancelación que quedó «incierta». Si quedó cancelado y era el
// CFDI vigente de la factura, la factura se suelta para volver a timbrarse.
// Funciona aunque no se haya pegado sql/ws1-t3-cfdi-cancelacion.sql (solo
// escribe columnas que ya existen). No cambia nada ante el SAT: solo lee.
export async function POST(req: NextRequest, { params }: { params: { cfdiId: string } }) {
  const rl = rateLimit(req, 30, 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const cfdi = await leerCfdi(prisma, { clinicId: ctx.clinicId, cfdiId: params.cfdiId });
  if (!cfdi) return NextResponse.json({ error: "CFDI no encontrado." }, { status: 404 });

  let patientId: string | null = null;
  let invoiceNumber: string | null = null;
  if (cfdi.invoiceId) {
    const inv = await prisma.invoice.findFirst({
      where: { id: cfdi.invoiceId, clinicId: ctx.clinicId },
      select: { patientId: true, invoiceNumber: true },
    });
    patientId = inv?.patientId ?? null;
    invoiceNumber = inv?.invoiceNumber ?? null;
    if (patientId) {
      const deniedP = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
      if (deniedP) return deniedP;
    }
  }

  let r;
  try {
    r = await sincronizarCfdi(cfdi);
  } catch (e: any) {
    return NextResponse.json({ error: `No se pudo consultar Facturapi: ${e?.message ?? e}` }, { status: 502 });
  }
  if (!r.encontrado) {
    return NextResponse.json({ error: "Facturapi no encuentra este CFDI con las llaves de la clínica." }, { status: 404 });
  }

  if (r.recienCancelado) {
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId, patientId,
      texto: `Consultó el SAT: el CFDI de la factura ${invoiceNumber ?? ""} quedó cancelado`.replace("  ", " "),
      entityType: cfdi.invoiceId ? "invoice" : "cfdi",
      entityId: cfdi.invoiceId ?? cfdi.id,
      action: "update",
      before: { cfdi: { uuid: cfdi.uuid, status: "valid" } },
      after: { cfdi: { uuid: cfdi.uuid, status: "cancelled", facturaLiberada: r.facturaLiberada, origen: "consulta" } },
    });
  }

  const fresco = await leerCfdi(prisma, { clinicId: ctx.clinicId, cfdiId: cfdi.id });
  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  return NextResponse.json({
    ok: true,
    ambiente: r.ambiente,
    facturaLiberada: r.facturaLiberada,
    cfdi: fresco ? vistaDeCfdi(fresco, { timeZone: clinic?.timezone }) : null,
  });
}
