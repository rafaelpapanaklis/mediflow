// ═══════════════════════════════════════════════════════════════════════
// GET  /api/barber/walkins  → la fila en orden + datos para estimar espera
// POST /api/barber/walkins  → el mostrador anota a alguien que acaba de llegar
//
// Gating: feature `walkinQueue` (Avanzado y Profesional) + permiso
// `walkin.manage`. El gate REAL está aquí, en el servidor: esconder el
// menú no es un permiso.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { clientsViewScope, scopeUserFromCtx } from "@/lib/barber/own-visits";
import {
  estimateWaitMinutes,
  toBarberDTO,
  toWalkInDTO,
  walkInsAhead,
} from "@/lib/barber/agenda";
import { asString, jsonError, openAgendaGate, readJson } from "../appointments/_server";
import { createWalkIn, loadQueueSnapshot, WALKIN_FEATURE } from "./_server";

export const dynamic = "force-dynamic";

const MAX_NAME = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openAgendaGate({
    permission: "walkin.manage",
    feature: WALKIN_FEATURE,
    branchId: url.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;
  const { shopId, timezone, ctx } = gate.gate;

  // La fila es de todos (cualquiera con walkin.manage sienta gente), pero lo
  // ajeno no viaja (A-M1, ronda 10):
  //  · sin barbers.manage, de los compañeros no salen comisión ni renta;
  //  · con el alcance de clientes recortado (rol Barbero), «recientes» son
  //    solo los suyos y las filas que no son suyas van sin teléfono.
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const seesPay = hasBarberPermission(permUser, "barbers.manage");
  const ownBarberId = ctx.barber?.id ?? null;
  const clientScope = clientsViewScope(scopeUserFromCtx(ctx));
  const mine = clientScope.kind === "own" ? clientScope.barberId : null;
  const narrowed = clientScope.kind !== "all";

  const [snapshot, barbers, services, recent] = await Promise.all([
    loadQueueSnapshot(shopId, timezone),
    prisma.barber.findMany({
      where: { barbershopId: shopId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.barberService.findMany({
      where: { barbershopId: shopId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, durationMin: true, price: true },
    }),
    // Las últimas 10 que salieron de la fila hoy: sirven para deshacer un
    // "se fue" tocado por error.
    prisma.barberWalkIn.findMany({
      where: {
        barbershopId: shopId,
        status: { in: ["SERVED", "LEFT"] },
        updatedAt: { gt: new Date(Date.now() - 12 * 3_600_000) },
        ...(narrowed ? { barberId: mine ?? { in: [] as string[] } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  const hidePhone = <T extends { barberId: string | null; phone: string | null }>(row: T): T =>
    narrowed && (!mine || row.barberId !== mine) ? { ...row, phone: null } : row;
  const queue = snapshot.rows.map(toWalkInDTO).map(hidePhone);
  return NextResponse.json({
    branchId: shopId,
    timezone,
    chairs: snapshot.chairs,
    avgServiceMin: snapshot.avgServiceMin,
    barbers: barbers
      .map(toBarberDTO)
      .map((b) => (seesPay || b.id === ownBarberId ? b : { ...b, commissionPct: null, chairRent: null })),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      price: Number(s.price),
    })),
    queue: queue.map((row, index) => {
      const ahead = walkInsAhead(queue, row.id);
      return {
        ...row,
        rank: index + 1,
        ahead,
        etaMinutes: estimateWaitMinutes({
          ahead,
          chairs: snapshot.chairs,
          avgServiceMin: snapshot.avgServiceMin,
        }),
      };
    }),
    recent: recent.map(toWalkInDTO).map(hidePhone),
  });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: "walkin.manage",
    feature: WALKIN_FEATURE,
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  const clientName = (asString(body.clientName) ?? "").slice(0, MAX_NAME);
  if (!clientName) return jsonError("Escribe el nombre del cliente.", 400);

  const phone = mxTenDigits(asString(body.phone) ?? "");
  const barberId = asString(body.barberId);
  if (barberId) {
    const barber = await prisma.barber.findFirst({
      where: { id: barberId, barbershopId: shopId, isActive: true },
      select: { id: true },
    });
    if (!barber) return jsonError("Ese barbero no existe en tu barbería.", 404);
  }

  const created = await createWalkIn(shopId, { clientName, phone, barberId: barberId ?? null });
  return NextResponse.json({ walkIn: toWalkInDTO(created) }, { status: 201 });
}
