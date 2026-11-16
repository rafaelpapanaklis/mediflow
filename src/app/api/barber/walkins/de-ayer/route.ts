// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/walkins/de-ayer → «De ayer (N) · Sacarlos»
//
// La fila es del día (fila-del-dia.ts): quien se anotó antes de la
// medianoche local y nadie sacó ya no cuenta, pero su renglón sigue en
// la base como «esperando». Este botón los marca «Se fue» (LEFT), lo
// mismo que el «Se fue» de cada renglón, SOLO cuando el mostrador lo pulsa.
// Nada se borra. Los de hoy no se tocan.
//
// Gating igual que la fila: feature `walkinQueue` + permiso `walkin.manage`.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asString, jsonError, openAgendaGate, readJson } from "../../appointments/_server";
import { staleWalkInWhere, WALKIN_FEATURE } from "../_server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: "walkin.manage",
    feature: WALKIN_FEATURE,
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { shopId, timezone } = gate.gate;

  const result = await prisma.barberWalkIn.updateMany({
    where: staleWalkInWhere(shopId, timezone),
    data: { status: "LEFT" },
  });
  return NextResponse.json({ cleared: result.count });
}
