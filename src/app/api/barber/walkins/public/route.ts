// ═══════════════════════════════════════════════════════════════════════
// API PÚBLICA de la fila virtual — la que usa el QR del mostrador.
//
//   GET  /api/barber/walkins/public?slug=…            → estado de la fila
//   GET  /api/barber/walkins/public?slug=…&ticket=…   → + mi lugar
//   POST /api/barber/walkins/public                   → anotarme
//
// SIN SESIÓN, así que las reglas son otras:
//   · La barbería sale del SLUG (identificador público de diseño), nunca de
//     un barbershopId del body. Con eso es imposible escribir en otra.
//   · resolvePublicShop() cierra la página sola si la barbería está
//     desactivada, dejó de pagar o su plan no incluye la fila virtual.
//   · NO se devuelve NADA de los demás en la fila: ni nombres, ni
//     teléfonos, ni ids. Solo CUÁNTOS hay. Lo único personal que sale es lo
//     de quien trae su propio ticket (un cuid no adivinable).
//   · Rate-limit por IP para que nadie llene la fila de fantasmas.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  estimateWaitMinutes,
  formatWaitMinutes,
  toWalkInDTO,
  walkInRank,
  walkInsAhead,
} from "@/lib/barber/agenda";
import {
  clientIp,
  createWalkIn,
  loadQueueSnapshot,
  publicRateLimited,
  resolvePublicShop,
} from "../_server";

export const dynamic = "force-dynamic";

const MAX_NAME = 60;
const JOIN_MAX = 4;
const JOIN_WINDOW_MS = 10 * 60_000;
const READ_MAX = 120;
const READ_WINDOW_MS = 60_000;

function shopError(error: "NOT_FOUND" | "CLOSED" | "NO_FEATURE") {
  if (error === "NOT_FOUND") {
    return NextResponse.json({ error: "Esta barbería no existe." }, { status: 404 });
  }
  // CLOSED y NO_FEATURE se contestan igual hacia afuera: desde la calle no
  // hay por qué saber si dejó de pagar o si su plan no trae la función.
  return NextResponse.json(
    { error: "La fila virtual de esta barbería no está disponible.", code: error },
    { status: 404 },
  );
}

// ── GET: estado de la fila (y mi lugar si traigo ticket) ───────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "Falta la barbería." }, { status: 400 });

  if (publicRateLimited(`walkin-read:${clientIp(req)}`, READ_MAX, READ_WINDOW_MS)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const resolved = await resolvePublicShop(slug);
  if (resolved.error) return shopError(resolved.error);
  const shop = resolved.shop;

  const snapshot = await loadQueueSnapshot(shop.id);
  const queue = snapshot.rows.map(toWalkInDTO);

  const barbers = await prisma.barber.findMany({
    where: { barbershopId: shop.id, isActive: true },
    // Select explícito: de un barbero solo sale lo que ya es público en la
    // mini-web. Nada de comisiones ni renta de silla.
    select: { id: true, name: true, nickname: true, photoUrl: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const ticket = (url.searchParams.get("ticket") ?? "").trim();
  const me = ticket ? await loadTicket(shop.id, ticket, queue, snapshot) : null;

  return NextResponse.json({
    shop: { name: shop.name, slug: shop.slug, logoUrl: shop.logoUrl },
    // Solo el CONTEO. Los nombres y teléfonos de los demás no salen de aquí.
    waiting: queue.length,
    chairs: snapshot.chairs,
    avgServiceMin: snapshot.avgServiceMin,
    barbers: barbers.map((b) => ({
      id: b.id,
      name: b.nickname || b.name,
      photoUrl: b.photoUrl,
    })),
    me,
  });
}

async function loadTicket(
  shopId: string,
  ticketId: string,
  queue: ReturnType<typeof toWalkInDTO>[],
  snapshot: Awaited<ReturnType<typeof loadQueueSnapshot>>,
) {
  const entry = await prisma.barberWalkIn.findFirst({
    where: { id: ticketId, barbershopId: shopId },
    select: {
      id: true,
      clientName: true,
      status: true,
      barberId: true,
      joinedAt: true,
      calledAt: true,
    },
  });
  if (!entry) return null;

  const rank = walkInRank(queue, entry.id);
  const ahead = walkInsAhead(queue, entry.id);
  const etaMinutes = estimateWaitMinutes({
    ahead,
    chairs: snapshot.chairs,
    avgServiceMin: snapshot.avgServiceMin,
  });

  return {
    ticketId: entry.id,
    // Su propio nombre sí: es el que acaba de escribir.
    clientName: entry.clientName,
    status: entry.status,
    barberId: entry.barberId,
    joinedAt: entry.joinedAt.toISOString(),
    calledAt: entry.calledAt ? entry.calledAt.toISOString() : null,
    rank,
    ahead,
    etaMinutes,
    etaLabel: formatWaitMinutes(etaMinutes),
  };
}

// ── POST: anotarme en la fila ──────────────────────────────────────────
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "Falta la barbería." }, { status: 400 });

  if (publicRateLimited(`walkin-join:${clientIp(req)}`, JOIN_MAX, JOIN_WINDOW_MS)) {
    return NextResponse.json(
      { error: "Ya te anotaste varias veces. Pregunta en el mostrador." },
      { status: 429 },
    );
  }

  const resolved = await resolvePublicShop(slug);
  if (resolved.error) return shopError(resolved.error);
  const shop = resolved.shop;

  const clientName = String(body.name ?? "").trim().slice(0, MAX_NAME);
  if (clientName.length < 2) {
    return NextResponse.json({ error: "Escribe tu nombre." }, { status: 400 });
  }
  const phone = mxTenDigits(String(body.phone ?? ""));
  if (!phone) {
    return NextResponse.json(
      { error: "Escribe tu WhatsApp a 10 dígitos para poder avisarte." },
      { status: 400 },
    );
  }

  // El barbero es una PREFERENCIA, no una asignación. Se valida que sea de
  // esta barbería para que nadie mande el id de un barbero de otra.
  const rawBarberId = String(body.barberId ?? "").trim();
  let barberId: string | null = null;
  if (rawBarberId) {
    const barber = await prisma.barber.findFirst({
      where: { id: rawBarberId, barbershopId: shop.id, isActive: true },
      select: { id: true },
    });
    barberId = barber?.id ?? null;
  }

  // Si ya está formado con el mismo teléfono, se le devuelve SU ticket en
  // vez de duplicarlo (volver a escanear el QR es lo más normal del mundo).
  const existing = await prisma.barberWalkIn.findFirst({
    where: { barbershopId: shop.id, phone, status: { in: ["WAITING", "CALLED"] } },
    select: { id: true },
    orderBy: { position: "asc" },
  });

  const entry = existing
    ? await prisma.barberWalkIn.findUniqueOrThrow({ where: { id: existing.id } })
    : await createWalkIn(shop.id, { clientName, phone, barberId });

  const snapshot = await loadQueueSnapshot(shop.id);
  const queue = snapshot.rows.map(toWalkInDTO);
  const ahead = walkInsAhead(queue, entry.id);
  const etaMinutes = estimateWaitMinutes({
    ahead,
    chairs: snapshot.chairs,
    avgServiceMin: snapshot.avgServiceMin,
  });

  return NextResponse.json(
    {
      ticketId: entry.id,
      alreadyInQueue: Boolean(existing),
      clientName: entry.clientName,
      status: entry.status,
      barberId: entry.barberId,
      rank: walkInRank(queue, entry.id),
      ahead,
      etaMinutes,
      etaLabel: formatWaitMinutes(etaMinutes),
      waiting: queue.length,
    },
    { status: existing ? 200 : 201 },
  );
}
