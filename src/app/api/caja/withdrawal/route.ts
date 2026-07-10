import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { getOpenRegister } from "@/lib/caja";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const withdrawalSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(300),
});

// Registra un retiro de efectivo en la caja abierta. 400 si no hay abierta.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  const { clinicId, userId } = ctx;

  try {
    const { amount, reason } = withdrawalSchema.parse(await req.json());

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
