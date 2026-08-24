export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { getBarberPlans } from "@/lib/barber/plans";
import {
  barberFeatureLabel,
  formatBarberPrice,
  isBarberUnlimited,
  isBarbershopSubscriptionActive,
} from "@/lib/barber/plan-shared";
import { getBarberT } from "@/i18n/dictionaries/barber";

/**
 * Suscripción DaleControl Barber. Aquí aterriza el router (/barber) cuando la
 * barbería está impaga. TODOS los precios salen de barber_plan_configs vía
 * getBarberPlans() — cero números hardcodeados. El checkout de Stripe lo
 * cablea su propia ola; esta pantalla es informativa.
 */
export default async function BarberSuscripcionPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const t = getBarberT(ctx.barbershop.locale);
  const plans = await getBarberPlans();
  const active = isBarbershopSubscriptionActive(ctx.barbershop);
  const currentPlan = ctx.barbershop.plan;

  function barbersLine(maxBarbers: number): string {
    if (isBarberUnlimited(maxBarbers)) return t("barber.shell.suscripcion.unlimitedBarbers");
    if (maxBarbers === 1) return t("barber.shell.suscripcion.oneBarber");
    return t("barber.shell.suscripcion.nBarbers", { count: maxBarbers });
  }

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)", margin: 0 }}>
          {t("barber.shell.suscripcion.title")}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, color: "var(--text-2)" }}>
            {t("barber.shell.suscripcion.currentPlan")}:
          </span>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 700,
              color: "#fff",
              background: "var(--caramel-600, #A2612F)",
            }}
          >
            {plans.find((p) => p.id === currentPlan)?.name ?? currentPlan}
          </span>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              color: active ? "var(--success)" : "var(--warning)",
              background: active ? "var(--success-soft)" : "var(--warning-soft)",
            }}
          >
            {active
              ? t("barber.shell.suscripcion.statusActive")
              : t("barber.shell.suscripcion.statusPending")}
          </span>
        </div>
      </header>

      {!active && (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: 12,
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "var(--text-1)",
            background: "var(--brand-softer)",
            border: "1px solid var(--border-brand)",
          }}
        >
          {t("barber.shell.suscripcion.payingSoon")}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const bullets = [
            barbersLine(plan.maxBarbers),
            ...Object.entries(plan.features)
              .filter(([, on]) => on)
              .slice(0, 6)
              .map(([key]) => barberFeatureLabel(key)),
          ];
          return (
            <div
              key={plan.id}
              className="shadow-card"
              style={{
                background: "var(--bg-elev)",
                border: isCurrent
                  ? "2px solid var(--caramel-500, #BE7A3C)"
                  : "1px solid var(--border-soft)",
                borderRadius: 16,
                padding: 22,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
                  {plan.name}
                </h2>
                {isCurrent && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "var(--brand)",
                    }}
                  >
                    {t("barber.shell.suscripcion.currentPlan")}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-1)" }}>
                  {formatBarberPrice(plan.priceMonthly)}
                </span>
                <span style={{ fontSize: 13, color: "var(--text-3)" }}>
                  {t("barber.shell.suscripcion.perMonth")}
                </span>
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
                {t("barber.shell.suscripcion.includes")}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
                {bullets.map((b) => (
                  <li key={b} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13.5, color: "var(--text-2)" }}>
                    <span aria-hidden="true" style={{ color: "var(--caramel-500, #BE7A3C)", fontWeight: 700 }}>✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
