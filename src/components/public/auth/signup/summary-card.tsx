import type { Billing, PlanId } from "./plan-card";

interface SummaryCardProps {
  plan: PlanId;
  billing: Billing;
  planPrice: number;
}

const PLAN_LABELS: Record<PlanId, string> = {
  BASIC: "BASIC",
  PRO: "PRO",
  CLINIC: "CLINIC",
};

function formatFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function SummaryCard({ plan, billing, planPrice }: SummaryCardProps) {
  const firstCharge = formatFutureDate(14);
  const cancelBy = formatFutureDate(13);

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 16,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.005))",
        border: "1px solid rgba(124,58,237,0.2)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "sticky",
        top: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingBottom: 10,
          borderBottom: "1px solid var(--ld-border)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            fontSize: 14.5,
            letterSpacing: "-0.01em",
            color: "var(--ld-fg)",
          }}
        >
          Resumen de tu suscripción
        </div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily:
              "var(--font-jetbrains-mono, ui-monospace, monospace)",
            color: "var(--ld-brand-light)",
          }}
        >
          Resumen
        </div>
      </div>

      <Row
        label="Plan"
        value={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono, ui-monospace, monospace)",
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.08em",
                color: "#a78bfa",
                padding: "2px 8px",
                borderRadius: 100,
                background: "rgba(124,58,237,0.12)",
                border: "1px solid rgba(124,58,237,0.3)",
              }}
            >
              {PLAN_LABELS[plan]}
            </span>
            <span style={{ color: "var(--ld-fg)" }}>
              ${planPrice} USD/mes
            </span>
          </div>
        }
      />
      <Row
        label="Facturación"
        value={billing === "annual" ? "Anual · ahorras 20%" : "Mensual"}
      />
      <Row label="Prueba gratis" value="14 días" highlight />
      <Row label="Primer cobro" value={firstCharge} mono />

      <div style={{ height: 1, background: "var(--ld-border)", margin: "2px 0" }} />

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ld-fg)" }}>
          Total hoy
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              textDecoration: "line-through",
              color: "var(--ld-fg-muted)",
              fontSize: 12.5,
              fontFamily:
                "var(--font-jetbrains-mono, ui-monospace, monospace)",
            }}
          >
            ${planPrice}
          </span>
          <span
            style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: "-0.03em",
              background: "linear-gradient(90deg, #c4b5fd, #34d399)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            $0 USD
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          background: "rgba(52,211,153,0.06)",
          border: "1px solid rgba(52,211,153,0.2)",
          fontSize: 11.5,
          color: "rgba(245,245,247,0.75)",
          lineHeight: 1.45,
        }}
      >
        <span style={{ color: "#34d399", fontWeight: 500 }}>
          Puedes cancelar
        </span>{" "}
        antes del {cancelBy} sin cargo alguno.
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ld-fg-muted)" }}>{label}</div>
      <div
        style={{
          fontSize: 12.5,
          color: highlight ? "#34d399" : "var(--ld-fg)",
          fontFamily: mono
            ? "var(--font-jetbrains-mono, ui-monospace, monospace)"
            : "inherit",
          fontWeight: highlight ? 500 : 400,
          textAlign: "right",
        }}
      >
        {value}
      </div>
    </div>
  );
}
