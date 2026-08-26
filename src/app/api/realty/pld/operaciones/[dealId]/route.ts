// PATCH /api/realty/pld/operaciones/[dealId] — las decisiones de una
// persona sobre una operación: el efectivo declarado, el acuse de la
// bandera roja y la alerta de 24 horas.
//
// 🔴 AQUÍ NO SE GUARDA NINGÚN UMBRAL NI NINGÚN VEREDICTO. El nivel de una
// operación se recalcula siempre en vivo contra el parámetro vigente. Si se
// guardara, una operación evaluada con la UMA del año pasado seguiría
// diciendo "no rebasa" para siempre.
import { NextResponse } from "next/server";
import { guardarOperacion, type ParcheOperacion } from "@/lib/realty/pld/operaciones";
import { getPldParams } from "@/lib/realty/pld/parametros";
import { errorPld, gatePld, leerJson, malaPeticion } from "../../_guard";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { dealId: string } }) {
  const gate = await gatePld("pld.manage");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const body = await leerJson(req);
    const parche: ParcheOperacion = {};

    // Lista blanca campo por campo. Nunca un spread del body: un `noticeId`
    // colado ahí ataría la operación a un aviso que nadie presentó.
    if ("cashDeclared" in body) {
      const raw = body.cashDeclared;
      if (raw === null || raw === "") {
        parche.cashDeclared = null;
      } else {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n) || n < 0) return malaPeticion("Ese monto en efectivo no se entiende.");
        parche.cashDeclared = n;
      }
    }
    if ("cashAckNote" in body) {
      parche.cashAckNote = typeof body.cashAckNote === "string" ? body.cashAckNote : null;
    }
    if ("urgentReason" in body) {
      parche.urgentReason = typeof body.urgentReason === "string" ? body.urgentReason : null;
    }
    if ("urgentDone" in body) {
      parche.urgentDone = body.urgentDone === true;
    }

    // Los parámetros hacen falta para calcular el vencimiento de la alerta
    // urgente. Si faltan, guardarOperacion devuelve el error que lo explica
    // en vez de inventar un plazo.
    const resueltos = await getPldParams();
    const res = await guardarOperacion(
      ctx,
      params.dealId,
      parche,
      resueltos.ok ? resueltos.params : null,
    );
    if ("error" in res) return malaPeticion(res.error);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorPld("operaciones", e);
  }
}
