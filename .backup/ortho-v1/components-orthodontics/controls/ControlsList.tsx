"use client";
// Orthodontics — lista de controles mensuales. SPEC §6.8.

import { Calendar, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import type { OrthodonticControlAppointmentRow } from "@/lib/types/orthodontics";
import { PaymentStatusBadge } from "../payments/PaymentStatusBadge";

export function ControlsList(props: {
  controls: OrthodonticControlAppointmentRow[];
  onCreate?: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
          Controles ({props.controls.length})
        </h3>
        {props.onCreate ? (
          <button
            type="button"
            onClick={props.onCreate}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid var(--brand, #6366f1)",
              background: "var(--brand, #6366f1)",
              color: "white",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            <Calendar size={12} aria-hidden /> Nuevo control
          </button>
        ) : null}
      </header>

      {props.controls.length === 0 ? (
        <div
          style={{
            padding: 28,
            textAlign: "center",
            color: "var(--text-3)",
            background: "var(--bg-elev)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          Sin controles registrados.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {props.controls.map((c) => (
            <li
              key={c.id}
              style={{
                padding: 10,
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <AttendanceIcon attendance={c.attendance} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--text-1)" }}>
                    Mes {c.monthInTreatment} · {new Date(c.scheduledAt).toLocaleDateString("es-MX")}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {c.adjustments.length > 0
                      ? c.adjustments.join(", ")
                      : c.attendance === "ATTENDED"
                        ? "Sin ajustes"
                        : "—"}
                  </div>
                </div>
                {c.paymentStatusSnapshot ? (
                  <PaymentStatusBadge status={c.paymentStatusSnapshot} />
                ) : null}
              </div>
              {c.adjustmentNotes ? (
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-2)" }}>
                  {c.adjustmentNotes}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttendanceIcon({
  attendance,
}: {
  attendance: OrthodonticControlAppointmentRow["attendance"];
}) {
  if (attendance === "ATTENDED") {
    return <CheckCircle2 size={16} aria-hidden style={{ color: "#22C55E" }} />;
  }
  if (attendance === "RESCHEDULED") {
    return <AlertCircle size={16} aria-hidden style={{ color: "#F59E0B" }} />;
  }
  return <XCircle size={16} aria-hidden style={{ color: "#EF4444" }} />;
}
