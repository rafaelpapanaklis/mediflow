import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { resolveEduStuckInvoice } from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * POST — desatasca una factura que se quedó en «Timbrando».
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE ESTE ENDPOINT
 *
 * Cuando la llamada a Facturapi se corta a media red, no se sabe si el SAT
 * timbró. El servidor se queda del lado seguro: la factura NO pasa a
 * fallida y el cobro NO se libera, porque liberarlo sería la forma de
 * producir el CFDI duplicado que todo este módulo existe para evitar.
 *
 * El precio de esa decisión es un cobro bloqueado, y sin salida sería un
 * cobro bloqueado PARA SIEMPRE. Ésta es la salida, y pasa por que una
 * persona MIRE Facturapi y diga qué encontró:
 *
 *   { uuid: "…" }        → sí había timbre: se registra y queda VÁLIDA.
 *   { sinTimbre: true }  → no había nada: queda fallida y el cobro se
 *                          libera.
 *
 * 🔴 Exige "facturacion.config" y no "facturacion.emit" a propósito: quien
 * responde esta pregunta está afirmando algo sobre lo que el SAT tiene
 * registrado, y equivocarse aquí deja un CFDI duplicado o una factura
 * fantasma. No es una operación de mostrador.
 *
 * ⚠️ El servidor NO adivina: podría buscar en Facturapi por RFC y fecha,
 * pero confundirse de comprobante ahí es peor que pedir una verificación
 * humana con el UUID a la vista.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("facturacion.config");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const invoice = await resolveEduStuckInvoice(g.ctx, params.id, {
      uuid: body.uuid,
      sinTimbre: body.sinTimbre,
    });
    return NextResponse.json({ ok: true, invoice });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/facturacion/[id]/resolver");
  }
}
