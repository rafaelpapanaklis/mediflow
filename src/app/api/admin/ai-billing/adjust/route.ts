import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Tope por ajuste (valor absoluto, centavos MXN): un typo no debe poder mover
// más de $50,000 MXN de una vez.
const MAX_ADJUST_ABS_CENTS = 5_000_000;

// Ajuste manual del saldo (MXN cents) de una clínica. amountCents puede ser
// positivo (abono) o negativo (cargo). Atómico, mismo patrón que chargeUsage
// (src/lib/ai-billing/wallet.ts): upsert del monedero + asiento en el libro
// mayor (type ADJUSTMENT, source ADMIN) con balanceAfterCents consistente.
export async function POST(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
  const amountCents = Math.round(Number(body?.amountCents));
  const note =
    typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  if (!clinicId) return NextResponse.json({ error: "clinicId requerido" }, { status: 400 });
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    return NextResponse.json({ error: "amountCents debe ser un entero distinto de 0" }, { status: 400 });
  }
  if (Math.abs(amountCents) > MAX_ADJUST_ABS_CENTS) {
    return NextResponse.json(
      { error: `amountCents excede el tope de ±$${MAX_ADJUST_ABS_CENTS / 100} MXN por ajuste` },
      { status: 400 },
    );
  }

  try {
    // La clínica debe existir (multi-tenant: no crear monederos huérfanos).
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
    if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.aiWallet.upsert({
        where: { clinicId },
        create: { clinicId, balanceCents: amountCents },
        update: { balanceCents: { increment: amountCents } },
      });
      const txn = await tx.aiWalletTransaction.create({
        data: {
          clinicId,
          type: "ADJUSTMENT",
          amountCents,
          balanceAfterCents: wallet.balanceCents,
          source: "ADMIN",
          note,
        },
      });
      return { balanceAfterCents: wallet.balanceCents, transactionId: txn.id };
    });

    return NextResponse.json({ ok: true, clinicId, amountCents, ...result }, { status: 201 });
  } catch (err: any) {
    console.error("[admin/ai-billing/adjust POST]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
