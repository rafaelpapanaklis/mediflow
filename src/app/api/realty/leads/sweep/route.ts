import { NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { checkLeadsAccess, sweepStaleLeadAssignments } from "@/lib/realty/leads";

export const dynamic = "force-dynamic";

/**
 * POST — ⭐ corre la reasignación por NO-RESPUESTA a petición.
 *
 * Existe además de la barrida perezosa del GET del embudo porque un cron
 * (Vercel) necesita un punto de entrada explícito: si nadie abre el panel
 * en toda la tarde, los prospectos de la tarde se quedarían con quien no
 * contestó, que es exactamente lo que esto viene a evitar.
 *
 * La sesión sigue mandando el accountId: NO recibe cuenta por body. Un cron
 * que quiera barrer todas las cuentas necesita una ruta de plataforma (bajo
 * /api/admin/inmobiliarias), que es de otra terminal.
 */
export async function POST() {
  const ctx = await getRealtyContext();
  const guard = checkLeadsAccess(ctx, "leads.assign");
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await sweepStaleLeadAssignments(ctx.accountId, {
    timeZone: ctx.account.timezone,
  });
  return NextResponse.json(result);
}
