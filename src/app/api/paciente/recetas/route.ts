// GET /api/paciente/recetas — recetas de TODOS los expedientes vinculados a
// la cuenta del paciente (portal). Solo API, sin UI (la UI la activa otra
// terminal).
//
// · getPatientPortalContext() | 401. patientIds desde ctx.links — fuente de
//   verdad multi-tenant: jamás se acepta patientId por query string.
// · Select paciente-safe: la receta es un documento que el paciente ya posee
//   (se la entregan impresa/PDF), así que incluye medicamentos, indicaciones,
//   diagnóstico, vigencia y el enlace de verificación. CERO datos de otros
//   pacientes, CERO campos SOAP de la consulta.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  // Multi-tenant estricto: SOLO los expedientes vinculados a la cuenta.
  const patientIds = ctx.links.map((l) => l.patientId);
  if (patientIds.length === 0) {
    return NextResponse.json({ recetas: [] });
  }

  const list = await prisma.prescription.findMany({
    where: { patientId: { in: patientIds }, patient: { deletedAt: null } },
    orderBy: { issuedAt: "desc" },
    take: 100,
    select: {
      id: true,
      patientId: true,
      clinicId: true,
      issuedAt: true,
      expiresAt: true,
      verifyUrl: true,
      qrCode: true,
      diagnosis: true,
      indications: true,
      cofeprisGroup: true,
      cofeprisFolio: true,
      doctor: { select: { firstName: true, lastName: true } },
      clinic: { select: { name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          dosage: true,
          duration: true,
          quantity: true,
          notes: true,
          cums: { select: { descripcion: true, presentacion: true } },
        },
      },
    },
  });

  const now = Date.now();
  const recetas = list.map((rx) => ({
    id: rx.id,
    patientId: rx.patientId,
    clinicId: rx.clinicId,
    clinicName: rx.clinic.name,
    doctorName: [rx.doctor.firstName, rx.doctor.lastName].filter(Boolean).join(" "),
    issuedAt: rx.issuedAt.toISOString(),
    expiresAt: rx.expiresAt ? rx.expiresAt.toISOString() : null,
    expired: rx.expiresAt ? rx.expiresAt.getTime() < now : false,
    folio: rx.qrCode,
    verifyUrl: rx.verifyUrl,
    diagnosis: rx.diagnosis,
    indications: rx.indications,
    cofeprisGroup: rx.cofeprisGroup,
    cofeprisFolio: rx.cofeprisFolio,
    medicamentos: rx.items.map((it) => ({
      id: it.id,
      nombre: it.cums?.descripcion ?? "",
      presentacion: it.cums?.presentacion ?? null,
      dosis: it.dosage,
      duracion: it.duration,
      cantidad: it.quantity,
      notas: it.notes,
    })),
  }));

  return NextResponse.json({ recetas });
}
