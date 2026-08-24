// ═══════════════════════════════════════════════════════════════════════
// GET /api/barber/appointments/clients?q=…  → buscador del modal de cita
//
// Vive bajo /appointments a propósito: es el buscador que necesita la
// agenda para armar una visita en 2 clics, NO el CRUD de clientes (ése es
// de otra terminal, bajo su propio prefijo). Devuelve lo mínimo —id,
// nombre, teléfono, últimas visitas— y solo de ESTA barbería.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, openAgendaGate } from "../_server";

export const dynamic = "force-dynamic";

const LIMIT = 8;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openAgendaGate({
    permission: "clients.view",
    feature: "agenda",
    branchId: url.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ clients: [] });
  if (q.length > 80) return jsonError("Búsqueda demasiado larga.", 400);

  const digits = q.replace(/\D/g, "");

  // barbershopId SIEMPRE presente: en Prisma un undefined aquí borraría el
  // filtro de inquilino y devolvería clientes de otras barberías.
  const clients = await prisma.barberClient.findMany({
    where: {
      barbershopId: shopId,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      totalVisits: true,
      lastVisitAt: true,
      blockedAt: true,
    },
    orderBy: [{ lastVisitAt: "desc" }, { name: "asc" }],
    take: LIMIT,
  });

  return NextResponse.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      totalVisits: c.totalVisits,
      lastVisitAt: c.lastVisitAt ? c.lastVisitAt.toISOString() : null,
      blocked: c.blockedAt !== null,
    })),
  });
}
