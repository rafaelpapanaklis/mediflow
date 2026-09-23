import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { desconectarCuenta } from "@/lib/anticipos/cuenta.server";
import { leerPantallaAnticipos } from "@/lib/anticipos/pantalla.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/anticipos/desconectar — WS1-T5.
 *
 * Borra los tokens de Mercado Pago de la clínica y APAGA el anticipo. Los
 * links ya enviados dejan de poder verificarse: si alguien paga uno después,
 * el webhook responde 500 y Mercado Pago reintenta; al reconectar LA MISMA
 * cuenta, el reintento lo aplica. El dinero siempre está en la cuenta de MP
 * de la clínica.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;

  const antes = await leerPantallaAnticipos(ctx.clinicId);
  if (!antes.tablasListas) {
    return NextResponse.json({ error: "Falta aplicar la actualización de la base (sql/anticipo-whatsapp.sql)." }, { status: 409 });
  }
  await desconectarCuenta(ctx.clinicId);

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "clinic",
    entityId: ctx.clinicId,
    action: "update",
    changes: {
      mercadoPago: {
        before: antes.cuenta.conectada ? `conectada (${antes.cuenta.apodo ?? antes.cuenta.cuentaId ?? "?"})` : "desconectada",
        after: "desconectada",
      },
    },
    ...extractAuditMeta(req),
  });

  return NextResponse.json(await leerPantallaAnticipos(ctx.clinicId));
}
