import { NextResponse } from "next/server";
import { respondAgreement } from "@/lib/realty/mls";
import { gateMls, mlsApiError, mlsBadRequest, mlsNotFound, readJson } from "../../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACCIONES = ["aceptar", "rechazar", "cancelar"] as const;
type Accion = (typeof ACCIONES)[number];

/**
 * PATCH — responder a una propuesta de colaboración.
 *
 * Quién puede qué (lo decide el motor, no esta ruta):
 *   · aceptar / rechazar → SOLO quien capta. Es su inmueble.
 *   · cancelar           → cualquiera de los dos, mientras no esté cerrado.
 *
 * Al aceptar se puede mandar `agreedPct`: es la CONTRAOFERTA. Sin ella la
 * negociación se sale del producto y acaba por WhatsApp, que es justo lo
 * que la bolsa existe para evitar.
 *
 * El 403 de "forbidden" se distingue del 404 a propósito, y aquí sí es
 * seguro: para llegar a ese punto el motor ya confirmó que mi cuenta es una
 * de las dos partes del acuerdo. No hay oráculo que filtre nada: ya sé que
 * existe porque es mío.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const accion = body.accion;
    if (typeof accion !== "string" || !(ACCIONES as readonly string[]).includes(accion)) {
      return mlsBadRequest("Esa acción no existe.", "BAD_ACTION");
    }

    const res = await respondAgreement(
      gate.ctx,
      params.id,
      accion as Accion,
      body.agreedPct === undefined || body.agreedPct === null
        ? undefined
        : Number(body.agreedPct),
    );

    if (!res.ok) {
      switch (res.reason) {
        case "forbidden":
          return NextResponse.json(
            { error: "Solo quien tiene el inmueble puede responder.", code: "FORBIDDEN" },
            { status: 403 },
          );
        case "closed":
          return NextResponse.json(
            {
              error: "Ese acuerdo ya se cerró contra una operación y no se puede cambiar.",
              code: "CLOSED",
            },
            { status: 409 },
          );
        case "bad_pct":
          return mlsBadRequest("El porcentaje tiene que estar entre 0 y 100.", "BAD_PCT");
        default:
          return mlsNotFound();
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mlsApiError("acuerdos/[id]:PATCH", e);
  }
}
