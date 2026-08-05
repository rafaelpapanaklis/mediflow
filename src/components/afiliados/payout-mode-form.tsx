"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Chip, Note, PanelCard } from "@/components/afiliados/ui/panel-ui";
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

// Todo el contenido de las tarjetas va en <span> con display de bloque: viven
// dentro de un <label>, cuyo modelo de contenido es phrasing content.
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 10,
  minWidth: 0,
};

const rowLabelStyle: CSSProperties = {
  fontSize: 12.5,
  color: "var(--dcafp-ink-3)",
  minWidth: 0,
};

const rowValueStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--dcafp-ink)",
  whiteSpace: "nowrap",
};

const blurbStyle: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: "var(--dcafp-ink-3)",
  margin: 0,
  lineHeight: 1.5,
};

// La venta anual paga por adelantado: se destaca en vez de esconderse. El
// morado 75 la separa tanto de la tarjeta blanca (solo lectura) como de la
// seleccionada (brand-50) y de la que no lo está (surface-2).
const annualStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--dcafp-ink-2)",
  background: "var(--dcafp-brand-75)",
  border: "1px solid var(--dcafp-brand-100)",
  borderRadius: "var(--dcafp-r-el)",
  padding: "8px 11px",
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
      <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        {rows.map((a) => {
          // Trueque explícito: cuántos meses del fijo equivale el pago único.
          const months =
            target === "onetime" && a.recurringMxn > 0
              ? Math.round(a.oneTimeMxn / a.recurringMxn)
              : null;
          return (
            <span key={a.plan} style={rowStyle}>
              <span style={rowLabelStyle}>{a.label}</span>
              <span style={{ textAlign: "right", flex: "0 0 auto" }}>
                <span className="dcafp-nums" style={rowValueStyle}>
                  {target === "onetime" ? mxn(a.oneTimeMxn) : `${mxn(a.recurringMxn)}/mes`}
                </span>
                {months !== null && months > 0 && (
                  <span style={{ display: "block", fontSize: 11, color: "var(--dcafp-ink-4)" }}>
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
      <PanelCard title="Cómo quieres cobrar tus comisiones">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={rowLabelStyle}>Modalidad vigente</span>
            <Chip tone="brand" dot>
              {PAYOUT_MODE_LABELS[saved]}
            </Chip>
          </div>
          <p style={blurbStyle}>{active.blurb}</p>
          {renderAmounts(saved)}
          {renderAnnual(saved)}
          <p className="dcafp-hint">
            Tu modalidad la define el programa; escríbenos si necesitas cambiarla.
          </p>
        </div>
      </PanelCard>
    );
  }

  // ── Editable ───────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit}>
      <PanelCard
        title="Cómo quieres cobrar tus comisiones"
        sub="Elige el esquema que más te convenga. Aplica a las clínicas que refieras a partir de ahora."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div role="radiogroup" aria-label="Modalidad de comisión" className="dcafp-autogrid">
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
                    minWidth: 0,
                    borderRadius: "var(--dcafp-r-box)",
                    // 1.5px en los dos estados: si la seleccionada engordara el
                    // borde, la tarjeta saltaría 1px al elegirla.
                    border: `1.5px solid ${selected ? "var(--dcafp-brand-300)" : "var(--dcafp-line)"}`,
                    background: selected ? "var(--dcafp-brand-50)" : "var(--dcafp-surface-2)",
                    // El foco del radio nativo se refleja en toda la tarjeta.
                    boxShadow: isFocused ? "var(--ring)" : "none",
                    cursor: "pointer",
                    transition: "border-color .15s, background .15s, box-shadow .15s",
                    boxSizing: "border-box",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
                        width: 17,
                        height: 17,
                        accentColor: "var(--dcafp-brand)",
                        cursor: "pointer",
                        flexShrink: 0,
                        margin: 0,
                      }}
                    />
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dcafp-ink)" }}>
                      {PAYOUT_MODE_LABELS[opt.value]}
                    </span>
                    {saved === opt.value && (
                      <Chip tone="neutral" sm>
                        Actual
                      </Chip>
                    )}
                  </span>
                  <span style={blurbStyle}>{opt.blurb}</span>
                  {renderAmounts(opt.value)}
                  {renderAnnual(opt.value)}
                </label>
              );
            })}
          </div>

          <Note tone="warn">
            <strong>Ojo: </strong>
            Cambiar tu modalidad aplica solo a las clínicas NUEVAS que refieras. Las que ya
            referiste conservan la modalidad con la que se dieron de alta.
          </Note>

          <div>
            <button type="submit" className="dcafp-btn dcafp-btn--primary" disabled={saving || !dirty}>
              {saving ? "Guardando…" : "Guardar modalidad"}
            </button>
          </div>
        </div>
      </PanelCard>
    </form>
  );
}
