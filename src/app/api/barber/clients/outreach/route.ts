import { NextResponse } from "next/server";
import { listBarberOutreach } from "@/lib/barber/clients";
import { gateBarberClients, serverError } from "../_helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/barber/clients/outreach?kind=birthday|inactive&month=&days=
 *
 * ── GANCHO PARA T7 (WhatsApp) ────────────────────────────────────────
 * Devuelve la lista lista para mandar, NADA más: este módulo no envía
 * mensajes. Cada objetivo trae { clientId, name, phone (10 dígitos),
 * lastVisitAt, daysSinceLastVisit, birthdayDay, totalVisits, loyaltyCount }.
 *
 * Lo que YA viene filtrado (T7 no lo tiene que repetir):
 *   · Solo la barbería de la sesión.
 *   · Sin BLOQUEADOS: a quien bloqueaste no se le manda promoción.
 *   · Teléfono normalizado, listo para la plantilla.
 *
 * La lista de inactivos es la más valiosa del negocio: recuperar al que ya
 * te conoce cuesta menos que traer a uno nuevo.
 */
export async function GET(req: Request) {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;

  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") === "birthday" ? "birthday" : "inactive";
    const month = Number(url.searchParams.get("month") ?? "0");
    const days = Number(url.searchParams.get("days") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "0");

    const result = await listBarberOutreach(gate.ctx, {
      kind,
      month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : undefined,
      days: Number.isFinite(days) && days > 0 ? days : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return serverError("outreach", e);
  }
}
