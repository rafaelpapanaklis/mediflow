import type { CSSProperties } from "react";

/**
 * Botones del alta (/signup), compartidos por los tres pasos para que el
 * recorrido se vea de una pieza con la portada: azul #2563eb como acción
 * principal, fantasma para «Atrás». Sólo estilo; el estado (disabled,
 * loading) lo sigue decidiendo cada paso.
 */
export function botonPrimario(disabled: boolean, extra?: CSSProperties): CSSProperties {
  return {
    height: 48,
    padding: "0 20px",
    borderRadius: 12,
    border: "none",
    fontFamily: "inherit",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "-0.005em",
    color: disabled ? "#64748b" : "#ffffff",
    background: disabled ? "#e2e8f0" : "linear-gradient(180deg, #2f6df0 0%, #2563eb 55%, #1d4ed8 100%)",
    boxShadow: disabled
      ? "none"
      : "inset 0 1px 0 rgba(255,255,255,0.22), 0 12px 26px -14px rgba(37,99,235,0.75)",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "background .16s, transform .18s, box-shadow .18s",
    ...extra,
  };
}

export function botonFantasma(disabled = false, extra?: CSSProperties): CSSProperties {
  return {
    height: 48,
    padding: "0 18px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    fontFamily: "inherit",
    fontSize: 14.5,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    transition: "background .16s, color .16s",
    ...extra,
  };
}
