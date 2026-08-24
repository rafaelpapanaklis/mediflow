import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import {
  cancelPortalAppointment,
  getPortalSession,
  isPortalActionError,
  requestPortalReschedule,
  resolvePortalShop,
  type PortalActionResult,
} from "@/lib/barber/client-portal";

/**
 * PATCH /api/barber/portal/[slug]/citas/[id] — el cliente sobre SU cita.
 *
 *   { accion: "cancelar" }                    → cancela
 *   { accion: "reagendar", mensaje?: string } → deja la petición anotada
 *
 * PERTENENCIA: el id de la cita viene de la URL, sí, pero el clientId sale
 * de la cookie firmada y va DENTRO del where de la búsqueda. Un id de la
 * cita de otra persona (o de otra barbería) no encuentra fila: 404, sin
 * filtrar ni que exista.
 */

export const dynamic = "force-dynamic";

const RL = { limit: 20, windowSec: 600 };

const ERROR_UI: Record<"notFound" | "tooLate" | "badStatus", { status: number; message: string }> = {
  notFound: { status: 404, message: "No encontramos esa cita." },
  tooLate: {
    status: 409,
    message: "Ya es muy tarde para cancelar en línea. Escríbele a la barbería, porfa.",
  },
  badStatus: { status: 409, message: "Esa cita ya no se puede cambiar." },
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string; id: string } },
) {
  try {
    const limited = await persistentRateLimit(req, { ...RL, scope: "barber-portal-cita" });
    if (limited) return limited;

    const shop = await resolvePortalShop(params.slug);
    if (!shop) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });

    const session = getPortalSession(shop.id);
    if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const accion = typeof body?.accion === "string" ? body.accion : "";

    let result: PortalActionResult;
    if (accion === "cancelar") {
      result = await cancelPortalAppointment({
        barbershopId: shop.id,
        clientId: session.clientId,
        appointmentId: params.id,
      });
    } else if (accion === "reagendar") {
      result = await requestPortalReschedule({
        barbershopId: shop.id,
        clientId: session.clientId,
        appointmentId: params.id,
        message: typeof body?.mensaje === "string" ? body.mensaje : null,
      });
    } else {
      return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
    }

    if (isPortalActionError(result)) {
      const ui = ERROR_UI[result.code];
      return NextResponse.json({ error: ui.message, code: result.code }, { status: ui.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[barber/portal/citas] error:", err);
    return NextResponse.json({ error: "No pudimos guardar el cambio." }, { status: 500 });
  }
}
