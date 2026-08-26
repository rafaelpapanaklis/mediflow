// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/signatures/[token]/pdf → SU copia del documento.
//
// Quien firmó tiene derecho a su copia con la evidencia impresa. Sin esto,
// la persona firma en su celular y se queda sin nada en la mano — que es
// exactamente lo que hace desconfiar de una firma electrónica.
//
// 🔴 EL ACCESO SALE DEL TOKEN, NO DE UN ID EN LA URL. contractIdForToken
// resuelve el par (accountId, contractId) desde el hash del token y aplica
// las mismas reglas de vida que la página: vencido o revocado → 404 opaco.
// No hay forma de pedir el PDF de otro contrato cambiando un número.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { contractIdForToken } from "@/lib/realty/contracts";
import { buildContractPdf } from "../../../contracts/_pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const info = await contractIdForToken(params.token);
    if (!info) {
      return NextResponse.json(
        { error: "Esta liga no está disponible." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const pdf = await buildContractPdf(info.accountId, info.contractId);
    if (!pdf) {
      return NextResponse.json(
        { error: "Esta liga no está disponible." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new NextResponse(new Uint8Array(pdf.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[api/realty/signatures] pdf:", e);
    return NextResponse.json(
      { error: "No pudimos armar el documento." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
