// ═══════════════════════════════════════════════════════════════════════
// LA PUERTA PÚBLICA DE LA FIRMA — sin sesión, solo con la liga.
//
//   GET  /api/realty/signatures/[token] → el documento que hay que firmar
//   POST /api/realty/signatures/[token] → registrar la firma
//
// 🔴 ESTA RUTA NO TIENE SESIÓN Y NO DEBE TENERLA. Quien firma es un
// inquilino o un aval que no es usuario del producto. Todo lo que la
// autoriza es el token: 256 bits que solo tuvo esa persona y que en la base
// vive HASHEADO.
//
// 🔴 UNA SOLA RESPUESTA PARA TODO LO QUE NO SIRVE. El GET devuelve 404 con
// el mismo cuerpo para: token con forma rara, token que no existe, vencido,
// revocado, quemado por intentos, o de un contrato anulado o en borrador.
// Quien pruebe ligas al azar no aprende NADA — ni siquiera si el token
// existía. Es la diferencia deliberada con /share/p del dental, que dice
// "Link revocado" y con eso confirma que el token era bueno.
//
// 🔴 SIN CACHÉ, NUNCA. `no-store` en las dos respuestas: un documento a
// punto de firmarse no puede quedarse en el caché de un proxy compartido.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  ContractError,
  ContractTablesMissingError,
  contractIdForToken,
  contractRecipients,
  linkSignedDocToSource,
  openSigningToken,
  registerSignature,
} from "@/lib/realty/contracts";
import { signerEvidence } from "@/lib/realty/signature";
import { sendCompletionReceipts } from "../../contracts/_delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/** La MISMA respuesta para todos los motivos. No se afina el mensaje. */
function ligaMuerta(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Esta liga no está disponible. Puede haber vencido o haberse reemplazado por una nueva. " +
        "Pídele a tu asesor que te la mande otra vez.",
    },
    { status: 404, headers: SIN_CACHE },
  );
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const doc = await openSigningToken(params.token);
    if (!doc) return ligaMuerta();
    return NextResponse.json({ doc }, { headers: SIN_CACHE });
  } catch (e) {
    if (e instanceof ContractTablesMissingError) {
      console.error("[api/realty/signatures] tablas ausentes:", e.detail);
      return NextResponse.json(
        { error: "Este documento todavía no está disponible. Avísale a tu asesor." },
        { status: 503, headers: SIN_CACHE },
      );
    }
    console.error("[api/realty/signatures] abrir:", e);
    return NextResponse.json(
      { error: "Algo salió mal al abrir el documento." },
      { status: 500, headers: SIN_CACHE },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  try {
    const result = await registerSignature({
      token: params.token,
      strokeDataUrl: typeof body.stroke === "string" ? body.stroke : "",
      // El hash que la página le enseñó a esta persona. Si el documento
      // cambió desde que lo abrió, la firma se rechaza: nadie firma algo
      // distinto de lo que leyó.
      seenHash: typeof body.seenHash === "string" ? body.seenHash : "",
      evidence: signerEvidence(req.headers),
    });

    // Lo de después de la firma es TODO best-effort y va DESPUÉS de que la
    // firma quedó guardada: enlazar el documento con la renta de la que
    // salió y mandar el acuse. Que falle un correo no puede deshacer una
    // firma que la persona ya dio.
    if (result.complete) {
      const info = await contractIdForToken(params.token);
      if (info) {
        await linkSignedDocToSource(info.accountId, info.contractId);
        const receipt = await contractRecipients(info.accountId, info.contractId);
        if (receipt) {
          await sendCompletionReceipts({
            accountId: info.accountId,
            accountName: receipt.accountName,
            title: receipt.title,
            folio: receipt.folio,
            documentHash: receipt.documentHash,
            parties: receipt.parties,
          }).catch(() => 0);
        }
      }
    }

    return NextResponse.json(result, { headers: SIN_CACHE });
  } catch (e) {
    if (e instanceof ContractError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: SIN_CACHE });
    }
    if (e instanceof ContractTablesMissingError) {
      console.error("[api/realty/signatures] tablas ausentes:", e.detail);
      return NextResponse.json(
        { error: "Este documento todavía no está disponible. Avísale a tu asesor." },
        { status: 503, headers: SIN_CACHE },
      );
    }
    console.error("[api/realty/signatures] firmar:", e);
    return NextResponse.json(
      { error: "No pudimos registrar tu firma. Inténtalo otra vez." },
      { status: 500, headers: SIN_CACHE },
    );
  }
}
