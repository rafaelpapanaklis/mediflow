import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { getOpenRegister } from "@/lib/caja";
import { canUseCaja, verifyCajaPin } from "@/lib/caja-pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const withdrawalSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(300),
});

/**
 * Registra un retiro de efectivo en la caja abierta. 400 si no hay abierta.
 *
 * FIN-07 — esta ruta pedía SOLO `billing.view` y nada más, mientras sus
 * hermanas /open y /close exigen además acceso a Caja y el PIN de 6 dígitos.
 * Y el retiro no es una consulta: el monto entra en `reg.withdrawals`, se
 * resta de `expectedCash` (lib/caja.ts) y del snapshot que se congela al
 * cerrar. Un usuario READONLY —que trae `billing.view` en sus permisos por
 * default— no podía abrir ni cerrar la caja, pero con un POST aquí registraba
 * un retiro de $5,000: la caja quedaba con ese faltante frente al conteo
 * físico y el descuadre le salía en el corte al cajero que sí la opera.
 *
 * El bloque que sigue es el de /close letra por letra, y por el mismo motivo:
 * quien mueve el efectivo tiene que ser quien tiene la llave de la caja.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  if (!canUseCaja(ctx.user)) {
    return NextResponse.json({ error: "No tienes permiso para operar la Caja. Pide a un administrador que te habilite el acceso.", code: "CAJA_NO_ACCESS" }, { status: 403 });
  }
  const { clinicId, userId } = ctx;

  let raw: any;
  try { raw = await req.json(); } catch { raw = {}; }

  if (!ctx.user?.cajaPinHash) {
    return NextResponse.json({ error: "Configura tu PIN de Caja antes de registrar un retiro. Ve a Caja → Configurar PIN.", code: "CAJA_PIN_REQUIRED" }, { status: 402 });
  }
  if (!(await verifyCajaPin(String(raw?.pin ?? ""), ctx.user.cajaPinHash))) {
    return NextResponse.json({ error: "PIN de Caja incorrecto.", code: "CAJA_PIN_INVALID" }, { status: 403 });
  }

  try {
    const { amount, reason } = withdrawalSchema.parse(raw);

    const reg = await getOpenRegister(clinicId);
    if (!reg) return NextResponse.json({ error: "No hay caja abierta." }, { status: 400 });

    const w = await prisma.cashWithdrawal.create({
      data: { cashRegisterId: reg.id, amount, reason, recordedBy: userId },
    });

    await logMutation({
      req, clinicId, userId,
      entityType: "cash-register", entityId: reg.id, action: "update",
      after: { withdrawal: { amount, reason } },
    });

    revalidatePath("/dashboard/caja");
    return NextResponse.json({ ok: true, id: w.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 400 });
  }
}
