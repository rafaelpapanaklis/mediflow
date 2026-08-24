import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import { normalizeBarberPhone } from "@/lib/barber/booking";
import {
  PORTAL_CODE_SENT_MESSAGE,
  requestPortalCode,
  resolvePortalShop,
} from "@/lib/barber/client-portal";

/**
 * POST /api/barber/portal/[slug]/code — pedir el código de acceso.
 *
 * ENUMERACIÓN DE TELÉFONOS: la respuesta es IDÉNTICA exista o no el cliente
 * — mismo status, mismo texto — y requestPortalCode() hace el mismo trabajo
 * de CPU en los dos caminos para que tampoco el tiempo lo delate. Este
 * endpoint no tiene forma de contestar "ese número no está registrado".
 *
 * El código no se envía desde aquí: T7 es dueño del WhatsApp. Fuera de
 * producción queda en el log del servidor para poder probar el flujo.
 */

export const dynamic = "force-dynamic";

/** Por IP. El tope por cliente (reenvíos) vive en requestPortalCode. */
const RL = { limit: 10, windowSec: 600 };

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const limited = await persistentRateLimit(req, { ...RL, scope: "barber-portal-code" });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const phone = normalizeBarberPhone(body?.phone);

    const shop = await resolvePortalShop(params.slug);
    if (!shop) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });

    // Un teléfono mal escrito SÍ se puede decir: eso no revela si alguien
    // está registrado, y sin el aviso el cliente se queda esperando un
    // código que nunca pidió bien.
    if (!phone) {
      return NextResponse.json(
        { error: "Escribe tu WhatsApp a 10 dígitos" },
        { status: 400 },
      );
    }

    await requestPortalCode({ barbershopId: shop.id, phone });

    return NextResponse.json({ ok: true, message: PORTAL_CODE_SENT_MESSAGE });
  } catch (err) {
    console.error("[barber/portal/code] error:", err);
    // Ni siquiera el 500 puede depender de si el cliente existe.
    return NextResponse.json(
      { error: "No pudimos enviar el código. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
