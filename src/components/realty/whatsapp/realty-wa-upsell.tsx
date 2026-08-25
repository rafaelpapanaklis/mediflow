import { Check, MessageCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { formatRealtyPrice, type RealtyResolvedPlan } from "@/lib/realty/plan-shared";

/**
 * Lo que ve una cuenta cuyo plan NO incluye WhatsApp (hoy, PROPIETARIO).
 *
 * La sección SE VE y explica qué hay del otro lado — no se esconde ni se
 * finge que no existe. Sin dark patterns: no hay cuenta atrás falsa, no hay
 * "solo hoy", no hay botón que parezca que ya lo tienes. Se dice qué planes
 * lo traen y cuánto cuestan, y ya.
 *
 * 🔴 LOS PRECIOS SALEN DE LA TABLA (realty_plan_configs vía getRealtyPlans).
 * Cero precios escritos aquí: el contrato lo prohíbe y con razón — se editan
 * sin redeploy y un número a mano se queda viejo sin que nadie se entere.
 *
 * i18n: CONVENCIÓN B — el servidor baja el sub-árbol ya recortado y aquí se
 * usa makeRealtyT(dict) SIN prefijo.
 */
export function RealtyWaUpsell({
  dict,
  plans,
  currentPlanName,
}: {
  dict: Dictionary;
  plans: RealtyResolvedPlan[];
  currentPlanName: string;
}) {
  const t = makeRealtyT(dict);

  // Los planes que SÍ traen la feature, ordenados por precio. Si mañana la
  // escalera cambia en la tabla, esta lista cambia sola.
  const withWhatsApp = plans
    .filter((p) => p.features?.whatsapp === true && p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <header style={{ display: "grid", gap: 6 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            width: "fit-content",
            padding: "4px 10px",
            borderRadius: 999,
            background: "var(--brand-soft)",
            color: "var(--brand)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <MessageCircle size={13} />
          {t("upsell.badge")}
        </span>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
          {t("upsell.title")}
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
          {t("upsell.body", { plan: currentPlanName })}
        </p>
      </header>

      <section
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
          {t("upsell.whatYouGet")}
        </h2>
        <ul style={{ display: "grid", gap: 7, listStyle: "none", padding: 0, margin: 0 }}>
          {["lead", "ficha", "visita", "renta", "match", "inbox"].map((key) => (
            <li
              key={key}
              style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}
            >
              <Check size={15} style={{ color: "var(--brand)", flexShrink: 0, marginTop: 2 }} />
              <span>{t(`upsell.features.${key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
          {t("upsell.plansTitle")}
        </h2>
        <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
          {withWhatsApp.map((plan) => (
            <li
              key={plan.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
              }}
            >
              <span style={{ display: "grid", gap: 2 }}>
                <strong style={{ fontSize: 13.5, color: "var(--text-1)" }}>{plan.name}</strong>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                  {t("upsell.included", { n: String(plan.messageQuota) })}
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--brand)" }}>
                {formatRealtyPrice(plan.priceMonthly)}
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-3)" }}>
                  {" "}
                  {t("upsell.perMonth")}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <a
          href="/inmobiliaria/suscripcion"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "fit-content",
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--brand)",
            borderRadius: 10,
            textDecoration: "none",
          }}
        >
          {t("upsell.cta")}
        </a>

        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
          {t("upsell.note")}
        </p>
      </section>
    </div>
  );
}
