"use client";

import { Pen } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  presets: string[];
  error?: boolean;
}

/**
 * Campo Motivo del rediseño: input con icono + chips de motivos rápidos.
 * `onChange` se dispara tanto al escribir como al pulsar un chip; el padre
 * conserva la lógica de limpiar el error de validación.
 */
export function MotivoField({ value, onChange, presets, error }: Props) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 12px",
          border: `1px solid ${error ? "var(--danger)" : "var(--border-soft)"}`,
          borderRadius: 10,
          background: "var(--bg-elev)",
          transition: "all 0.12s",
        }}
      >
        <Pen size={14} aria-hidden style={{ color: "var(--text-3)", flexShrink: 0 }} />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Consulta general, control, urgencia..."
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            padding: "10px 0",
            fontSize: 13,
            color: "var(--text-1)",
            fontFamily: "inherit",
          }}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {presets.map((preset) => {
          const active = value === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              style={{
                padding: "4px 10px",
                background: active ? "var(--brand-soft)" : "transparent",
                color: active ? "var(--trial-accent-calm)" : "var(--text-2)",
                border: "1px solid",
                borderColor: active ? "var(--border-brand)" : "var(--border-soft)",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.12s",
              }}
            >
              {preset}
            </button>
          );
        })}
      </div>
    </div>
  );
}
