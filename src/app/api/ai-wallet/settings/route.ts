import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/ai-billing/wallet";

export const dynamic = "force-dynamic";

// Tope de seguridad para umbral/monto de auto-recarga: $50,000 MXN en centavos.
const MAX_CENTS = 5_000_000;
// Monto mínimo de recarga cuando la auto-recarga está activa: $50 MXN.
const MIN_RECHARGE_CENTS = 5000;

/**
 * Ajustes del monedero de IA. Solo ADMIN: la auto-recarga autoriza cobros
 * automáticos a la tarjeta. clinicId SIEMPRE de la sesión. La clínica solo
 * maneja MXN (centavos); jamás exponemos USD ni fees.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const err = requireAdmin(ctx);
    if (err) return err;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    // Asegura el monedero y obtén los valores actuales (para validar el mínimo).
    const wallet = await getOrCreateWallet(ctx.clinicId);

    const data: {
      autoRecharge?: boolean;
      autoRechargeThresholdCents?: number;
      autoRechargeAmountCents?: number;
    } = {};

    // autoRecharge (boolean)
    if (typeof body.autoRecharge === "boolean") {
      data.autoRecharge = body.autoRecharge;
    }

    // autoRechargeThresholdCents (número finito, 0..MAX_CENTS)
    if (body.autoRechargeThresholdCents !== undefined) {
      const raw = body.autoRechargeThresholdCents;
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return NextResponse.json({ error: "Umbral inválido" }, { status: 400 });
      }
      const threshold = Math.round(raw);
      if (threshold < 0) {
        return NextResponse.json({ error: "Umbral inválido" }, { status: 400 });
      }
      data.autoRechargeThresholdCents = Math.min(threshold, MAX_CENTS);
    }

    // autoRechargeAmountCents (número finito, 0..MAX_CENTS)
    if (body.autoRechargeAmountCents !== undefined) {
      const raw = body.autoRechargeAmountCents;
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
      }
      const amount = Math.round(raw);
      if (amount < 0) {
        return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
      }
      data.autoRechargeAmountCents = Math.min(amount, MAX_CENTS);
    }

    // Si no hay ningún campo válido para actualizar, error.
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    // auto-recarga efectiva: la del body si vino como boolean, si no la actual.
    const effectiveAutoRecharge =
      data.autoRecharge !== undefined ? data.autoRecharge : wallet.autoRecharge;

    // monto efectivo: el del body si vino, si no el actual.
    const effectiveAmount =
      data.autoRechargeAmountCents !== undefined
        ? data.autoRechargeAmountCents
        : wallet.autoRechargeAmountCents;

    // Con auto-recarga activa, el monto debe cubrir el mínimo de $50.
    if (effectiveAutoRecharge && effectiveAmount < MIN_RECHARGE_CENTS) {
      return NextResponse.json(
        { error: "El monto de recarga mínimo es $50" },
        { status: 400 }
      );
    }

    const updated = await prisma.aiWallet.update({
      where: { clinicId: ctx.clinicId },
      data,
    });

    return NextResponse.json({
      balanceCents: updated.balanceCents,
      status: updated.status,
      autoRecharge: updated.autoRecharge,
      autoRechargeThresholdCents: updated.autoRechargeThresholdCents,
      autoRechargeAmountCents: updated.autoRechargeAmountCents,
      hasPaymentMethod: !!updated.stripePaymentMethodId,
    });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}
