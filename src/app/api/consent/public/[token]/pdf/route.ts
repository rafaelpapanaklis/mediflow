// GET /api/consent/public/[token]/pdf — la copia del paciente, en PDF.
//
// La NOM-004-SSA3-2012 numeral 10.1.1 pide que se ENTREGUE copia de la carta a
// quien la firma. Hasta ahora el PDF solo existía dentro del panel
// (/api/consent/[id]/pdf, con sesión y permiso `consents.view`): el paciente
// firmaba y se quedaba sin nada. Esta ruta cierra ese hueco desde la misma
// pantalla pública, sin sesión, con el token como credencial.
//
// Dos candados que la separan de la ruta del panel:
//   · SOLO si `signedAt` — una carta sin firmar no se expone en PDF. Antes de
//     firmar el paciente ya ve el texto íntegro en la página; el PDF con el
//     bloque de firmas solo tiene sentido cuando hay algo que acreditar.
//   · rate limit igual al GET público (20/min por IP), porque el token viaja
//     por WhatsApp y el render de @react-pdf no es gratis.
//
// El PDF se arma con `buildConsentPdf` TAL CUAL, el mismo que imprime el panel:
// la copia del paciente y la del expediente tienen que ser el mismo documento.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { buildConsentPdf } from "@/lib/consent/consent-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 20);
  if (rl) return rl;

  const form = await prisma.consentForm.findUnique({
    where: { token: params.token },
    select: { id: true, clinicId: true, signedAt: true, deletedAt: true },
  });

  if (!form || form.deletedAt) {
    return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });
  }
  if (!form.signedAt) {
    return NextResponse.json({ error: "Esta carta todavía no está firmada." }, { status: 409 });
  }

  // clinicId de la propia fila (no de una sesión que aquí no existe): el token
  // ya identifica el documento y `buildConsentPdf` revalida la pertenencia.
  const out = await buildConsentPdf(form.id, form.clinicId);
  if (!out) return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });

  return new NextResponse(out.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // attachment y no inline: el botón dice "Descargar mi carta" y el
      // paciente la abre desde su teléfono, donde el visor incrustado deja el
      // archivo en ninguna parte.
      "Content-Disposition": `attachment; filename="${out.fileName}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
