import { NextResponse, type NextRequest } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import {
  checkLeadsAccess,
  getLeadRoutingConfig,
  suggestPropertiesForLead,
} from "@/lib/realty/leads";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/**
 * GET — ⭐ inmuebles del inventario que le quedan a este prospecto, con el
 * PUNTAJE y el desglose de por qué.
 *
 * La tolerancia del presupuesto sale de la configuración de la cuenta
 * (±10% por default): quien vende terrenos de 300 mil y quien vende casas
 * de 12 millones no negocian el mismo margen.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.view");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 12;

  const config = await getLeadRoutingConfig(ctx.accountId);
  const matches = await suggestPropertiesForLead(
    ctx.accountId,
    params.id,
    {
      role: ctx.role,
      realtyUserId: ctx.realtyUserId,
      permissionsOverride: ctx.user.permissionsOverride,
    },
    { tolerancePct: config.matchTolerancePct, limit },
  );

  return NextResponse.json({ matches, tolerancePct: config.matchTolerancePct });
}
