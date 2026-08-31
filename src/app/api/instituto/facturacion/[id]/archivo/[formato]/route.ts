import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { downloadEduInvoiceFile } from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * GET — descarga el XML o el PDF de una factura.
 *
 * Es un PROXY y no un enlace directo a Facturapi a propósito: los archivos
 * viven detrás de la llave secreta de la organización, y mandar esa llave
 * al navegador para ahorrarse un salto sería regalar la capacidad de
 * timbrar a nombre del instituto.
 *
 * El XML sale de la BASE cuando está guardado (lo normal). El PDF siempre
 * se pide a Facturapi — se puede regenerar, y guardar megabytes de PDF en
 * Postgres es cómo se mata una base.
 *
 * ⚠️ El nombre del archivo lleva el folio interno y el UUID: quien baja
 * cincuenta facturas necesita distinguirlas en la carpeta de Descargas.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string; formato: string } },
) {
  const g = await eduApiGuard("facturacion.view");
  if ("response" in g) return g.response;

  const formato = params.formato === "pdf" ? "pdf" : params.formato === "xml" ? "xml" : null;
  if (!formato) {
    return NextResponse.json({ error: "Solo se puede descargar XML o PDF." }, { status: 400 });
  }

  try {
    const archivo = await downloadEduInvoiceFile(g.ctx, params.id, formato);
    return new NextResponse(archivo.bytes, {
      status: 200,
      headers: {
        "Content-Type": archivo.contentType,
        "Content-Disposition": `attachment; filename="${archivo.filename}"`,
        // Un comprobante fiscal no se cachea en un proxy compartido.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/facturacion/[id]/archivo/[formato]");
  }
}
