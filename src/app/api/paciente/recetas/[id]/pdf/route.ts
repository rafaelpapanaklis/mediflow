// GET /api/paciente/recetas/[id]/pdf — Implementa D3 (WS1-T6).
// Stream del PDF de la receta para el portal del paciente, reusando
// buildPrescriptionPdf() de src/lib/pdf/prescription-pdf.ts (CERO duplicación).
//
// PATRÓN A SEGUIR: src/app/api/prescriptions/[id]/pdf/route.ts (léelo antes;
// headers de respuesta idénticos: Content-Type application/pdf +
// Content-Disposition attachment con out.fileName + Cache-Control private,
// no-store; mismo manejo del buffer en NextResponse).
//
// Seguridad:
// · getPatientPortalContext() | pacienteUnauthorized().
// · Ownership ANTES de generar nada:
//   prisma.prescription.findUnique({ where: { id: params.id },
//     select: { patientId: true, patient: { select: { deletedAt: true } } } });
//   si no existe, O patientId ∉ ctx.links, O patient soft-deleted → 404
//   GENÉRICO { error: "No encontrada" } (mismo 404 siempre, sin oráculo).
// · const out = await buildPrescriptionPdf(params.id); — SIN clinicId: el
//   paciente puede tener expedientes en varias clínicas y la ownership ya
//   quedó validada arriba. out null → mismo 404.
// · try/catch → 500 { error: "Error interno" } con
//   console.error("[paciente/recetas/pdf] error:", err).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { buildPrescriptionPdf } from "@/lib/pdf/prescription-pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    // 404 GENÉRICO idéntico para todos los fallos — sin oráculo de ids.
    const notFound = () => NextResponse.json({ error: "No encontrada" }, { status: 404 });

    // Ownership ANTES de generar nada.
    const rx = await prisma.prescription.findUnique({
      where: { id: params.id },
      select: { patientId: true, patient: { select: { deletedAt: true } } },
    });

    if (
      !rx ||
      !ctx.links.some((l) => l.patientId === rx.patientId) ||
      rx.patient?.deletedAt
    ) {
      return notFound();
    }

    // SIN clinicId: ownership ya validada arriba (expedientes multi-clínica).
    const out = await buildPrescriptionPdf(params.id);
    if (!out) return notFound();

    return new NextResponse(out.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${out.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[paciente/recetas/pdf] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
