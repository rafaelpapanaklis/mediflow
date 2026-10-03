// GET/PUT /api/cobro-automatico/config — el interruptor del cobro automático con
// tarjeta (ws1-t6). APAGADO de fábrica (decisión de Rafael: todo manual). Solo se
// enciende con la cuenta de Mercado Pago conectada y el SQL pegado. Mismo permiso
// que el resto de Configuración → Anticipos (settings.edit).

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logAudit } from "@/lib/audit";
import { estadoConfig, guardarInterruptor } from "@/lib/cobro-automatico/servicio.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;
  return NextResponse.json(await estadoConfig(ctx.clinicId));
}

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "Falta «enabled»." }, { status: 400 });
  const r = await guardarInterruptor({ clinicId: ctx.clinicId, enabled: body.enabled, userId: ctx.userId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "clinic",
    entityId: ctx.clinicId,
    action: "update",
    changes: { cobroAutomaticoTarjeta: { before: !body.enabled, after: body.enabled } },
  });
  return NextResponse.json(await estadoConfig(ctx.clinicId));
}
