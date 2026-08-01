export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { getResolvedPlans } from "@/lib/plans";
import { fixedAmountFor, getPayoutConfig, normalizePayoutMode } from "@/lib/affiliates/payout";
import { PayoutForm } from "@/components/afiliados/payout-form";
import {
  PayoutModeForm,
  type PayoutModeAmount,
} from "@/components/afiliados/payout-mode-form";

export default async function AffiliateSettingsPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  // Preferencias de notificación — tolerante a que la tabla aún no exista
  // en Supabase (defaults true).
  const prefsPromise = prisma.affiliatePrefs
    .findUnique({
      where: { affiliateId: ctx.affiliateId },
      select: { notifySignup: true, notifyConversion: true, notifyPayout: true },
    })
    .catch(() => null);

  // 3 promesas (límite del repo: 6). cfg = null si sql/afiliados-comisiones.sql
  // aún no corre → el motor está inactivo y la modalidad va en solo lectura.
  const [prefs, cfg, plans] = await Promise.all([
    prefsPromise,
    getPayoutConfig(),
    getResolvedPlans(),
  ]);

  // Los montos SIEMPRE se cruzan: precio real del plan (plan_configs vía
  // getResolvedPlans) + monto configurado del motor (fixedAmountFor). Ni un
  // solo número escrito a mano aquí.
  const amounts: PayoutModeAmount[] = plans.map((p) => ({
    plan: p.id,
    label: p.label,
    priceMxn: p.priceMxn,
    recurringMxn: cfg ? fixedAmountFor(p.id, "recurring", cfg) : 0,
    oneTimeMxn: cfg ? fixedAmountFor(p.id, "onetime", cfg) : 0,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
      <div>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Pagos y comisiones
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Elige cómo se calculan tus comisiones y dinos a dónde te las depositamos.
        </p>
      </div>

      <PayoutModeForm
        initialMode={normalizePayoutMode(ctx.affiliate.payoutMode)}
        allowChoice={cfg?.allowAffiliateChoice ?? false}
        engineEnabled={cfg != null}
        amounts={amounts}
      />

      <PayoutForm
        initialMethod={ctx.affiliate.payoutMethod ?? ""}
        initialDetails={ctx.affiliate.payoutDetails ?? ""}
        initialPrefs={{
          notifySignup: prefs?.notifySignup ?? true,
          notifyConversion: prefs?.notifyConversion ?? true,
          notifyPayout: prefs?.notifyPayout ?? true,
        }}
      />
    </div>
  );
}
