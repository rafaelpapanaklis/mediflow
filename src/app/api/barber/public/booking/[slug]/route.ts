import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import {
  createPublicBooking,
  isBookingError,
  isBookingGateOk,
  resolveBookingGate,
  type BookingErrorCode,
} from "@/lib/barber/booking";

/**
 * POST /api/barber/public/booking/[slug] — RESERVA PÚBLICA de barbería.
 *
 * Sin sesión, sin cuenta, sin app. La barbería SIEMPRE se resuelve por el
 * slug de la URL en el servidor: este endpoint jamás acepta un barbershopId.
 *
 * A diferencia del dental (donde una solicitud pública NO llega a ser cita
 * por sí sola), aquí la cita SÍ nace y aparta el hueco:
 * BarberAppointment admite cliente suelto y BarberClient se crea/vincula por
 * teléfono. Según la política de la barbería nace PENDING (va a la bandeja
 * de /barber/solicitudes) o CONFIRMED.
 *
 * Anti-abuso SIN captcha (un captcha en móvil mata la conversión):
 *   · límite persistente por IP,
 *   · tope de citas futuras vivas por teléfono (dentro de createPublicBooking),
 *   · campo trampa `website` — invisible para una persona.
 */

export const dynamic = "force-dynamic";

/** Una familia reserva 2-3 veces seguidas; 8 en 10 minutos es holgado. */
const RL = { limit: 8, windowSec: 600 };

const ERROR_UI: Record<BookingErrorCode, { status: number; message: string }> = {
  shopNotFound: { status: 404, message: "No encontramos esta barbería." },
  shopInactive: { status: 403, message: "Esta barbería no está recibiendo reservas en línea." },
  planOff: { status: 403, message: "Esta barbería no está recibiendo reservas en línea." },
  badRequest: { status: 400, message: "Revisa los datos e intenta de nuevo." },
  noServices: { status: 400, message: "Elige al menos un servicio disponible." },
  badBarber: { status: 409, message: "Ese barbero ya no está disponible. Elige otro, porfa." },
  pastDate: { status: 400, message: "Ese horario ya pasó. Elige otro, porfa." },
  tooFar: { status: 400, message: "Esa fecha está demasiado lejos." },
  slotTaken: { status: 409, message: "Alguien acaba de tomar ese horario. Elige otro, porfa." },
  tooManyOpen: {
    status: 429,
    message: "Ya tienes varias citas apartadas con este número. Cancela una para agendar otra.",
  },
  clientBlocked: { status: 403, message: "No podemos agendar en línea con este número. Llama a la barbería." },
};

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const limited = await persistentRateLimit(req, { ...RL, scope: "barber-public-booking" });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
    }

    // Campo trampa: si viene lleno, se responde 200 como si todo hubiera ido
    // bien. Un bot que ve el error aprende a esquivarlo; uno que ve éxito no
    // vuelve a intentarlo.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return NextResponse.json({ ok: true, reference: "------", status: "PENDING" });
    }

    const gate = await resolveBookingGate(params.slug);
    if (!isBookingGateOk(gate)) {
      const code: BookingErrorCode =
        gate.reason === "notFound" ? "shopNotFound"
        : gate.reason === "inactive" ? "shopInactive"
        : "planOff";
      const ui = ERROR_UI[code];
      return NextResponse.json({ error: ui.message, code }, { status: ui.status });
    }

    const result = await createPublicBooking({
      shop: gate.shop,
      serviceIds: Array.isArray(body.serviceIds)
        ? (body.serviceIds as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
      barberId: typeof body.barberId === "string" ? body.barberId : null,
      dateISO: typeof body.date === "string" ? body.date : "",
      time: typeof body.time === "string" ? body.time : "",
      clientName: typeof body.name === "string" ? body.name : "",
      phone: typeof body.phone === "string" ? body.phone : "",
      notes:
        typeof body.notes === "string" && body.notes.trim()
          ? body.notes.trim().slice(0, 500)
          : null,
    });

    if (isBookingError(result)) {
      const ui = ERROR_UI[result.code];
      return NextResponse.json({ error: ui.message, code: result.code }, { status: ui.status });
    }

    // Lo que sale al navegador — lista COMPLETA. Nada de ids internos, ni
    // datos de otros clientes, ni el teléfono de nadie más.
    return NextResponse.json({
      ok: true,
      reference: result.reference,
      status: result.status,
      policy: result.policy,
      startAt: result.startAt,
      endAt: result.endAt,
      barberName: result.barberName,
      services: result.services,
      total: result.total,
      duplicate: result.duplicate,
    });
  } catch (err) {
    console.error("[barber/public/booking] error:", err);
    return NextResponse.json(
      { error: "No pudimos agendar tu cita. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
