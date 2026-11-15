import { NextResponse } from "next/server";
import { listClientSales } from "@/lib/barber/client-sales";
import { gateBarberClients, serverError } from "../../_helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/barber/clients/[id]/sales?page=N — los cobros (tickets) de un
 * cliente. Solo lectura. Importes: cash.view, o el rol Barbero en un cliente
 * SUYO (solo lo que cobró él). La barbería sale de la sesión.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;
  try {
    const page = Number(new URL(req.url).searchParams.get("page") ?? "1");
    const result = await listClientSales(gate.ctx, params.id, { page });
    if (!result.allowed) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError("sales.get", e);
  }
}
