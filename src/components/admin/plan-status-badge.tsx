"use client";
/**
 * Insignia de estado de plan para /admin — UNA sola lectura de la regla del
 * negocio (src/lib/plan-status.ts), la misma que usa el gate de /dashboard y
 * de /api. Distingue de un vistazo lo que antes se mezclaba en "Expirado":
 * Al corriente / Cobro fallido / Trial / Vencida (textos en
 * src/lib/plan-status-label.ts, probados sin React).
 *
 * Nunca compara trialEndsAt contra hoy por su cuenta: todo sale de
 * getPlanStatus. La prueba src/lib/__tests__/plan-status-guard.test.ts vigila
 * que las pantallas de /admin sigan usando esta insignia y no una copia.
 */
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { getPlanStatus } from "@/lib/plan-status";
import { planStatusLabel } from "@/lib/plan-status-label";

export type PlanClinicLike = {
  trialEndsAt?: Date | string | null;
  subscriptionStatus?: string | null;
  nextBillingDate?: Date | string | null;
};

export function PlanStatusBadge({
  clinic,
  now,
  withTitle = true,
}: {
  clinic: PlanClinicLike;
  /** Pásalo desde el server component para que SSR e hidratación coincidan. */
  now?: Date;
  withTitle?: boolean;
}) {
  const at = now ?? new Date();
  const { label, detail, tone } = planStatusLabel(getPlanStatus(clinic, at), at);
  return (
    <span title={withTitle ? detail : undefined} style={{ display: "inline-flex" }}>
      <BadgeNew tone={tone} dot>{label}</BadgeNew>
    </span>
  );
}
