// GET /api/patient-documents/[id]/pdf — el PDF de la nota tal y como se guardó.
// `?download=1` lo baja como archivo; sin él se abre en el visor del navegador.

import { NextRequest, NextResponse } from "next/server";
import { construirPdfDeDocumento } from "@/lib/patient-documents/pdf";
import { entrar, VER } from "../../_lib/http";
import { cargarNotaParaSalida } from "../../_lib/salida";

export const runtime = "nodejs"; // @react-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrar(req, VER, 30);
  if ("res" in e) return e.res;
  try {
    const s = await cargarNotaParaSalida(e.ctx, params.id);
    if ("res" in s) return s.res;
    const pdf = await construirPdfDeDocumento(s.doc);
    const modo = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(pdf.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${modo}; filename="${pdf.fileName}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Patient document pdf error:", err);
    return NextResponse.json({ error: "No se pudo generar el PDF" }, { status: 500 });
  }
}
