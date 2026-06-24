// GET /api/paciente/documentos/descargar?tipo=consentimiento|subido&id=<cuid>
// Implementa D2 (WS1-T6). Devuelve { url } con signed URL de CORTA duración
// (TTL default 300s de src/lib/storage.ts) generada server-side TRAS validar
// el vínculo cuenta↔expediente. NUNCA exponer paths del bucket.
//
// Seguridad (NO negociable):
// · getPatientPortalContext() | pacienteUnauthorized().
// · const { searchParams } = new URL(req.url); tipo e id.
//   tipo !== "consentimiento" o id vacío → 400 { error: "Solicitud inválida" }.
// · prisma.consentForm.findUnique({ where: { id }, select: { patientId: true,
//   signedAt: true, signatureUrl: true,
//   patient: { select: { deletedAt: true } } } })
// · 404 GENÉRICO { error: "No encontrado" } si: no existe, O patientId ∉
//   ctx.links (ctx.links.some(l => l.patientId === form.patientId)), O patient
//   soft-deleted, O sin signedAt, O sin signatureUrl. MISMO 404 en todos los
//   casos — sin oráculo de existencia de ids.
// · const url = await signMaybeUrl(form.signatureUrl); si queda vacía → 404.
//   Respuesta 200 { url }. Header Cache-Control: "private, no-store".
// · try/catch → 500 { error: "Error interno" } con
//   console.error("[paciente/documentos/descargar] error:", err).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { signMaybeUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const { searchParams } = new URL(req.url);
    const tipo = searchParams.get("tipo");
    const id = searchParams.get("id");
    if ((tipo !== "consentimiento" && tipo !== "subido") || !id) {
      return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
    }

    // 404 GENÉRICO idéntico para todos los fallos — sin oráculo de ids.
    const notFound = () => NextResponse.json({ error: "No encontrado" }, { status: 404 });

    // Archivo subido por el paciente (WS1-T8): valida dueño (accountId) +
    // vínculo (clinicId/patientId en ctx.links) y firma el storageKey.
    if (tipo === "subido") {
      const up = await prisma.patientUpload.findUnique({
        where: { id },
        select: { accountId: true, clinicId: true, patientId: true, storageKey: true },
      });
      if (
        !up ||
        up.accountId !== ctx.account.id ||
        !ctx.links.some((l) => l.patientId === up.patientId && l.clinicId === up.clinicId)
      ) {
        return notFound();
      }
      const signed = await signMaybeUrl(up.storageKey);
      if (!signed) return notFound();
      return NextResponse.json(
        { url: signed },
        { status: 200, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const form = await prisma.consentForm.findUnique({
      where: { id },
      select: {
        patientId: true,
        signedAt: true,
        signatureUrl: true,
        patient: { select: { deletedAt: true } },
      },
    });

    if (
      !form ||
      !ctx.links.some((l) => l.patientId === form.patientId) ||
      form.patient?.deletedAt ||
      !form.signedAt ||
      !form.signatureUrl
    ) {
      return notFound();
    }

    const url = await signMaybeUrl(form.signatureUrl);
    if (!url) return notFound();

    return NextResponse.json(
      { url },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[paciente/documentos/descargar] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
