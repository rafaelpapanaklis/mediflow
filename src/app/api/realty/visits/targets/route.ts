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

  const sp = req.nextUrl.searchParams;
  const only = sp.get("only");

  const data = await searchVisitTargets(ctx, {
    search: sp.get("search"),
    // Cualquier otro valor pide LAS DOS listas: un `only` con basura no debe
    // dejar al diálogo sin inmuebles, solo sin el ahorro.
    only: only === "properties" || only === "leads" ? only : null,
    // Los ids fijados los resuelve la capa de datos DENTRO del alcance: aquí
    // se pasan tal cual y mandar uno ajeno simplemente no devuelve nada.
    ensurePropertyId: sp.get("propertyId"),
    ensureLeadId: sp.get("leadId"),
  });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
