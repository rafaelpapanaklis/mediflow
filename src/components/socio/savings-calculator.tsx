"use client";

// Mini calculadora de ahorro para la landing /socio/[slug] (estética de la
// landing de ventas .mfh-*, NO la del panel). Horas administrativas/semana ×
// costo por hora → estimado mensual en pesos. Cifras SOBRIAS: hablamos de
// "hasta ~60%" del tiempo administrativo recuperable, sin promesas absolutas.
import { useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";

const HOURS_DEFAULT = 10; // hrs admin/semana típicas de una clínica chica
const RATE_DEFAULT = 90; // $/hora aproximado de personal administrativo MX
const RECOVERY = 0.6; // fracción del tiempo admin que se puede recuperar
const WEEKS_PER_MONTH = 4.33;

const mxn = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/* sales.css no trae clase para <input type="range">: inline discreto con el
   accent violeta de la marca. Lo demás reusa tokens/clases .mfh-* existentes. */
const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const labelStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--ink, #0f172a)",
};
const valueStyle: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontWeight: 700,
  color: "var(--b2, #6d28d9)",
  whiteSpace: "nowrap",
};
const rangeStyle: CSSProperties = {
  width: "100%",
  height: 30, // área táctil cómoda en móvil
  margin: 0,
  accentColor: "var(--b, #7c3aed)",
  cursor: "pointer",
};
const boundsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 11,
  color: "var(--faint, #94a3b8)",
};

export function SavingsCalculator({ signupHref }: { signupHref: string }) {
  const [hours, setHours] = useState(HOURS_DEFAULT);
  const [rate, setRate] = useState(RATE_DEFAULT);

  // Redondeado a centenas: es un estimado, no una cifra contable.
  const monthly = Math.round((hours * WEEKS_PER_MONTH * rate * RECOVERY) / 100) * 100;
  const yearly = monthly * 12;

  return (
    <div
      className="mfh-card"
      style={{
        display: "grid",
        // 2 columnas en desktop; colapsa a 1 en móvil sin media queries y el
        // min(100%, …) evita overflow horizontal en pantallas muy angostas.
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
        gap: "clamp(26px, 4vw, 44px)",
        alignItems: "center",
        padding: "clamp(22px, 4vw, 40px)",
        boxShadow: "var(--sh, 0 6px 24px -10px rgba(15,23,42,.14))",
      }}
    >
      {/* Controles */}
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={fieldStyle}>
          <label htmlFor="mfh-calc-hours" style={labelStyle}>
            <span>Horas administrativas por semana</span>
            <span style={valueStyle}>{hours} h</span>
          </label>
          <input
            id="mfh-calc-hours"
            type="range"
            min={1}
            max={40}
            step={1}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            aria-valuetext={`${hours} horas por semana`}
            style={rangeStyle}
          />
          <div style={boundsStyle} aria-hidden="true">
            <span>1 h</span>
            <span>40 h</span>
          </div>
        </div>

        <div style={fieldStyle}>
          <label htmlFor="mfh-calc-rate" style={labelStyle}>
            <span>Costo por hora del personal administrativo</span>
            <span style={valueStyle}>{mxn.format(rate)} MXN</span>
          </label>
          <input
            id="mfh-calc-rate"
            type="range"
            min={50}
            max={300}
            step={10}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            aria-valuetext={`${rate} pesos por hora`}
            style={rangeStyle}
          />
          <div style={boundsStyle} aria-hidden="true">
            <span>$50</span>
            <span>$300</span>
          </div>
        </div>
      </div>

      {/* Resultado */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 12,
          background: "var(--tint, #f7f5ff)",
          border: "1px solid var(--v100, #ede9fe)",
          borderRadius: 16,
          padding: "clamp(22px, 3.2vw, 32px) clamp(16px, 3vw, 28px)",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            color: "var(--b2, #6d28d9)",
          }}
        >
          Tiempo administrativo recuperado
        </span>

        <p
          aria-live="polite"
          style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}
        >
          <strong
            style={{
              fontSize: "clamp(30px, 4.4vw, 42px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.08,
              color: "var(--ink, #0f172a)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ≈ {mxn.format(monthly)}{" "}
            <span
              style={{
                fontSize: "clamp(14px, 1.6vw, 17px)",
                fontWeight: 600,
                color: "var(--muted, #64748b)",
                letterSpacing: "-0.01em",
              }}
            >
              MXN al mes
            </span>
          </strong>
          <span style={{ fontSize: 14, color: "var(--body, #475569)" }}>
            hasta{" "}
            <strong style={{ color: "var(--ink, #0f172a)", fontVariantNumeric: "tabular-nums" }}>
              {mxn.format(yearly)}
            </strong>{" "}
            MXN al año en tiempo administrativo recuperado
          </span>
        </p>

        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            lineHeight: 1.5,
            color: "var(--faint, #94a3b8)",
            maxWidth: 380,
          }}
        >
          Estimación con base en recuperar hasta ~60% del tiempo administrativo.
          Tu caso puede variar.
        </p>

        <a
          href={signupHref}
          className="mfh-btn mfh-btn--primary mfh-btn--lg"
          style={{ marginTop: 4 }}
        >
          Pruébalo en tu clínica <ArrowRight />
        </a>
      </div>
    </div>
  );
}
