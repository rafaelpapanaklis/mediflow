import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import {
  BARBER_MAX_DAYS_AHEAD,
  addIsoDays,
  barberTodayISO,
  getOpenDays,
  getPublicSlots,
  isValidIsoDate,
  isBookingGateOk,
  isoDaysBetween,
  resolveBookingGate,
} from "@/lib/barber/booking";

/**
 * GET /api/barber/public/booking/[slug]/slots — huecos REALES.
 *
 *   ?modo=dias&desde=YYYY-MM-DD&dias=21 → qué días tienen algo libre
 *   ?modo=horas&fecha=YYYY-MM-DD        → los horarios de ese día
 *
 * En ambos: `servicios` (ids separados por coma) define la duración real y
 * `barbero` acota a uno (o "any" = cualquiera disponible).
 *
 * Lo que devuelve es SOLO hora + cuántos barberos hay libres. Nunca los ids
 * de quién está libre a cada hora: quién atiende lo decide el servidor al
 * crear la cita.
 */

export const dynamic = "force-dynamic";

/** Pedir horarios es barato y el cliente lo hace mucho al elegir día. */
const RL = { limit: 120, windowSec: 600 };

const MAX_RANGE_DAYS = 28;

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const limited = await persistentRateLimit(req, { ...RL, scope: "barber-public-slots" });
    if (limited) return limited;

    const gate = await resolveBookingGate(params.slug);
    if (!isBookingGateOk(gate)) {
      return NextResponse.json({ error: "Barbería no disponible" }, { status: 404 });
    }
    const shop = { id: gate.shop.id, timezone: gate.shop.timezone };

    const q = req.nextUrl.searchParams;

    // ── Duración real: la suma de los servicios elegidos ────────────────
    const serviceIds = (q.get("servicios") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (serviceIds.length === 0) {
      return NextResponse.json({ error: "Elige un servicio primero" }, { status: 400 });
    }
    const services = await prisma.barberService.findMany({
      where: { id: { in: serviceIds }, barbershopId: shop.id, isActive: true },
      select: { durationMin: true },
    });
    if (services.length !== serviceIds.length) {
      return NextResponse.json({ error: "Servicio no disponible" }, { status: 400 });
    }
    const durationMin = services.reduce((acc, s) => acc + s.durationMin, 0);

    // ── Barbero: "any"/vacío = cualquiera disponible ────────────────────
    const rawBarber = q.get("barbero");
    let barberId: string | null = null;
    if (rawBarber && rawBarber !== "any") {
      const b = await prisma.barber.findFirst({
        where: { id: rawBarber, barbershopId: shop.id, isActive: true },
        select: { id: true },
      });
      if (!b) return NextResponse.json({ error: "Barbero no disponible" }, { status: 404 });
      barberId = b.id;
    }

    const todayISO = barberTodayISO(shop.timezone);

    if (q.get("modo") === "dias") {
      const desdeRaw = q.get("desde");
      const desde = isValidIsoDate(desdeRaw) && desdeRaw >= todayISO ? desdeRaw : todayISO;
      if (isoDaysBetween(todayISO, desde) > BARBER_MAX_DAYS_AHEAD) {
        return NextResponse.json({ days: [], from: desde, to: desde });
      }
      const pedidos = Number(q.get("dias") ?? MAX_RANGE_DAYS);
      const days = Math.min(
        MAX_RANGE_DAYS,
        Math.max(1, Number.isFinite(pedidos) ? Math.trunc(pedidos) : MAX_RANGE_DAYS),
        // Nunca más allá del horizonte de reserva.
        BARBER_MAX_DAYS_AHEAD - isoDaysBetween(todayISO, desde) + 1,
      );
      const open = await getOpenDays({ shop, fromISO: desde, days, durationMin, barberId });
      return NextResponse.json({
        days: open,
        from: desde,
        to: addIsoDays(desde, days - 1),
        durationMin,
      });
    }

    const fecha = q.get("fecha");
    if (!isValidIsoDate(fecha)) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }
    if (fecha < todayISO || isoDaysBetween(todayISO, fecha) > BARBER_MAX_DAYS_AHEAD) {
      return NextResponse.json({ date: fecha, slots: [], durationMin });
    }

    const slots = await getPublicSlots({ shop, dateISO: fecha, durationMin, barberId });
    return NextResponse.json({ date: fecha, slots, durationMin });
  } catch (err) {
    console.error("[barber/public/slots] error:", err);
    return NextResponse.json({ error: "No pudimos cargar los horarios" }, { status: 500 });
  }
}
