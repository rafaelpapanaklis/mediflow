"use client";
// Orthodontics — tarjeta resumen del plan de pagos del paciente actual.
// Pensada para ir como header sticky en OrthodonticsTab, junto al badge
// de fase + mes en tratamiento. CTA "ver plan" abre el sub-tab "pagos".

import { ArrowRight, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import type {
  OrthoPaymentPlanRow,
  OrthoInstallmentRow,
} from "@/lib/types/orthodontics";

export interface OrthoPaymentPlanCardProps {
  paymentPlan: OrthoPaymentPlanRow | null;
  installments: OrthoInstallmentRow[];
  onViewPlan?: () => void;
}

export function OrthoPaymentPlanCard(props: OrthoPaymentPlanCardProps) {
  if (!props.paymentPlan) {
    return (
      <div
        style={{
          padding: "10px 14px",
          background: "var(--surface-2, #f5f5f7)",
          border: "1px dashed var(--border, #e5e5ed)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--text-2, #6b6b78)",
        }}
      >
        Sin plan de pagos configurado.
      </div>
    );
  }

  const plan = props.paymentPlan;
  const totalAmount = Number(plan.totalAmount);
  const paidAmount = Number(plan.paidAmount);
  const pendingAmount = Number(plan.pendingAmount);
  const progressPct = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0;

  const paidCount = props.installments.filter((i) => i.status === "PAID").length;
  const total = props.installments.length;
  const overdueCount = props.installments.filter((i) => i.status === "OVERDUE").length;

  const tone = toneForStatus(plan.status);
  const StatusIcon =
    tone === "success" ? CheckCircle2 : tone === "warning" ? Clock : AlertTriangle;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: "10px 14px",
        background: bgForTone(tone),
        border: `1px solid ${borderForTone(tone)}`,
        borderRadius: 8,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
      }}
      role="region"
      aria-label="Plan de pagos"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 140 }}>
        <StatusIcon size={16} aria-hidden style={{ color: colorForTone(tone) }} />
        <strong style={{ fontSize: 13, color: colorForTone(tone) }}>
          {labelForStatus(plan.status)}
        </strong>
      </div>

      <Stat label="Pagado" value={`$${paidAmount.toLocaleString("es-MX")}`} />
      <Stat label="Pendiente" value={`$${pendingAmount.toLocaleString("es-MX")}`} />
      <Stat
        label="Mensualidades"
        value={`${paidCount} / ${total}`}
        sub={overdueCount > 0 ? `${overdueCount} con atraso` : undefined}
        subTone={overdueCount > 0 ? "danger" : undefined}
      />

      <div
        style={{
          flex: 1,
          minWidth: 100,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <small style={{ fontSize: 11, color: "var(--text-2, #6b6b78)" }}>
          Avance: {progressPct}%
        </small>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "var(--surface-2, #f5f5f7)",
            overflow: "hidden",
          }}
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              background: colorForTone(tone),
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>

      {props.onViewPlan ? (
        <button
          type="button"
          onClick={props.onViewPlan}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            fontSize: 12,
            background: "transparent",
            color: colorForTone(tone),
            border: `1px solid ${borderForTone(tone)}`,
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Ver plan <ArrowRight size={12} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function Stat(props: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "danger";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <small
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          color: "var(--text-3, #9b9aa8)",
          letterSpacing: 0.4,
        }}
      >
        {props.label}
      </small>
      <strong style={{ fontSize: 14, color: "var(--text-1, #14101f)" }}>
        {props.value}
      </strong>
      {props.sub ? (
        <small
          style={{
            fontSize: 10,
            color: props.subTone === "danger" ? "var(--danger, #ef4444)" : "var(--text-2)",
          }}
        >
          {props.sub}
        </small>
      ) : null}
    </div>
  );
}

type Tone = "success" | "warning" | "danger" | "neutral";

function toneForStatus(s: string): Tone {
  switch (s) {
    case "ON_TIME":
      return "success";
    case "PAID_IN_FULL":
      return "success";
    case "LIGHT_DELAY":
      return "warning";
    case "SEVERE_DELAY":
      return "danger";
    default:
      return "neutral";
  }
}

function labelForStatus(s: string): string {
  switch (s) {
    case "ON_TIME":
      return "Al corriente";
    case "LIGHT_DELAY":
      return "Atraso leve";
    case "SEVERE_DELAY":
      return "Atraso severo";
    case "PAID_IN_FULL":
      return "Pagado en su totalidad";
    default:
      return s;
  }
}

function colorForTone(t: Tone): string {
  if (t === "success") return "var(--success, #10b981)";
  if (t === "warning") return "var(--warning, #d97706)";
  if (t === "danger") return "var(--danger, #ef4444)";
  return "var(--text-1)";
}

function bgForTone(t: Tone): string {
  if (t === "success") return "var(--success-soft, rgba(16,185,129,0.08))";
  if (t === "warning") return "var(--warning-soft, rgba(245,158,11,0.10))";
  if (t === "danger") return "var(--danger-soft, rgba(239,68,68,0.10))";
  return "var(--surface-1)";
}

function borderForTone(t: Tone): string {
  if (t === "success") return "rgba(16,185,129,0.40)";
  if (t === "warning") return "rgba(245,158,11,0.40)";
  if (t === "danger") return "rgba(239,68,68,0.40)";
  return "var(--border)";
}
