"use client";

import { useEffect, useState } from "react";
import { Receipt, Loader2 } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { CfdiRediseno } from "./bloques-rediseno/cfdi";

/**
 * Card "Facturación CFDI" del panel (Configuración → Suscripción).
 *
 * Anillo de progreso usadas/incluidas del mes + aviso de excedente y adeudo.
 * Datos de GET /api/cfdi/usage (admin de la clínica). Si el endpoint falla (p.
 * ej. la migración sql/cfdi-quotas.sql aún no aplicada) la card se oculta en vez
 * de romper la pestaña.
 */

interface CfdiUsage {
  period: string;
  used: number;
  included: number;
  remaining: number;
  overage: number;
  overagePriceCents: number;
  overageProjectionCents: number;
  debtCents: number;
  debtCount: number;
  billingMode: "monthly_sub" | "annual_card" | "manual";
}

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "MXN" });
}

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const RING_R = 34;
const RING_C = 2 * Math.PI * RING_R;

/**
 * `rediseno`: la pestaña Suscripción lo baja SOLO desde su camino nuevo
 * (interruptor `menu-dos-niveles`). Encendido, la tarjeta se pinta con la
 * ropa nueva (`bloques-rediseno/cfdi.tsx`) con los MISMOS datos y textos;
 * sin la prop, o en false, es exactamente la de siempre.
 */
export function CfdiUsageCard({ rediseno = false }: { rediseno?: boolean } = {}) {
  const t = useT();
  const [data, setData] = useState<CfdiUsage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cfdi/usage")
      .then((r) => {
        if (!r.ok) throw new Error("usage");
        return r.json();
      })
      .then((d: CfdiUsage) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  if (rediseno) {
    return <CfdiRediseno m={data ? modeloCfdi(data, t) : null} />;
  }

  return (
    <section
      className="bg-card border border-border rounded-2xl p-6"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Receipt size={14} aria-hidden style={{ color: "var(--brand)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {t("shell.subscriptionTab.cfdiTitle")}
          </h2>
        </div>
        {data && (
          <span style={{ fontSize: 11, color: "var(--text-3)", textTransform: "capitalize" }}>
            {monthLabel(data.period)}
          </span>
        )}
      </div>

      {!data ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
          <Loader2 size={16} className="animate-spin" aria-hidden style={{ margin: "0 auto 6px", display: "block" }} />
          {t("shell.subscriptionTab.cfdiLoading")}
        </div>
      ) : (
        <CfdiBody data={data} t={t} />
      )}
    </section>
  );
}

/**
 * El modelo para la ropa nueva: el MISMO cálculo y las MISMAS claves que
 * `CfdiBody` (anillo, pastilla de restantes/excedente, nota de cobro y
 * adeudo), resueltos a texto para que la vista no decida nada.
 */
function modeloCfdi(data: CfdiUsage, t: ReturnType<typeof useT>) {
  const ratio = data.included > 0 ? data.used / data.included : data.used > 0 ? 1 : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const exceeded = data.overage > 0;
  const nearLimit = !exceeded && data.included > 0 && ratio >= 0.8;
  const collectKey =
    data.billingMode === "monthly_sub"
      ? "cfdiCollectMonthly"
      : data.billingMode === "annual_card"
        ? "cfdiCollectAnnual"
        : "cfdiCollectManual";
  return {
    mes: monthLabel(data.period),
    usadas: data.used,
    incluidas: data.included,
    porcentaje: pct,
    nivel: exceeded ? ("critico" as const) : nearLimit ? ("alto" as const) : undefined,
    estado: exceeded
      ? data.overage === 1
        ? t("shell.subscriptionTab.cfdiOverOne", { price: money(data.overagePriceCents), total: money(data.overageProjectionCents) })
        : t("shell.subscriptionTab.cfdiOverLine", { overage: data.overage, price: money(data.overagePriceCents), total: money(data.overageProjectionCents) })
      : data.remaining === 1
        ? t("shell.subscriptionTab.cfdiRemainingOne")
        : t("shell.subscriptionTab.cfdiRemaining", { n: data.remaining }),
    notaCobro: exceeded ? t(`shell.subscriptionTab.${collectKey}`) : null,
    deuda: data.debtCents > 0 ? t("shell.subscriptionTab.cfdiDebt", { amount: money(data.debtCents) }) : null,
    etiquetaAnillo: t("shell.subscriptionTab.cfdiUsedOf", { used: data.used, included: data.included }),
  };
}

function CfdiBody({ data, t }: { data: CfdiUsage; t: ReturnType<typeof useT> }) {
  const ratio = data.included > 0 ? data.used / data.included : data.used > 0 ? 1 : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const exceeded = data.overage > 0;
  const nearLimit = !exceeded && data.included > 0 && ratio >= 0.8;

  const ringColor = exceeded ? "var(--danger)" : nearLimit ? "var(--warning)" : "var(--brand)";
  const numColor = exceeded ? "var(--danger)" : "var(--text-1)";
  const offset = RING_C * (1 - pct / 100);

  const collectKey =
    data.billingMode === "monthly_sub"
      ? "cfdiCollectMonthly"
      : data.billingMode === "annual_card"
        ? "cfdiCollectAnnual"
        : "cfdiCollectManual";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      {/* Anillo de progreso usadas/incluidas */}
      <div style={{ flexShrink: 0 }}>
        <svg
          width={92}
          height={92}
          viewBox="0 0 92 92"
          role="img"
          aria-label={t("shell.subscriptionTab.cfdiUsedOf", { used: data.used, included: data.included })}
        >
          <circle cx={46} cy={46} r={RING_R} fill="none" stroke="var(--bg-elev-2)" strokeWidth={8} />
          <circle
            cx={46}
            cy={46}
            r={RING_R}
            fill="none"
            stroke={ringColor}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={offset}
            transform="rotate(-90 46 46)"
            style={{ transition: "stroke-dashoffset .5s ease, stroke .3s ease" }}
          />
          <text x={46} y={43} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 22, fontWeight: 800, fill: numColor }}>
            {data.used}
          </text>
          <text x={46} y={60} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 11, fill: "var(--text-3)" }}>
            / {data.included}
          </text>
        </svg>
      </div>

      {/* Detalle */}
      <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0 }}>
          {t("shell.subscriptionTab.cfdiSubtitle")}
        </p>

        {exceeded ? (
          <>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                alignSelf: "flex-start",
                padding: "6px 10px",
                borderRadius: 10,
                background: "var(--danger-soft)",
                border: "1px solid var(--danger-soft)",
                color: "var(--danger-strong, var(--danger))",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {data.overage === 1
                ? t("shell.subscriptionTab.cfdiOverOne", {
                    price: money(data.overagePriceCents),
                    total: money(data.overageProjectionCents),
                  })
                : t("shell.subscriptionTab.cfdiOverLine", {
                    overage: data.overage,
                    price: money(data.overagePriceCents),
                    total: money(data.overageProjectionCents),
                  })}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: 0 }}>
              {t(`shell.subscriptionTab.${collectKey}`)}
            </p>
          </>
        ) : (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              alignSelf: "flex-start",
              padding: "6px 10px",
              borderRadius: 10,
              background: nearLimit ? "var(--warning-soft)" : "var(--brand-soft)",
              border: `1px solid ${nearLimit ? "var(--warning-soft)" : "var(--brand-soft)"}`,
              color: nearLimit ? "var(--warning-strong, var(--warning))" : "var(--brand)",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {data.remaining === 1
              ? t("shell.subscriptionTab.cfdiRemainingOne")
              : t("shell.subscriptionTab.cfdiRemaining", { n: data.remaining })}
          </div>
        )}

        {data.debtCents > 0 && (
          <p style={{ fontSize: 12, color: "var(--danger-strong, var(--danger))", margin: 0, fontWeight: 600 }}>
            {t("shell.subscriptionTab.cfdiDebt", { amount: money(data.debtCents) })}
          </p>
        )}
      </div>
    </div>
  );
}
