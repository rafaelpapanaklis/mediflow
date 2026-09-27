import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { leerPantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import { validarConfiguracion, validarConfiguracionPanel } from "@/lib/anticipos/core";

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

  // ws1-t3 fase 1 — la pantalla del panel guarda SU sección sola (solo manda
  // `{ panel: {...} }`, sin tocar la config del bot); la del bot sigue
  // mandando sus campos de siempre. `botTouched` es la única forma de saber
  // cuál de las dos vino, porque "activo" ausente y "activo: false" no se
  // pueden distinguir de otro modo.
  const botTouched = "activo" in body || "modo" in body || "monto" in body || "porcentaje" in body || "minutos" in body;
  const activo = body.activo === true;
  const modo = typeof body.modo === "string" ? body.modo : "fixed";
  const monto = typeof body.monto === "number" ? Math.round(body.monto * 100) / 100 : NaN;
  const porcentaje = typeof body.porcentaje === "number" ? body.porcentaje : 0;
  const minutos = typeof body.minutos === "number" ? body.minutos : NaN;

  // Encendido, todo tiene que cuadrar. Apagado, basta con que sea guardable:
  // apagar no puede fallar porque el monto quedó vacío.
  if (botTouched) {
    const error = activo
      ? validarConfiguracion({ modo, monto, porcentaje, minutos })
      : validarConfiguracion({
          modo,
          monto: Number.isFinite(monto) && monto >= 10 ? monto : 10,
          porcentaje: Number.isInteger(porcentaje) && porcentaje >= 1 && porcentaje <= 100 ? porcentaje : 1,
          minutos,
        });
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  const pantalla = await leerPantallaAnticipos(ctx.clinicId);
  if (!pantalla.tablasListas) {
    return NextResponse.json({ error: "Falta aplicar la actualización de la base (sql/anticipo-whatsapp.sql)." }, { status: 409 });
  }
  if (!pantalla.cuenta.conectada || !pantalla.plataforma.lista) {
    return NextResponse.json({ error: "Conecta primero la cuenta de Mercado Pago de la clínica." }, { status: 409 });
  }

  // Config del anticipo pedido DESDE EL PANEL, PROPIA y separada de la del bot
  // de arriba. `panel` es opcional en el body: si no viene, se deja como está.
  const panelBody = (body.panel && typeof body.panel === "object" ? body.panel : null) as Record<string, unknown> | null;
  let panelData: { panelDepositMode: string; panelDepositAmount: number; panelDepositPercent: number; panelDepositExpiryHours: number } | null = null;
  if (panelBody) {
    const panelModo = typeof panelBody.modo === "string" ? panelBody.modo : "fixed";
    const panelMonto = typeof panelBody.monto === "number" ? Math.round(panelBody.monto * 100) / 100 : NaN;
    const panelPorcentaje = typeof panelBody.porcentaje === "number" ? panelBody.porcentaje : 0;
    const panelHoras = typeof panelBody.horas === "number" ? panelBody.horas : NaN;
    const errorPanel = validarConfiguracionPanel({ modo: panelModo, monto: panelMonto, porcentaje: panelPorcentaje, horas: panelHoras });
    if (errorPanel) return NextResponse.json({ error: errorPanel }, { status: 400 });
    panelData = {
      panelDepositMode: panelModo,
      panelDepositAmount: Number.isFinite(panelMonto) && panelMonto >= 0 ? panelMonto : 0,
      panelDepositPercent: panelModo === "percent" ? Math.min(Math.max(panelPorcentaje, 0), 100) : 0,
      panelDepositExpiryHours: panelHoras,
    };
  }

  if (!botTouched && !panelData) {
    // Nada que guardar (body vacío o inválido): no toca la base ni el log.
    return NextResponse.json(await leerPantallaAnticipos(ctx.clinicId));
  }

  const antes = pantalla.config;
  const antesPanel = pantalla.configPanel;
  // La fila existe: la creó la conexión. updateMany por clinicId de la sesión.
  await prisma.clinicMercadoPago.updateMany({
    where: { clinicId: ctx.clinicId },
    data: {
      ...(botTouched
        ? {
            depositEnabled: activo,
            depositMode: modo,
            depositAmount: Number.isFinite(monto) && monto >= 0 ? monto : 0,
            depositPercent: modo === "percent" && Number.isInteger(porcentaje) ? Math.min(Math.max(porcentaje, 0), 100) : 0,
            holdMinutes: minutos,
          }
        : {}),
      ...(panelData ?? {}),
    },
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "clinic",
    entityId: ctx.clinicId,
    action: "update",
    changes: {
      ...(botTouched
        ? {
            anticipoWhatsApp: {
              before: antes,
              after: { activo, modo, monto, porcentaje: modo === "percent" ? porcentaje : 0, minutos },
            },
          }
        : {}),
      ...(panelData
        ? {
            anticipoPanel: {
              before: antesPanel,
              after: {
                modo: panelData.panelDepositMode,
                monto: panelData.panelDepositAmount,
                porcentaje: panelData.panelDepositPercent,
                horas: panelData.panelDepositExpiryHours,
              },
            },
          }
        : {}),
    },
    ...extractAuditMeta(req),
  });

  return NextResponse.json(await leerPantallaAnticipos(ctx.clinicId));
}
