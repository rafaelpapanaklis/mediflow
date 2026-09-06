"use client";
// Orthodontics — tabla de mensualidades. SPEC §6.9 + §11.4.

import type { CSSProperties } from "react";
import type { OrthoInstallmentRow } from "@/lib/types/orthodontics";
import { CheckCircle2 } from "lucide-react";

// Rejilla de 7 columnas. La de "Vence" es la elástica y tiene un mínimo para
// que la rejilla nunca baje de su ancho legible: cuando el contenedor es más
// estrecho el scroll horizontal del envoltorio se hace cargo, en vez de que
// las celdas se pisen unas a otras (antes el envoltorio tenía overflow:hidden
// y la columna "Acción" simplemente se recortaba).
// Patrón de referencia: patient-detail.module.css `.tableScrollB` / `.tableB`.
const GRID_COLUMNS = "40px minmax(90px, 1fr) 100px 120px 110px 100px 100px";
const GRID_MIN_WIDTH = 690;

// Texto libre (método de pago, estado): una línea con puntos suspensivos.
// Los IMPORTES nunca se recortan ni se eliden.
const ELLIPSIS: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

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
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div style={{ minWidth: GRID_MIN_WIDTH }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              padding: "10px 12px",
              background: "var(--bg)",
              borderBottom: "1px solid var(--border)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "var(--text-3)",
            }}
          >
            <span style={ELLIPSIS}>#</span>
            <span style={ELLIPSIS}>Vence</span>
            <span style={{ ...ELLIPSIS, textAlign: "right" }}>Monto</span>
            <span style={ELLIPSIS}>Status</span>
            <span style={ELLIPSIS}>Pagado en</span>
            <span style={ELLIPSIS}>Método</span>
            <span style={{ ...ELLIPSIS, textAlign: "right" }}>Acción</span>
          </div>

          {props.installments.map((i) => (
            <div
              key={i.id}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
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
              <span style={ELLIPSIS}>{i.installmentNumber}</span>
              <span style={ELLIPSIS}>
                {new Date(i.dueDate).toLocaleDateString("es-MX")}
              </span>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                }}
              >
                ${Number(i.amount).toLocaleString("es-MX")}
              </span>
              <StatusCell installment={i} />
              <span style={ELLIPSIS}>
                {i.paidAt ? new Date(i.paidAt).toLocaleDateString("es-MX") : "—"}
              </span>
              <span
                style={{ ...ELLIPSIS, fontSize: 11 }}
                title={i.paymentMethod ?? undefined}
              >
                {i.paymentMethod ?? "—"}
              </span>
              <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
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
      </div>
    </div>
  );
}

function StatusCell({ installment }: { installment: OrthoInstallmentRow }) {
  const i = installment;
  if (i.status === "PAID") {
    return (
      <span style={{ ...ELLIPSIS, color: "#22C55E", fontWeight: 600 }}>Pagado</span>
    );
  }
  if (i.status === "WAIVED") {
    return <span style={{ ...ELLIPSIS, color: "var(--text-3)" }}>Perdonado</span>;
  }
  if (i.status === "OVERDUE") {
    const days = Math.max(
      0,
      Math.floor((Date.now() - i.dueDate.getTime()) / 86_400_000),
    );
    return (
      <span style={{ ...ELLIPSIS, color: "#EF4444", fontWeight: 600 }}>
        {days} d vencido
      </span>
    );
  }
  return <span style={{ ...ELLIPSIS, color: "var(--text-2)" }}>Pendiente</span>;
}
