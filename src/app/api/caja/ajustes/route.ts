// GET/PUT /api/caja/ajustes — ajustes de dinero de la clínica (ws1-t5):
//   · cajaCierreAutomatico: cierre automático de caja a medianoche (apagado de fábrica).
// Leer: billing.view. Cambiar el cierre automático: settings.edit.
// Sin sql/ws1-t5-dinero-caja.sql: GET da los de fábrica y PUT contesta 503.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { guardarAjustesDinero, leerAjustesDinero } from "@/lib/dinero/ajustes.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  return NextResponse.json(await leerAjustesDinero(ctx.clinicId));
}

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const cambios: { cajaCierreAutomatico?: boolean } = {};
  if (body?.cajaCierreAutomatico !== undefined) {
    const denied = denyIfMissingPermission(ctx, "settings.edit");
    if (denied) return denied;
    if (typeof body.cajaCierreAutomatico !== "boolean") return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
    cambios.cajaCierreAutomatico = body.cajaCierreAutomatico;
  }
  if (Object.keys(cambios).length === 0) return NextResponse.json({ error: "Nada que guardar" }, { status: 400 });

  const antes = await leerAjustesDinero(ctx.clinicId);
  const ok = await guardarAjustesDinero(ctx.clinicId, ctx.userId, cambios);
  if (!ok) return NextResponse.json({ error: "Falta pegar sql/ws1-t5-dinero-caja.sql.", code: "SQL_PENDIENTE" }, { status: 503 });
  await logMutation({
    req, clinicId: ctx.clinicId, userId: ctx.userId, entityType: "clinic", entityId: ctx.clinicId, action: "update",
    before: { cajaCierreAutomatico: antes.cajaCierreAutomatico },
    after: { cajaCierreAutomatico: cambios.cajaCierreAutomatico ?? antes.cajaCierreAutomatico },
    texto: "Cambió los ajustes de caja",
  });
  return NextResponse.json(await leerAjustesDinero(ctx.clinicId));
}
