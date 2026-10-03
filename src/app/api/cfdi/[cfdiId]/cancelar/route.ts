import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import { pedirCancelacion } from "@/lib/invoices/cfdi-cancelacion.server";
import { MOTIVOS_CANCELACION } from "@/lib/invoices/cfdi-cancelacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cfdi/[cfdiId]/cancelar — body { motive: "01"|"02"|"03"|"04", reason, sustitutoCfdiId? }
//
// Pide al SAT (vía Facturapi) la cancelación de un CFDI de la clínica (ws1-t3,
// F-02). Solo dueño y administrador, por ROL — igual que timbrar (POST
// /api/cfdi usa requireAdmin): cancelar un comprobante fiscal no se deshace.
// El motivo va en la QUERY del DELETE de Facturapi (lib/facturapi.ts,
// `urlCancelacion`). Con 01 hay que timbrar antes el sustituto (POST /api/cfdi
// con `sustituyeCfdiId`). Reglas: lib/invoices/cfdi-cancelacion.ts.
export async function POST(req: NextRequest, { params }: { params: { cfdiId: string } }) {
  const rl = rateLimit(req, 20, 60 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;
  const { clinicId, userId } = ctx!;

  // Visibilidad por paciente, como el PDF/XML: el CFDI lleva su identidad fiscal.
  const rec = await prisma.cfdiRecord.findFirst({
    where: { id: params.cfdiId, clinicId },
    select: { invoiceId: true },
  });
  if (!rec) return NextResponse.json({ error: "CFDI no encontrado." }, { status: 404 });
  if (rec.invoiceId) {
    const inv = await prisma.invoice.findFirst({ where: { id: rec.invoiceId, clinicId }, select: { patientId: true } });
    if (inv?.patientId) {
      const denied = await assertPatientVisible(inv.patientId, { userId, role: ctx!.role, clinicId });
      if (denied) return denied;
    }
  }

  const body = await req.json().catch(() => ({}));
  const r = await pedirCancelacion({
    clinicId, userId, cfdiId: params.cfdiId,
    motive: body?.motive, reason: body?.reason, sustitutoCfdiId: body?.sustitutoCfdiId,
  });

  const res = r.body.resultado;
  if (res) {
    const motivo = MOTIVOS_CANCELACION.find((m) => m.clave === res.motive)?.es ?? res.motive;
    const estado = res.efecto.status === "cancelled"
      ? "el SAT la aceptó"
      : res.efecto.cancellationStatus === "pending"
        ? "queda pendiente de que el receptor la acepte"
        : "el SAT la está verificando";
    await logMutation({
      req, clinicId, userId,
      patientId: res.patientId,
      texto: `Pidió al SAT cancelar el CFDI de la factura ${res.invoiceNumber ?? ""} (motivo ${res.motive}); ${estado}`.replace("  ", " "),
      entityType: res.invoiceId ? "invoice" : "cfdi",
      entityId: res.invoiceId ?? res.cfdiId,
      action: "update",
      before: { cfdi: { uuid: res.uuid, status: "valid" } },
      after: {
        cfdi: {
          uuid: res.uuid,
          status: res.efecto.status,
          cancellationStatus: res.efecto.cancellationStatus,
          motivoSat: res.motive,
          motivoSatTexto: motivo,
          motivo: res.reason,
          sustitutoUuid: res.sustitutoUuid,
          facturaLiberada: res.facturaLiberada,
        },
      },
    });
    return NextResponse.json({
      ok: true,
      status: res.efecto.status,
      cancellationStatus: res.efecto.cancellationStatus,
      facturaLiberada: res.facturaLiberada,
    });
  }
  return NextResponse.json(r.body, { status: r.status });
}
