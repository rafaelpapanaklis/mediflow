"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { PAYOUT_MODE_LABELS, type PayoutMode, type PlanKey } from "@/lib/affiliates/payout-core";

/**
 * Elección de MODALIDAD de comisión del afiliado.
 *
 * Los montos NUNCA se escriben aquí: llegan ya resueltos en `amounts` desde el
 * server, que los saca de la config del motor (fixedAmountFor) y los precios de
 * plan_configs (getResolvedPlans). Este componente solo los presenta y calcula
 * la equivalencia "pago único ≈ N meses del fijo" a partir de esas props.
 */
export interface PayoutModeAmount {
  plan: PlanKey;
  label: string;
  priceMxn: number;
  recurringMxn: number;
  oneTimeMxn: number;
}

interface PayoutModeFormProps {
  initialMode: PayoutMode;
  /** ¿El programa deja que el afiliado elija? (cfg.allowAffiliateChoice) */
  allowChoice: boolean;
  /** false = sql/afiliados-comisiones.sql sin correr; los montos vienen en 0. */
  engineEnabled: boolean;
  amounts: PayoutModeAmount[];
}

const OPTIONS: { value: PayoutMode; blurb: string; annual: string }[] = [
  {
    value: "recurring",
    blurb: "Ganas un monto fijo cada mes mientras la clínica siga pagando.",
    // Argumento de venta, no letra chica: el plan anual se cobra completo desde
    // el día uno (no lleva mes promocional), así que su primera factura ya
    // comisiona los 12 meses juntos.
    annual: "Si vendes el plan ANUAL cobras los 12 meses de golpe, en su primera factura.",
  },
  {
    value: "onetime",
    blurb: "Ganas un solo pago por clínica y ya.",
    annual: "Si vendes el plan ANUAL cobras tu pago único de inmediato, en su primera factura.",
  },
];

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
  gap: 12,
};

// Todo el contenido de las tarjetas va en <span> con display de bloque: viven
// dentro de un <label>, cuyo modelo de contenido es phrasing content.
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 10,
};

const rowLabelStyle: CSSProperties = {
  fontSize: 12.5,
  color: "var(--text-3)",
};

const rowValueStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-1)",
  whiteSpace: "nowrap",
};

const blurbStyle: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: "var(--text-3)",
  margin: 0,
  lineHeight: 1.5,
};

// La venta anual paga por adelantado: se destaca en vez de esconderse.
const annualStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--text-2)",
  background: "var(--brand-soft)",
  border: "1px solid var(--border-brand)",
  borderRadius: 8,
  padding: "7px 10px",
};

/** Formato MXN sin decimales cuando el monto es entero ($40, $1,400, $37.50). */
function mxn(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `$${n.toLocaleString("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })}`;
}

export function PayoutModeForm({
  initialMode,
  allowChoice,
  engineEnabled,
  amounts,
}: PayoutModeFormProps) {
  // `saved` = lo que hay en BD; `mode` = lo que el usuario tiene seleccionado.
  const [saved, setSaved] = useState<PayoutMode>(initialMode);
  const [mode, setMode] = useState<PayoutMode>(initialMode);
  const [focused, setFocused] = useState<PayoutMode | null>(null);
  const [saving, setSaving] = useState(false);

  // Sin motor activo o sin permiso del programa: solo lectura.
  const readOnly = !engineEnabled || !allowChoice;
  const dirty = mode !== saved;

  /** Filas de montos de una modalidad; vacío = no hay nada que enseñar. */
  function rowsFor(target: PayoutMode): PayoutModeAmount[] {
    if (!engineEnabled) return [];
    return amounts.filter((a) => (target === "onetime" ? a.oneTimeMxn > 0 : a.recurringMxn > 0));
  }

  /**
   * Qué gana el afiliado con una venta ANUAL en esa modalidad. Solo con el
   * motor vivo: sin él las comisiones siguen saliendo del % por nivel y esta
   * regla no aplica.
   */
  function renderAnnual(target: PayoutMode) {
    if (!engineEnabled) return null;
    const opt = OPTIONS.find((o) => o.value === target);
    if (!opt) return null;
    return <span style={annualStyle}>{opt.annual}</span>;
  }

  function renderAmounts(target: PayoutMode) {
    const rows = rowsFor(target);
    if (rows.length === 0) return null;
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((a) => {
          // Trueque explícito: cuántos meses del fijo equivale el pago único.
          const months =
            target === "onetime" && a.recurringMxn > 0
              ? Math.round(a.oneTimeMxn / a.recurringMxn)
              : null;
          return (
            <span key={a.plan} style={rowStyle}>
              <span style={rowLabelStyle}>{a.label}</span>
              <span style={{ textAlign: "right" }}>
                <span className="mono" style={rowValueStyle}>
                  {target === "onetime" ? mxn(a.oneTimeMxn) : `${mxn(a.recurringMxn)}/mes`}
                </span>
                {months !== null && months > 0 && (
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-4)" }}>
                    ≈ {months} {months === 1 ? "mes" : "meses"} del fijo
                  </span>
                )}
              </span>
            </span>
          );
        })}
      </span>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/afiliados/payout-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutMode: mode }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo guardar");
      const confirmed: PayoutMode = json?.payoutMode === "onetime" ? "onetime" : "recurring";
      setSaved(confirmed);
      setMode(confirmed);
      toast.success("Modalidad actualizada");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  // ── Solo lectura ───────────────────────────────────────────────────────
  if (readOnly) {
    const active = OPTIONS.find((o) => o.value === saved) ?? OPTIONS[0];
    return (
      <CardNew title="Cómo quieres cobrar tus comisiones">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={rowLabelStyle}>Modalidad vigente</span>
            <BadgeNew tone="brand">{PAYOUT_MODE_LABELS[saved]}</BadgeNew>
          </div>
          <p style={blurbStyle}>{active.blurb}</p>
          {renderAmounts(saved)}
          {renderAnnual(saved)}
          <p style={{ ...blurbStyle, color: "var(--text-4)" }}>
            Tu modalidad la define el programa; escríbenos si necesitas cambiarla.
          </p>
        </div>
      </CardNew>
    );
  }

  // ── Editable ───────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit}>
      <CardNew title="Cómo quieres cobrar tus comisiones">
        <p style={{ ...blurbStyle, fontSize: 13, marginBottom: 16 }}>
          Elige el esquema que más te convenga. Aplica a las clínicas que refieras a partir de
          ahora.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div role="radiogroup" aria-label="Modalidad de comisión" style={gridStyle}>
            {OPTIONS.map((opt) => {
              const selected = mode === opt.value;
              const isFocused = focused === opt.value;
              return (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: 14,
                    borderRadius: 12,
                    border: `1px solid ${selected ? "var(--border-brand)" : "var(--border-soft)"}`,
                    background: selected ? "var(--brand-soft)" : "var(--bg-elev-2)",
                    // El foco del radio nativo se refleja en toda la tarjeta.
                    boxShadow: isFocused ? "var(--ring)" : "none",
                    cursor: "pointer",
                    transition: "border-color .15s, background .15s, box-shadow .15s",
                    boxSizing: "border-box",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="radio"
                      name="afiliado-payout-mode"
                      value={opt.value}
                      checked={selected}
                      onChange={() => setMode(opt.value)}
                      onFocus={() => setFocused(opt.value)}
                      onBlur={() => setFocused(null)}
                      disabled={saving}
                      style={{
                        width: 16,
                        height: 16,
                        accentColor: "var(--brand)",
                        cursor: "pointer",
                        flexShrink: 0,
                        margin: 0,
                      }}
                    />
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>
                      {PAYOUT_MODE_LABELS[opt.value]}
                    </span>
                    {saved === opt.value && <BadgeNew tone="neutral">Actual</BadgeNew>}
                  </span>
                  <span style={blurbStyle}>{opt.blurb}</span>
                  {renderAmounts(opt.value)}
                  {renderAnnual(opt.value)}
                </label>
              );
            })}
          </div>

          <div
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--warning-border-strong)",
              background: "var(--warning-soft)",
              color: "var(--text-2)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: "var(--warning-strong)" }}>Ojo: </strong>
            Cambiar tu modalidad aplica solo a las clínicas NUEVAS que refieras. Las que ya
            referiste conservan la modalidad con la que se dieron de alta.
          </div>

          <div>
            <ButtonNew type="submit" variant="primary" disabled={saving || !dirty}>
              {saving ? "Guardando…" : "Guardar modalidad"}
            </ButtonNew>
          </div>
        </div>
      </CardNew>
    </form>
  );
}
