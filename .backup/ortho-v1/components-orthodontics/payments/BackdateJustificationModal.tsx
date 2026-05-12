"use client";
// Orthodontics — modal con textarea + contador en vivo (rojo <20, verde ≥20). SPEC §6.9.

import { useState } from "react";

export interface BackdateJustificationModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (justification: string) => void;
  pending?: boolean;
}

export function BackdateJustificationModal(props: BackdateJustificationModalProps) {
  const [text, setText] = useState("");
  if (!props.open) return null;
  const ok = text.trim().length >= 20;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
          Justificar fecha fuera de rango
        </h2>
        <p
          style={{
            margin: 0,
            padding: "10px 12px",
            background: "rgba(245,158,11,0.10)",
            border: "1px solid rgba(245,158,11,0.40)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--text-1)",
          }}
        >
          Estás registrando un pago con fecha fuera del rango permitido (±60
          días). Esta acción queda en audit log con tu cédula y el motivo.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Ejemplo: Pago en efectivo registrado en cuaderno físico, traspaso retrasado al sistema."
          style={{
            padding: "8px 10px",
            background: "var(--bg-elev)",
            color: "var(--text-1)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 12,
            resize: "vertical",
          }}
        />
        <div style={{ fontSize: 11, color: ok ? "#22C55E" : "#EF4444" }}>
          {text.trim().length} / 20 caracteres mínimo
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.pending}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => ok && props.onConfirm(text.trim())}
            disabled={!ok || props.pending}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--brand, #6366f1)",
              background: ok ? "var(--brand, #6366f1)" : "var(--bg-elev)",
              color: ok ? "white" : "var(--text-3)",
              fontSize: 12,
              fontWeight: 600,
              cursor: ok && !props.pending ? "pointer" : "not-allowed",
            }}
          >
            {props.pending ? "Guardando..." : "Confirmar registro"}
          </button>
        </div>
      </div>
    </div>
  );
}
