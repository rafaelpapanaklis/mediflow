// GET /api/cfdi/descarga/[cfdiId]?f=pdf|xml&e=<caduca>&t=<firma> — PÚBLICA (ws1-t8, F-17).
//
// El enlace que recibe el paciente por WhatsApp. No hay sesión: lo que autoriza es la firma
// (HMAC con un secreto del servidor, lib/cfdi/enlace-descarga.server.ts) y que no haya caducado.
// La clínica sale del propio CFDI. La llave de Facturapi nunca llega al navegador: es el mismo
// proxy que /api/cfdi/[cfdiId]/pdf|xml. Un CFDI cancelado ya no se entrega.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { downloadInvoiceFileForOrg } from "@/lib/facturapi";
import { verificarEnlaceCfdi } from "@/lib/cfdi/enlace-descarga.server";
import { cfdiSePuedeEnviar } from "@/lib/cfdi/envio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function texto(status: number, mensaje: string) {
  return new NextResponse(mensaje, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: { cfdiId: string } }) {
  const rl = rateLimit(req, 20, 60 * 1000);
  if (rl) return rl;

  const q = req.nextUrl.searchParams;
  const formato = q.get("f") === "xml" ? "xml" : q.get("f") === "pdf" ? "pdf" : null;
  if (!formato) return texto(400, "Enlace incompleto.");

  const veredicto = verificarEnlaceCfdi({ cfdiId: params.cfdiId, caduca: q.get("e"), token: q.get("t"), ahora: new Date() });
  if (veredicto === "invalido") return texto(404, "Este enlace no es válido.");
  if (veredicto === "caducado") return texto(410, "Este enlace ya caducó. Pídele a tu clínica que te mande la factura otra vez.");

  const record = await prisma.cfdiRecord.findUnique({
    where: { id: params.cfdiId },
    select: { facturapiId: true, uuid: true, status: true, clinic: { select: { facturApiOrgId: true } } },
  });
  if (!record?.facturapiId || !record.clinic?.facturApiOrgId) return texto(404, "Esta factura ya no está disponible.");
  if (!cfdiSePuedeEnviar(record.status)) return texto(410, "Esta factura fue cancelada. Pregunta en tu clínica.");

  try {
    const buf = await downloadInvoiceFileForOrg(record.clinic.facturApiOrgId, record.facturapiId, formato);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": formato === "pdf" ? "application/pdf" : "application/xml",
        "Content-Disposition": `${formato === "pdf" ? "inline" : "attachment"}; filename="CFDI-${record.uuid}.${formato}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    console.error("[cfdi/descarga] error:", err instanceof Error ? err.message : err);
    return texto(502, "No pudimos traer la factura en este momento. Intenta de nuevo en unos minutos.");
  }
}
