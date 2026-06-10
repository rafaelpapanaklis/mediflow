// GET /api/paciente/documentos — Implementa D1 (WS1-T6 documentos).
// Respuesta: PacienteDocumentosResponse { clinics, consentimientos, recibos }.
//
// PATRÓN A SEGUIR: src/app/api/paciente/payments/route.ts (léelo entero antes).
// · getPatientPortalContext() | pacienteUnauthorized(). patientIds de ctx.links.
//   Si 0 links → respuesta vacía 200 (clinics/consentimientos/recibos []).
// · UN solo Promise.all con 3 queries (regla <7 ✓):
//   1) links → clinics: prisma.patientAccountLink.findMany EXACTAMENTE igual
//      que en payments (mismo where con patient.deletedAt null y mismo select
//      de clinic id/name/slug/logoUrl/city/phone + patient id/patientNumber).
//   2) consentimientos: prisma.consentForm.findMany({
//        where: { patientId: { in: patientIds }, signedAt: { not: null },
//                 patient: { deletedAt: null } },
//        orderBy: { signedAt: "desc" }, take: 100,
//        select: { id, clinicId, patientId, procedure, content, signedAt,
//                  signatureUrl } })
//      → map a PacienteConsentimiento con hasFirma = !!signatureUrl.
//      ⚠️ signatureUrl NUNCA viaja en la respuesta (path interno del bucket
//      privado): la descarga es vía /api/paciente/documentos/descargar.
//      ⚠️ NUNCA exponer token / expiresAt del form ni formas sin firmar.
//   3) recibos: prisma.payment.findMany({
//        where: { invoice: { patientId: { in: patientIds },
//                 status: { not: "DRAFT" }, patient: { deletedAt: null } } },
//        orderBy: { paidAt: "desc" }, take: 200,
//        select: { id, amount, method, paidAt,
//                  invoice: { select: { id, invoiceNumber, clinicId,
//                                       patientId } } } })
//      → map a PacienteRecibo (invoiceId/invoiceNumber/clinicId del invoice).
//      ⚠️ NUNCA seleccionar Payment.notes ni Payment.reference (internos).
// · Como en payments: visiblePatientIds = Set de links; filtra consentimientos
//   y recibos cuyo patientId no esté (consistencia con clinics). patientId NO
//   viaja en la respuesta.
// · Fechas con .toISOString(). try/catch → 500 { error: "Error interno" } y
//   console.error("[paciente/documentos] error:", err).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import type {
  PacienteClinica,
  PacienteConsentimiento,
  PacienteDocumentosResponse,
  PacienteRecibo,
} from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const patientIds = ctx.links.map((l) => l.patientId);
    if (patientIds.length === 0) {
      const empty: PacienteDocumentosResponse = {
        clinics: [],
        consentimientos: [],
        recibos: [],
      };
      return NextResponse.json(empty, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const [links, consentRows, paymentRows] = await Promise.all([
      prisma.patientAccountLink.findMany({
        where: { accountId: ctx.account.id, patient: { deletedAt: null } },
        select: {
          clinicId: true,
          patient: {
            select: {
              id: true,
              patientNumber: true,
              clinic: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  logoUrl: true,
                  city: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
      prisma.consentForm.findMany({
        where: {
          patientId: { in: patientIds },
          signedAt: { not: null },
          patient: { deletedAt: null },
        },
        orderBy: { signedAt: "desc" },
        take: 100,
        // patientId y signatureUrl se usan SOLO server-side (filtro de
        // visibilidad y flag hasFirma); NUNCA viajan en la respuesta.
        // NUNCA seleccionar token ni expiresAt del form.
        select: {
          id: true,
          clinicId: true,
          patientId: true,
          procedure: true,
          content: true,
          signedAt: true,
          signatureUrl: true,
        },
      }),
      prisma.payment.findMany({
        where: {
          invoice: {
            patientId: { in: patientIds },
            status: { not: "DRAFT" },
            patient: { deletedAt: null },
          },
        },
        orderBy: { paidAt: "desc" },
        take: 200,
        // invoice.patientId se usa SOLO server-side para el filtro de
        // visibilidad; no viaja. NUNCA seleccionar notes ni reference
        // (internos de la clínica).
        select: {
          id: true,
          amount: true,
          method: true,
          paidAt: true,
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              clinicId: true,
              patientId: true,
            },
          },
        },
      }),
    ]);

    const clinics: PacienteClinica[] = links.map((l) => ({
      clinicId: l.patient.clinic.id,
      clinicName: l.patient.clinic.name,
      clinicSlug: l.patient.clinic.slug,
      logoUrl: l.patient.clinic.logoUrl,
      city: l.patient.clinic.city,
      phone: l.patient.clinic.phone,
      patientId: l.patient.id,
      patientNumber: l.patient.patientNumber,
    }));

    // Solo documentos de expedientes visibles (paciente no soft-deleted),
    // para que las listas sean consistentes con `clinics`.
    const visiblePatientIds = new Set(links.map((l) => l.patient.id));

    const consentimientos: PacienteConsentimiento[] = consentRows
      .filter((c) => visiblePatientIds.has(c.patientId))
      .map((c) => ({
        id: c.id,
        clinicId: c.clinicId,
        procedure: c.procedure,
        content: c.content,
        signedAt: c.signedAt.toISOString(),
        hasFirma: !!c.signatureUrl,
      }));

    const recibos: PacienteRecibo[] = paymentRows
      .filter((p) => visiblePatientIds.has(p.invoice.patientId))
      .map((p) => ({
        id: p.id,
        clinicId: p.invoice.clinicId,
        invoiceId: p.invoice.id,
        invoiceNumber: p.invoice.invoiceNumber,
        amount: p.amount,
        method: p.method,
        paidAt: p.paidAt.toISOString(),
      }));

    const body: PacienteDocumentosResponse = {
      clinics,
      consentimientos,
      recibos,
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[paciente/documentos] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
