import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getOrCreateWallet } from "@/lib/ai-billing/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/ai-billing/topups/[id]   { action: "confirm" | "reject", confirmedBy? }
 * Confirma o rechaza una recarga SPEI subida por la clinica. Guard: isAdminAuthed.
 *
 *  - confirm: en UNA transaccion acredita el monedero (balanceCents += amountCents),
 *    registra AiWalletTransaction(type TOPUP, source SPEI, reference=topupId) y
 *    marca el AiTopup como PAID. El flip PENDING->PAID es un compare-and-swap
 *    (updateMany where status=PENDING), asi que es IDEMPOTENTE: nunca acredita dos
 *    veces aunque lleguen confirmaciones concurrentes o repetidas.
 *  - reject: marca el AiTopup como REJECTED sin tocar el saldo. Tambien idempotente.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const action = body?.action;
  if (action !== "confirm" && action !== "reject") {
    return NextResponse.json({ error: "action debe ser 'confirm' o 'reject'" }, { status: 400 });
  }
  const confirmedBy =
    typeof body?.confirmedBy === "string" && body.confirmedBy.trim()
      ? body.confirmedBy.trim().slice(0, 120)
      : "admin";

  const topup = await prisma.aiTopup.findUnique({ where: { id } });
  if (!topup) return NextResponse.json({ error: "Recarga no encontrada" }, { status: 404 });
  if (topup.method !== "SPEI") {
    return NextResponse.json({ error: "Esta recarga no es por SPEI" }, { status: 400 });
  }

  // ── RECHAZAR ──────────────────────────────────────────────────────────────
  if (action === "reject") {
    const claim = await prisma.aiTopup.updateMany({
      where: { id, method: "SPEI", status: "PENDING" },
      data: { status: "REJECTED", confirmedBy },
    });
    if (claim.count === 0) {
      return NextResponse.json({ ok: true, alreadyResolved: true, status: topup.status });
    }
    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  // ── CONFIRMAR (acreditar) ───────────────────────────────────────────────────
  // El monedero debe existir ANTES de la TX (el update atomico lo exige).
  await getOrCreateWallet(topup.clinicId);

  const result = await prisma.$transaction(
    async (tx): Promise<{ alreadyResolved: boolean; balanceAfterCents: number | null }> => {
      // Compare-and-swap: solo la TX que logra voltear PENDING->PAID acredita.
      const claim = await tx.aiTopup.updateMany({
        where: { id, method: "SPEI", status: "PENDING" },
        data: { status: "PAID", paidAt: new Date(), confirmedBy },
      });
      if (claim.count === 0) return { alreadyResolved: true, balanceAfterCents: null };

      const updated = await tx.aiWallet.update({
        where: { clinicId: topup.clinicId },
        data: { balanceCents: { increment: topup.amountCents } },
      });

      await tx.aiWalletTransaction.create({
        data: {
          clinicId: topup.clinicId,
          type: "TOPUP",
          amountCents: topup.amountCents,
          balanceAfterCents: updated.balanceCents,
          source: "SPEI",
          reference: topup.id,
        },
      });

      return { alreadyResolved: false, balanceAfterCents: updated.balanceCents };
    },
  );

  if (result.alreadyResolved) {
    const fresh = await prisma.aiTopup.findUnique({ where: { id }, select: { status: true } });
    return NextResponse.json({
      ok: true,
      alreadyResolved: true,
      status: fresh?.status ?? topup.status,
    });
  }

  return NextResponse.json({
    ok: true,
    status: "PAID",
    credited: true,
    amountCents: topup.amountCents,
    balanceAfterCents: result.balanceAfterCents,
  });
}
