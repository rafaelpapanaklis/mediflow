"use client";
// Orthodontics — vista del plan de pagos con KPIs + tabla. SPEC §6.9.

import { ExternalLink, RefreshCw } from "lucide-react";
import type { OrthoPaymentPlanRow, OrthoInstallmentRow } from "@/lib/types/orthodontics";
import { PaymentStatusBadge } from "./PaymentStatusBadge";
import { InstallmentList } from "./InstallmentList";

export interface PaymentPlanViewProps {
  plan: OrthoPaymentPlanRow;
  installments: OrthoInstallmentRow[];
  onRecordPayment?: (installmentId: string) => void;
  onRecalculate?: () => void;
  isRecalculating?: boolean;
  agreementPdfHref?: string;
}

export function PaymentPlanView(props: PaymentPlanViewProps) {
  const p = props.plan;
  const total = Number(p.totalAmount);
  const paid = Number(p.paidAmount);
  const pending = Number(p.pendingAmount);
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section
        style={{
          padding: 14,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <Kpi label="Total" value={`$${total.toLocaleString("es-MX")}`} />
          <Kpi label="Pagado" value={`$${paid.toLocaleString("es-MX")}`} tone="success" />
          <Kpi
            label="Pendiente"
            value={`$${pending.toLocaleString("es-MX")}`}
            tone={pending > 0 ? "warning" : "neutral"}
          />
          <div>
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                color: "var(--text-3)",
                letterSpacing: 0.4,
              }}
            >
              Estado
            </span>
            <div style={{ marginTop: 4 }}>
              <PaymentStatusBadge status={p.status} />
            </div>
          </div>
        </div>

        <div
          style={{
            height: 6,
            background: "var(--bg)",
            borderRadius: 3,
            overflow: "hidden",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--brand, #6366f1)",
              transition: "width 200ms ease",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {pct}% pagado · {p.installmentCount} mensualidades · día {p.paymentDayOfMonth}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {props.onRecalculate ? (
              <button
                type="button"
                onClick={props.onRecalculate}
                disabled={props.isRecalculating}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-1)",
                  fontSize: 11,
                  cursor: props.isRecalculating ? "wait" : "pointer",
                }}
              >
                <RefreshCw size={12} aria-hidden />
                {props.isRecalculating ? "Recalculando..." : "Recalcular"}
              </button>
            ) : null}
            {props.agreementPdfHref ? (
              <a
                href={props.agreementPdfHref}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--brand, #6366f1)",
                  background: "transparent",
                  color: "var(--brand, #6366f1)",
                  fontSize: 11,
                  textDecoration: "none",
                }}
              >
                <ExternalLink size={12} aria-hidden /> Acuerdo PDF
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <InstallmentList
        installments={props.installments}
        onRecordPayment={props.onRecordPayment}
      />
    </div>
  );
}

function Kpi(props: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "neutral";
}) {
  const color =
    props.tone === "success"
      ? "#22C55E"
      : props.tone === "warning"
        ? "#F59E0B"
        : "var(--text-1)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-3)", letterSpacing: 0.4 }}>
        {props.label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "monospace" }}>
        {props.value}
      </span>
    </div>
  );
}
