import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { leerPantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import { cerrarLinksDelPortal } from "@/lib/patient-portal/pago-mercadopago.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/anticipos/portal — el interruptor del pago en línea del
 * portal del paciente (ws1-t2). Body: { activo: boolean } → la pantalla entera.
 *
 * APARTE del anticipo del bot (PUT /api/settings/anticipos): son dos cosas
 * distintas y cada una se guarda sola.
 *
 * · Mismo permiso que conectar la cuenta: settings.edit (no recepción).
 * · Solo con cuenta conectada: sin cuenta no hay interruptor (409).
 * · clinicId SIEMPRE de la sesión.
 * · Al APAGAR, los links que nacieron en el portal y siguen abiertos se cierran
 *   en Mercado Pago: el paciente que tenga uno ya no paga por ahí. Los que
 *   mandó la recepción no se tocan.
 */
export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;
  if (!ctx.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.activo !== "boolean") {
    return NextResponse.json({ error: "Falta «activo» (true o false)." }, { status: 400 });
  }
  const activo = body.activo;

  const antes = await leerPantallaAnticipos(ctx.clinicId);
  if (!antes.tablasListas) {
    return NextResponse.json(
      { error: "Falta aplicar la actualización de la base (sql/ws1-t2-portal-pago-en-linea-interruptor.sql)." },
      { status: 409 },
    );
  }
  if (!antes.cuenta.conectada || !antes.plataforma.lista) {
    return NextResponse.json({ error: "Conecta primero la cuenta de Mercado Pago de la clínica." }, { status: 409 });
  }

  // La fila existe: la creó la conexión. updateMany por clinicId de la sesión.
  await prisma.clinicMercadoPago.updateMany({
    where: { clinicId: ctx.clinicId },
    data: { portalPaymentsEnabled: activo },
  });
  const cerrados = activo ? 0 : await cerrarLinksDelPortal({ clinicId: ctx.clinicId });

  if (antes.portal.activo !== activo) {
    await logAudit({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "clinic",
      entityId: ctx.clinicId,
      action: "update",
      changes: {
        pagoEnLineaPortal: { before: antes.portal.activo, after: activo },
        ...(cerrados > 0 ? { linksDelPortalCerrados: { before: cerrados, after: 0 } } : {}),
      },
      ...extractAuditMeta(req),
    });
  }

  return NextResponse.json(await leerPantallaAnticipos(ctx.clinicId));
}
