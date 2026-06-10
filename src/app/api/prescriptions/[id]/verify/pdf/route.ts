import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { buildPrescriptionPdf } from "@/lib/pdf/prescription-pdf";

export const dynamic = "force-dynamic";

/**
 * GET /api/prescriptions/[id]/verify/pdf — descarga PÚBLICA del PDF desde
 * la página de verificación (/portal/prescription/[id]/verify).
 *
 * Sin auth: el id viaja en el QR impreso de la receta y actúa como bearer,
 * igual que la página de verificación y GET /api/prescriptions/[id]/verify.
 * Rate-limited para frenar enumeración/scraping.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const rl = rateLimit(req, 10);
  if (rl) return rl;

  const out = await buildPrescriptionPdf(params.id);
  if (!out) return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });

  return new NextResponse(out.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${out.fileName}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
