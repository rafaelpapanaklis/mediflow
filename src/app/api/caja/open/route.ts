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

const openSchema = z.object({ openingBalance: z.number().min(0) });

// Abre la caja de la clínica. 409 si ya hay una abierta.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  const { clinicId, userId } = ctx;

  try {
    const { openingBalance } = openSchema.parse(await req.json());

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
