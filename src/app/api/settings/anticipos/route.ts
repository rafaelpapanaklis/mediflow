import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { leerPantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import { validarConfiguracion } from "@/lib/anticipos/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configuración → Anticipos por WhatsApp (WS1-T5).
 *
 * GET  — estado de la cuenta de Mercado Pago (sin secretos), la configuración
 *        del anticipo y los últimos anticipos (el rastro del «yo pagué»).
 * PUT  — guarda la configuración. Encender exige cuenta conectada: sin ella la
 *        función entera está apagada y la pantalla no ofrece el botón.
 *
 * Mismo permiso que el resto de integraciones de Configuración (settings.edit,
 * por default SUPER_ADMIN y ADMIN). clinicId SIEMPRE de la sesión.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;
  return NextResponse.json(await leerPantallaAnticipos(ctx.clinicId));
}

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const activo = body.activo === true;
  const modo = typeof body.modo === "string" ? body.modo : "fixed";
  const monto = typeof body.monto === "number" ? Math.round(body.monto * 100) / 100 : NaN;
  const porcentaje = typeof body.porcentaje === "number" ? body.porcentaje : 0;
  const minutos = typeof body.minutos === "number" ? body.minutos : NaN;

  // Encendido, todo tiene que cuadrar. Apagado, basta con que sea guardable:
  // apagar no puede fallar porque el monto quedó vacío.
  const error = activo
    ? validarConfiguracion({ modo, monto, porcentaje, minutos })
    : validarConfiguracion({
        modo,
        monto: Number.isFinite(monto) && monto >= 10 ? monto : 10,
        porcentaje: Number.isInteger(porcentaje) && porcentaje >= 1 && porcentaje <= 100 ? porcentaje : 1,
        minutos,
      });
  if (error) return NextResponse.json({ error }, { status: 400 });

  const pantalla = await leerPantallaAnticipos(ctx.clinicId);
  if (!pantalla.tablasListas) {
    return NextResponse.json({ error: "Falta aplicar la actualización de la base (sql/anticipo-whatsapp.sql)." }, { status: 409 });
  }
  if (!pantalla.cuenta.conectada || !pantalla.plataforma.lista) {
    return NextResponse.json({ error: "Conecta primero la cuenta de Mercado Pago de la clínica." }, { status: 409 });
  }

  const antes = pantalla.config;
  // La fila existe: la creó la conexión. updateMany por clinicId de la sesión.
  await prisma.clinicMercadoPago.updateMany({
    where: { clinicId: ctx.clinicId },
    data: {
      depositEnabled: activo,
      depositMode: modo,
      depositAmount: Number.isFinite(monto) && monto >= 0 ? monto : 0,
      depositPercent: modo === "percent" && Number.isInteger(porcentaje) ? Math.min(Math.max(porcentaje, 0), 100) : 0,
      holdMinutes: minutos,
    },
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "clinic",
    entityId: ctx.clinicId,
    action: "update",
    changes: {
      anticipoWhatsApp: {
        before: antes,
        after: { activo, modo, monto, porcentaje: modo === "percent" ? porcentaje : 0, minutos },
      },
    },
    ...extractAuditMeta(req),
  });

  return NextResponse.json(await leerPantallaAnticipos(ctx.clinicId));
}
