import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { extractAuditMeta, logAudit } from "@/lib/audit";
import { conFuncionIa, esFuncionIa, sanitizeAiSettings } from "@/lib/ai-billing/interruptores";

export const dynamic = "force-dynamic";

/**
 * Interruptores de IA de la clínica (Saldo de IA → Funciones de IA).
 *
 * GET — lo que está apagado. Cualquier sesión de la clínica: la pantalla se lo
 *       enseña a todos para que sepan por qué algo no responde.
 * PATCH { funcion, encendida } — solo ADMIN, como la auto-recarga: decide en
 *       qué gasta la clínica. Cambia UNA función y deja las demás como están.
 *
 * clinicId SIEMPRE de la sesión. El corte de verdad no está aquí: está en cada
 * ruta que llama a la IA (`cortarSiIaApagada` / `funcionIaApagada`).
 */
export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { aiSettings: true },
    });
    return NextResponse.json({
      apagadas: sanitizeAiSettings(clinic?.aiSettings).apagadas,
      isAdmin: ctx.isAdmin,
    });
  } catch {
    return NextResponse.json({ error: "No se pudieron leer las funciones de IA" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const err = requireAdmin(ctx);
    if (err) return err;

    const body = await req.json().catch(() => null);
    const funcion = body?.funcion;
    if (!esFuncionIa(funcion) || typeof body?.encendida !== "boolean") {
      return NextResponse.json({ error: "Función o valor inválido" }, { status: 400 });
    }
    const encendida: boolean = body.encendida;

    // Leer y escribir la config ENTERA: se guarda la lista de apagadas, así
    // que cambiar una sin leer las otras las encendería todas. Con la fila de
    // la clínica BLOQUEADA (FOR UPDATE): sin candado, dos administradores que
    // apagan dos funciones a la vez leen la misma lista y el segundo en
    // escribir vuelve a encender la del primero.
    const { antes, despues } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "clinics" WHERE id = ${ctx.clinicId} FOR UPDATE`;
      const actual = await tx.clinic.findUnique({
        where: { id: ctx.clinicId },
        select: { aiSettings: true },
      });
      const antes = sanitizeAiSettings(actual?.aiSettings);
      const despues = conFuncionIa(antes, funcion, encendida);
      await tx.clinic.update({
        where: { id: ctx.clinicId },
        data: { aiSettings: { ...despues } },
        select: { id: true },
      });
      return { antes, despues };
    });

    await logAudit({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "ai-wallet",
      entityId: ctx.clinicId,
      action: "update",
      changes: { [`funcionIa.${funcion}`]: { before: !antes.apagadas.includes(funcion), after: encendida } },
      ...extractAuditMeta(req),
    });

    return NextResponse.json({ apagadas: despues.apagadas, isAdmin: ctx.isAdmin });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}
