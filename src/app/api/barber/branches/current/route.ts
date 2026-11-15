import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";

// GET /api/barber/branches/current → { branchId } de la sede que opera la
// sesión AHORA (la cookie validada). Lo usa sede-pin.ts para saber si una
// escritura rechazada fue porque otra pestaña cambió de sede (ronda 2, M3).
// No expone nada que la sesión no vea ya en la barra de arriba.

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ branchId: ctx.barbershopId }, { headers: { "Cache-Control": "no-store" } });
}
