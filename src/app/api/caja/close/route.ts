import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { getOpenRegister, deriveWindow, money } from "@/lib/caja";
import { canUseCaja, verifyCajaPin } from "@/lib/caja-pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const closeSchema = z.object({
  countedClosingBalance: z.number().min(0),
  closingNotes: z.string().trim().max(1000).optional(),
});

// Cierra la caja abierta: congela el snapshot y marca CLOSED. 400 si no hay abierta.
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

  // Caja v2: PIN obligatorio por usuario antes de cerrar.
  if (!ctx.user?.cajaPinHash) {
    return NextResponse.json({ error: "Configura tu PIN de Caja antes de cerrar. Ve a Caja → Configurar PIN.", code: "CAJA_PIN_REQUIRED" }, { status: 402 });
  }
  if (!(await verifyCajaPin(String(raw?.pin ?? ""), ctx.user.cajaPinHash))) {
    return NextResponse.json({ error: "PIN de Caja incorrecto.", code: "CAJA_PIN_INVALID" }, { status: 403 });
  }

  try {
    const { countedClosingBalance, closingNotes } = closeSchema.parse(raw);

    const reg = await getOpenRegister(clinicId);
    if (!reg) return NextResponse.json({ error: "No hay caja abierta." }, { status: 400 });

    const now = new Date();
    const derived = await deriveWindow(clinicId, reg.openedAt, now);
    const withdrawalsTotal = reg.withdrawals.reduce((s, w) => s + (w.amount ?? 0), 0);
    const expectedCash = reg.openingBalance + derived.cashIncome - withdrawalsTotal;
    const variance = countedClosingBalance - expectedCash;

    await prisma.cashRegister.update({
      where: { id: reg.id },
      data: {
        status: "CLOSED",
        closedAt: now,
        countedClosingBalance,
        closingNotes: closingNotes ?? null,
        snapshotCashIncome:   money(derived.cashIncome),
        snapshotOtherIncome:  money(derived.otherIncome),
        snapshotDiscounts:    money(derived.discounts),
        snapshotTax:          money(derived.tax),
        snapshotWithdrawals:  money(withdrawalsTotal),
        snapshotExpectedCash: money(expectedCash),
        snapshotVariance:     money(variance),
      },
    });

    await logMutation({
      req, clinicId, userId,
      entityType: "cash-register", entityId: reg.id, action: "update",
      after: {
        closed: true,
        expectedCash: money(expectedCash),
        counted: countedClosingBalance,
        variance: money(variance),
      },
    });

    revalidatePath("/dashboard/caja");
    return NextResponse.json({ ok: true, expectedCash: money(expectedCash), variance: money(variance) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 400 });
  }
}
