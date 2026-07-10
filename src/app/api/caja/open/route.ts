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

const openSchema = z.object({ openingBalance: z.number().min(0) });

// Abre la caja de la clínica. 409 si ya hay una abierta.
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

  // Caja v2: PIN obligatorio por usuario antes de abrir.
  if (!ctx.user?.cajaPinHash) {
    return NextResponse.json({ error: "Configura tu PIN de Caja antes de abrir. Ve a Caja → Configurar PIN.", code: "CAJA_PIN_REQUIRED" }, { status: 402 });
  }
  if (!(await verifyCajaPin(String(raw?.pin ?? ""), ctx.user.cajaPinHash))) {
    return NextResponse.json({ error: "PIN de Caja incorrecto.", code: "CAJA_PIN_INVALID" }, { status: 403 });
  }

  try {
    const { openingBalance } = openSchema.parse(raw);

    const existing = await getOpenRegister(clinicId);
    if (existing) return NextResponse.json({ error: "Ya hay una caja abierta." }, { status: 409 });

    const reg = await prisma.cashRegister.create({
      data: { clinicId, operatorId: userId, openingBalance, status: "OPEN" },
    });

    await logMutation({
      req, clinicId, userId,
      entityType: "cash-register", entityId: reg.id, action: "create",
      after: { openingBalance, openedAt: reg.openedAt },
    });

    revalidatePath("/dashboard/caja");
    return NextResponse.json({ ok: true, id: reg.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 400 });
  }
}
