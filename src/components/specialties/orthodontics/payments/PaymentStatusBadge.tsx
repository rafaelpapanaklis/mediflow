"use client";
// Orthodontics — badge de OrthoPaymentStatus. SPEC §11.3.

import type { OrthoPaymentStatus } from "@prisma/client";

const PAYMENT_LABEL: Record<OrthoPaymentStatus, string> = {
  ON_TIME: "Al corriente",
  LIGHT_DELAY: "Atraso leve",
  SEVERE_DELAY: "Atraso severo",
  PAID_IN_FULL: "Pagado",
};

const PAYMENT_COLOR: Record<OrthoPaymentStatus, { bg: string; text: string }> = {
  ON_TIME: { bg: "transparent", text: "var(--text-2, #94a3b8)" },
  LIGHT_DELAY: { bg: "rgba(245,158,11,0.16)", text: "#F59E0B" },
  SEVERE_DELAY: { bg: "rgba(239,68,68,0.16)", text: "#EF4444" },
  PAID_IN_FULL: { bg: "rgba(22,163,74,0.16)", text: "#16A34A" },
};

export interface PaymentStatusBadgeProps {
  status: OrthoPaymentStatus;
  amountOverdueMxn?: number;
  daysOverdue?: number;
}

export function PaymentStatusBadge({
  status,
  amountOverdueMxn,
  daysOverdue,
}: PaymentStatusBadgeProps) {
  const color = PAYMENT_COLOR[status];
  let label: string = PAYMENT_LABEL[status];
  if (status === "LIGHT_DELAY" && amountOverdueMxn) {
    label = `-$${amountOverdueMxn.toLocaleString("es-MX")}`;
  } else if (status === "SEVERE_DELAY" && amountOverdueMxn) {
    label = `-$${amountOverdueMxn.toLocaleString("es-MX")} · ${daysOverdue ?? 0} d`;
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        background: color.bg,
        color: color.text,
      }}
    >
      {label}
    </span>
  );
}
