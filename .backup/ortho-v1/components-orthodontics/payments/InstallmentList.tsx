"use client";
// Orthodontics — tabla de mensualidades. SPEC §6.9 + §11.4.

import type { OrthoInstallmentRow } from "@/lib/types/orthodontics";
import { CheckCircle2 } from "lucide-react";

export function InstallmentList(props: {
  installments: OrthoInstallmentRow[];
  onRecordPayment?: (id: string) => void;
}) {
  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "40px 1fr 100px 120px 110px 100px 100px",
          padding: "10px 12px",
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: "var(--text-3)",
        }}
      >
        <span>#</span>
        <span>Vence</span>
        <span style={{ textAlign: "right" }}>Monto</span>
        <span>Status</span>
        <span>Pagado en</span>
        <span>Método</span>
        <span style={{ textAlign: "right" }}>Acción</span>
      </div>

      {props.installments.map((i) => (
        <div
          key={i.id}
          style={{
            display: "grid",
            gridTemplateColumns: "40px 1fr 100px 120px 110px 100px 100px",
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-1)",
            background:
              i.status === "OVERDUE"
                ? "rgba(239,68,68,0.05)"
                : i.status === "PAID"
                  ? "rgba(22,163,74,0.04)"
                  : i.status === "WAIVED"
                    ? "rgba(0,0,0,0.10)"
                    : "transparent",
            opacity: i.status === "WAIVED" ? 0.6 : 1,
          }}
        >
          <span>{i.installmentNumber}</span>
          <span>{new Date(i.dueDate).toLocaleDateString("es-MX")}</span>
          <span style={{ textAlign: "right", fontFamily: "monospace" }}>
            ${Number(i.amount).toLocaleString("es-MX")}
          </span>
          <StatusCell installment={i} />
          <span>
            {i.paidAt ? new Date(i.paidAt).toLocaleDateString("es-MX") : "—"}
          </span>
          <span style={{ fontSize: 11 }}>
            {i.paymentMethod ?? "—"}
          </span>
          <span style={{ textAlign: "right" }}>
            {i.status === "PENDING" || i.status === "OVERDUE" ? (
              props.onRecordPayment ? (
                <button
                  type="button"
                  onClick={() => props.onRecordPayment!(i.id)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    border: "1px solid var(--brand, #6366f1)",
                    background: "transparent",
                    color: "var(--brand, #6366f1)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Pagar
                </button>
              ) : null
            ) : i.status === "PAID" ? (
              <CheckCircle2 size={14} aria-hidden style={{ color: "#22C55E" }} />
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusCell({ installment }: { installment: OrthoInstallmentRow }) {
  const i = installment;
  if (i.status === "PAID") {
    return <span style={{ color: "#22C55E", fontWeight: 600 }}>Pagado</span>;
  }
  if (i.status === "WAIVED") {
    return <span style={{ color: "var(--text-3)" }}>Perdonado</span>;
  }
  if (i.status === "OVERDUE") {
    const days = Math.max(
      0,
      Math.floor((Date.now() - i.dueDate.getTime()) / 86_400_000),
    );
    return <span style={{ color: "#EF4444", fontWeight: 600 }}>{days} d vencido</span>;
  }
  return <span style={{ color: "var(--text-2)" }}>Pendiente</span>;
}
