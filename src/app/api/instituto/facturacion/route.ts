import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { parseEduInvoiceFilters } from "@/lib/edu/facturacion-core";
import { emitEduInvoice, listEduInvoices } from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * 🔴 H-82 · TIMBRAR SON CINCO O SEIS SALTOS DE RED (llave de la
 * organización, lista negra EFOS, alta del receptor, el timbre, la
 * descarga del XML) y el default de la plataforma corta mucho antes. Cada
 * corte deja una factura en «Timbrando» que hay que resolver a mano y un
 * cobro bloqueado, así que lo excepcional dejaba de serlo.
 *
 * 60 s es el techo del plan de Vercel en el que corre esto; no lo hace
 * infalible, pero saca del camino el corte por impaciencia de la
 * plataforma.
 */
export const maxDuration = 60;

/** GET — las facturas del instituto (con sus filtros). */
export async function GET(request: Request) {
  const g = await eduApiGuard("facturacion.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const page = await listEduInvoices(g.ctx, parseEduInvoiceFilters(params), {
      // H-78 · la zona del INSTITUTO: "del 1 al 31 de marzo" tiene que ser
      // marzo en la escuela, no en UTC.
      timeZone: g.ctx.institution.timezone,
    });
    return NextResponse.json(page);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/facturacion");
  }
}

/**
 * POST — FACTURA UN COBRO. Aquí se gasta un timbre.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UN COBRO NO SE FACTURA DOS VECES, Y EL CANDADO NO ESTÁ AQUÍ.
 *
 * Este handler no comprueba "¿ya tiene factura?" y sigue adelante: eso es
 * exactamente lo que dos requests simultáneos pueden leer los dos como
 * "no". El candado es el índice único (institutionId, activeChargeId) de
 * edu_invoices, y la reserva se inserta ANTES de llamar a Facturapi
 * (src/lib/edu/facturacion.ts). El segundo clic choca contra Postgres y
 * sale con 409 sin haber pedido un segundo timbre.
 *
 * 🔴 Y los importes salen del COBRO CONGELADO, no del tarifario de hoy: si
 * los conceptos del cobro no suman su total, no se timbra nada.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `institutionId` sale del ctx del guard y de ningún otro sitio: el body
 * solo trae el cobro, el receptor y las claves del SAT.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("facturacion.emit");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const emitida = await emitEduInvoice(g.ctx, {
      chargeId: body.chargeId,
      receptor:
        body.receptor && typeof body.receptor === "object"
          ? (body.receptor as Record<string, unknown>)
          : undefined,
      guardarReceptor: body.guardarReceptor,
      paymentForm: body.paymentForm,
      taxMode: body.taxMode,
    });
    return NextResponse.json({ ok: true, ...emitida }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/facturacion");
  }
}
