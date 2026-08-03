"use client";

/**
 * Calculadora pública del programa de afiliados (diseño
 * Afiliados-DaleControl.dc.html): clínicas por plan + horizonte de 1 a 10
 * años, con el acumulado del fijo recurrente contra el pago único y una
 * barra por año.
 *
 * CORTE SERVER/CLIENT (la razón de que exista payout-core):
 * este componente importa SÓLO de `@/lib/affiliates/payout-core` —módulo
 * puro, sin Prisma—. Importar `payout.ts` o `public-offer.ts` desde aquí
 * metería el cliente de Prisma en el bundle del navegador y rompería el
 * build. Los montos llegan como PROPS desde el server component de
 * /afiliados, que sí los resuelve en vivo desde affiliate_payout_config y
 * plan_configs: en este archivo no hay ni un peso escrito a mano.
 *
 * Iconos en SVG inline y no lucide-react: son cuatro trazos y así no entra
 * una dependencia más al bundle del cliente.
 */

import { useState } from "react";
import { DEFAULT_PAYOUT_CONFIG, type PlanKey } from "@/lib/affiliates/payout-core";

/**
 * Espejo local de PublicOfferPlan. A propósito NO se importa el tipo de
 * `public-offer.ts`: aunque un `import type` se borra al compilar, basta un
 * refactor que lo convierta en import de valor para arrastrar Prisma al
 * navegador. Una interfaz de cinco campos sale más barata que ese riesgo.
 */
export interface PlanRow {
  key: PlanKey;
  label: string;
  priceMxn: number;
  recurringMxn: number;
  oneTimeMxn: number;
}

export interface CalculadoraAfiliadosProps {
  plans: PlanRow[];
  /**
   * Cobros de cada clínica que NO comisionan (el mes promocional). Sale de
   * `startAtInvoiceNo − 1`: si el admin mueve el arranque, el "−1" de la
   * fórmula lo sigue solo.
   */
  cobrosSinComision: number;
  /** Horizonte inicial del slider, en años. */
  aniosIniciales?: number;
}

const MAX_CLINICAS = 99;
const MIN_ANIOS = 1;
const MAX_ANIOS = 10;

/** Conteo inicial del diseño: 1 Básico, 3 Profesional, 0 Clínica. */
const SEMILLA: Record<PlanKey, number> = { BASIC: 1, PRO: 3, CLINIC: 0 };

/** Mismo formato que `fmtMxn` de public-offer, duplicado para no importarlo. */
function fmtMxn(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return "$" + Math.round(value).toLocaleString("es-MX");
}

function clampN(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

const cardBase: React.CSSProperties = {
  borderRadius: 16,
  padding: 20,
  minWidth: 0,
};

export function CalculadoraAfiliados({
  plans,
  cobrosSinComision,
  aniosIniciales = 5,
}: CalculadoraAfiliadosProps) {
  // Un plan sin comisión en ninguna de las dos modalidades está apagado en la
  // config: sumarlo sólo produciría ceros confusos.
  const activos = plans.filter((p) => p.recurringMxn > 0 || p.oneTimeMxn > 0);
  const rows = activos.length > 0 ? activos : plans;

  const [counts, setCounts] = useState<Record<PlanKey, number>>(() => {
    const base: Record<PlanKey, number> = { BASIC: 0, PRO: 0, CLINIC: 0 };
    for (const p of rows) base[p.key] = SEMILLA[p.key] ?? 0;
    return base;
  });
  const [years, setYears] = useState<number>(() =>
    clampN(aniosIniciales, MIN_ANIOS, MAX_ANIOS),
  );

  function setCount(key: PlanKey, raw: number) {
    setCounts((prev) => ({ ...prev, [key]: clampN(raw, 0, MAX_CLINICAS) }));
  }

  if (rows.length === 0) return null;

  // ── Matemática del diseño, con los montos de la config ──────────────────
  // El "−cobrosSinComision" es el mes promocional de cada clínica: ese cobro
  // entra con precio de promoción y por eso no genera comisión.
  const skip =
    Number.isFinite(cobrosSinComision) && cobrosSinComision > 0
      ? Math.round(cobrosSinComision)
      : 0;

  let monthly = 0;
  let unico = 0;
  for (const p of rows) {
    const n = counts[p.key] ?? 0;
    monthly += n * p.recurringMxn;
    unico += n * p.oneTimeMxn;
  }

  const months = Math.max(0, 12 * years - skip);
  const acum = monthly * months;
  const diff = acum - unico;
  const max = Math.max(acum, unico, 1);

  const bars: { y: number; pct: string; title: string }[] = [];
  if (monthly > 0) {
    for (let y = 1; y <= years; y++) {
      const v = monthly * Math.max(0, 12 * y - skip);
      bars.push({
        y,
        pct: Math.max((v / max) * 100, 2).toFixed(1),
        title: `Año ${y}: ${fmtMxn(v)} acumulados`,
      });
    }
  }

  const linePct = Math.min((unico / max) * 100, 100).toFixed(1);
  const yearsLabel = `${years} ${years === 1 ? "año" : "años"}`;
  const hasData = monthly > 0 || unico > 0;

  // La nota tiene que seguir al arranque configurado: con 0 no hay "−0" que
  // explicar, y con 2 o más el plural cambia.
  const formulaNota =
    skip === 0
      ? `Cálculo: ${fmtMxn(monthly)} × ${months} cobros por clínica (12 × ${years}). Cada cobro de la clínica comisiona.`
      : skip === 1
        ? `Cálculo: ${fmtMxn(monthly)} × ${months} cobros por clínica (12 × ${years} − 1). El −1 es el primer cobro de cada clínica, que no comisiona por ser su mes promocional.`
        : `Cálculo: ${fmtMxn(monthly)} × ${months} cobros por clínica (12 × ${years} − ${skip}). Los −${skip} son los primeros cobros de cada clínica, que no comisionan por ser promocionales.`;

  return (
    <div className="dcaf-calcgrid" style={{ marginTop: 40 }}>
      {/* ── Controles ──────────────────────────────────────────────────── */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, boxShadow: "0 1px 3px rgba(15,23,42,.05)", minWidth: 0 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em" }}>
          Clínicas que crees poder traer
        </h3>

        {rows.map((p, i) => {
          const id = `dcaf-count-${p.key}`;
          const value = counts[p.key] ?? 0;
          const meta: string[] = [];
          if (p.recurringMxn > 0) meta.push(`${fmtMxn(p.recurringMxn)}/mes`);
          if (p.oneTimeMxn > 0) meta.push(`o ${fmtMxn(p.oneTimeMxn)} únicos`);

          return (
            <div
              key={p.key}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "16px 0",
                borderBottom: i < rows.length - 1 ? "1px solid #f1f5f9" : undefined,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <label htmlFor={id} style={{ display: "block", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                  Plan {p.label}
                </label>
                {meta.length > 0 && (
                  <span style={{ fontSize: 13, color: "#64748b" }}>{meta.join(" · ")}</span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                <button
                  type="button"
                  className="dcaf-step"
                  aria-label={`Quitar una clínica del plan ${p.label}`}
                  disabled={value <= 0}
                  onClick={() => setCount(p.key, value - 1)}
                  style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontSize: 22, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: value <= 0 ? 0.45 : 1 }}
                >
                  −
                </button>
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_CLINICAS}
                  step={1}
                  value={value}
                  onChange={(e) => setCount(p.key, e.target.value === "" ? 0 : Number(e.target.value))}
                  style={{ width: 58, height: 44, textAlign: "center", border: "1px solid #cbd5e1", borderRadius: 11, fontWeight: 700, fontSize: 17, color: "#0f172a", background: "#ffffff" }}
                />
                <button
                  type="button"
                  className="dcaf-step"
                  aria-label={`Agregar una clínica al plan ${p.label}`}
                  disabled={value >= MAX_CLINICAS}
                  onClick={() => setCount(p.key, value + 1)}
                  style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontSize: 22, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: value >= MAX_CLINICAS ? 0.45 : 1 }}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: 14, paddingTop: 18, borderTop: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <label htmlFor="dcaf-anios" style={{ fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Horizonte
            </label>
            <span style={{ background: "#2563eb", color: "#ffffff", fontWeight: 700, fontSize: 14, padding: "6px 14px", borderRadius: 999 }}>
              {yearsLabel}
            </span>
          </div>
          <input
            id="dcaf-anios"
            className="dcaf-range"
            type="range"
            min={MIN_ANIOS}
            max={MAX_ANIOS}
            step={1}
            value={years}
            aria-valuetext={yearsLabel}
            onChange={(e) => setYears(clampN(Number(e.target.value), MIN_ANIOS, MAX_ANIOS))}
            style={{ marginTop: 12 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8" }}>
            <span>1 año</span>
            <span>10 años</span>
          </div>
        </div>
      </div>

      {/* ── Resultados ─────────────────────────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div aria-live="polite" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,205px),1fr))", gap: 14 }}>
          <div style={{ ...cardBase, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#1d4ed8" }}>
              Fijo recurrente
            </span>
            <div style={{ fontSize: "clamp(28px,3vw,34px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#0f172a", marginTop: 6, overflowWrap: "anywhere" }}>
              {fmtMxn(acum)}
            </div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
              acumulado en {yearsLabel} · {fmtMxn(monthly)} al mes con todas activas
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 12, borderTop: "1px dashed #bfdbfe", paddingTop: 10, lineHeight: 1.55 }}>
              {formulaNota}
            </div>
          </div>

          <div style={{ ...cardBase, background: "#ffffff", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#64748b" }}>
              Pago único
            </span>
            <div style={{ fontSize: "clamp(28px,3vw,34px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#0f172a", marginTop: 6, overflowWrap: "anywhere" }}>
              {fmtMxn(unico)}
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>de golpe, por esas clínicas</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 12, borderTop: "1px dashed #e2e8f0", paddingTop: 10, lineHeight: 1.55 }}>
              Ese pago no se repite: se cobra una vez y ahí termina.
            </div>
          </div>

          <div style={{ ...cardBase, background: "#dcfce7", border: "1px solid #bbf7d0" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#15803d" }}>
              Diferencia en {yearsLabel}
            </span>
            <div style={{ fontSize: "clamp(28px,3vw,34px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#15803d", marginTop: 6, overflowWrap: "anywhere" }}>
              {(diff >= 0 ? "+" : "−") + fmtMxn(Math.abs(diff))}
            </div>
            <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>
              {diff >= 0 ? "a favor del fijo recurrente" : "a favor del pago único"}
            </div>
          </div>
        </div>

        {/* ── Gráfica: acumulado por año contra el pago único ───────────── */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, marginTop: 14, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>Cómo crece en {yearsLabel}</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "#64748b" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: "#2563eb", display: "inline-block" }} />
                Recurrente acumulado
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 14, borderTop: "2px dashed #15803d", display: "inline-block" }} />
                Pago único
              </span>
            </div>
          </div>

          <div style={{ position: "relative", height: 200, marginTop: 14 }}>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 6 }}>
              {bars.map((bar) => (
                <div key={bar.y} title={bar.title} style={{ flex: "1 1 0", height: "100%", display: "flex", alignItems: "flex-end", minWidth: 0 }}>
                  <div style={{ width: "100%", height: `${bar.pct}%`, background: "linear-gradient(180deg,#60a5fa,#2563eb)", borderRadius: "6px 6px 2px 2px", transition: "height .25s ease" }} />
                </div>
              ))}
            </div>

            {hasData && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: `${linePct}%`, borderTop: "2px dashed #15803d", transition: "bottom .25s ease" }}>
                <span style={{ position: "absolute", right: 0, top: -26, fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid #bbf7d0", padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>
                  Pago único: {fmtMxn(unico)}
                </span>
              </div>
            )}

            {!hasData && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 14, color: "#64748b", padding: "0 20px" }}>
                Agrega al menos una clínica para ver la comparación.
              </div>
            )}
          </div>

          {bars.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {bars.map((bar) => (
                  <div key={bar.y} style={{ flex: "1 1 0", textAlign: "center", fontSize: 11, color: "#94a3b8", minWidth: 0 }}>
                    {bar.y}
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "center", fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>años del horizonte</div>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 22 }}>
          <a href="/afiliados/registro" className="dcaf-btn-blue" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 52, padding: "14px 34px", background: "#2563eb", color: "#ffffff", fontWeight: 700, fontSize: 16.5, borderRadius: 12, boxShadow: "0 6px 16px rgba(37,99,235,.25)" }}>
            Registrarme gratis
          </a>
          <p style={{ fontSize: 12.5, color: "#64748b", marginTop: 12, maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
            Es una estimación con los montos vigentes hoy y asumiendo que esas clínicas siguen
            activas. No es una promesa de ingresos.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Respaldo del arranque por si el server no lo mandara (nunca debería). */
export const COBROS_SIN_COMISION_DEFAULT = Math.max(
  0,
  DEFAULT_PAYOUT_CONFIG.startAtInvoiceNo - 1,
);
