// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/visits/targets?search=…
//
// Lo que hace falta para agendar: inmuebles de la cartera y prospectos, ya
// recortados por cuenta, por oficina y por rol.
//
// Va aparte del GET del calendario a propósito: la agenda se refresca sola
// y arrastrar la cartera entera en cada refresco sería tirar ancho de banda
// para un selector que solo se abre cuando alguien va a agendar.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { checkVisitsAccess, searchVisitTargets } from "@/lib/realty/visits";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "visits.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const data = await searchVisitTargets(ctx, req.nextUrl.searchParams.get("search"));
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
