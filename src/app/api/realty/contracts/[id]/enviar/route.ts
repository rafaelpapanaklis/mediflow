// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/contracts/[id]/enviar → SELLAR y mandar a firmar
//
// Es el punto de no retorno del módulo: en cuanto responde, el cuerpo del
// contrato queda congelado (`sealedAt`) y hay ligas de firma vivas.
//
// Body:
//   { canal: "whatsapp" | "correo" | "copiada", partyIds?: string[] }
//
// · Sin `partyIds` → a todas las partes que faltan por firmar.
// · Con `partyIds` → SOLO a esas. Es el "reenviar" del tablero, y por eso
//   sealAndIssueLinks revoca únicamente las ligas de esas personas: mandarle
//   otra vez al aval no puede matar la liga que el inquilino tiene abierta.
//
// 🔴 SE RESPONDE LA VERDAD DE LA ENTREGA, NO LA INTENCIÓN. Cada parte trae
// su `delivered` y su motivo en español. La liga va EN CLARO en la
// respuesta —es la única vez que existe— para que el asesor pueda copiarla
// cuando el canal falle (que con WhatsApp, sin plantilla aprobada, pasa
// siempre que la ventana de 24 h esté cerrada).
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getContract, sealAndIssueLinks } from "@/lib/realty/contracts";
import { SIGNATURE_LINK_DAYS } from "@/components/realty/contracts/shared";
import { contractsApiError, gateContracts, readJson, requestOrigin } from "../../_server";
import { deliverSignatureLink, type DeliveryChannel, type DeliveryOutcome } from "../../_delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANALES: DeliveryChannel[] = ["whatsapp", "correo", "copiada"];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  const body = await readJson(req);
  const canal = CANALES.includes(body.canal as DeliveryChannel)
    ? (body.canal as DeliveryChannel)
    : "copiada";
  const partyIds = Array.isArray(body.partyIds)
    ? body.partyIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : null;

  try {
    const antes = await getContract(gate.ctx, params.id);
    if (!antes) {
      return NextResponse.json({ error: "No encontramos ese contrato." }, { status: 404 });
    }

    const links = await sealAndIssueLinks(gate.ctx, params.id, requestOrigin(req), partyIds);

    // En SERIE y no en paralelo: son dos o tres destinatarios y cada envío
    // toca el cupo de WhatsApp de la cuenta. Un Promise.all aquí compite
    // consigo mismo por el mismo contador.
    const outcomes: DeliveryOutcome[] = [];
    for (const link of links) {
      outcomes.push(
        await deliverSignatureLink({
          accountId: gate.ctx.accountId,
          accountName: gate.ctx.account.name,
          contractId: params.id,
          title: antes.title,
          folio: antes.folio,
          link,
          contact: { id: link.partyId, email: link.email, phone: link.phone },
          channel: canal,
          linkDays: SIGNATURE_LINK_DAYS,
        }),
      );
    }

    const contract = await getContract(gate.ctx, params.id);
    return NextResponse.json({ contract, outcomes });
  } catch (e) {
    return contractsApiError(e, "enviar");
  }
}
