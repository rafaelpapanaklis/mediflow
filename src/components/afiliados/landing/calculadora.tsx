"use client";

/**
 * Calculadora pública del programa de afiliados (diseño
 * Afiliados-DaleControl.dc.html): clínicas por plan + horizonte por
 * ESCALONES (1 mes · 6 meses · 1 año · 3 años · 5 años · 10 años), con el
 * acumulado del fijo recurrente contra el pago único y una barra por mes o
 * por año según el escalón.
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
  /**
   * Horizonte inicial en MESES. Se ajusta al escalón más cercano; por defecto
   * 1 año, que es el más creíble de entrada y deja que la persona descubra el
   * efecto acumulado moviendo el control.
   */
  mesesIniciales?: number;
}

const MAX_CLINICAS = 99;

/**
 * Los seis escalones del horizonte. El estado es el ÍNDICE de este array, no
 * los meses: así los saltos del slider son PAREJOS aunque los valores no lo
 * sean (de 1 a 6 meses y de 5 a 10 años miden lo mismo en la barra).
 */
const PASOS = [
  { meses: 1, label: "1 mes" },
  { meses: 6, label: "6 meses" },
  { meses: 12, label: "1 año" },
  { meses: 36, label: "3 años" },
  { meses: 60, label: "5 años" },
  { meses: 120, label: "10 años" },
] as const;

/** Índice de "1 año". */
const PASO_DEFAULT = 2;

/** Escalón más cercano a unos meses dados (el prop nunca tiene que ser exacto). */
function indiceDePaso(meses: number): number {
  if (!Number.isFinite(meses)) return PASO_DEFAULT;
  let best = PASO_DEFAULT;
  let bestDiff = Infinity;
  for (let i = 0; i < PASOS.length; i++) {
    const d = Math.abs(PASOS[i].meses - meses);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

/** Conteo inicial del diseño: 1 Básico, 3 Profesional, 0 Clínica. */
const SEMILLA: Record<PlanKey, number> = { BASIC: 1, PRO: 3, CLINIC: 0 };

/** Mismo formato que `fmtMxn` de public-offer, duplicado para no importarlo. */
function fmtMxn(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return "$" + Math.round(value).toLocaleString("es-MX");
}

/**
 * "El cobro en el que arranca la comisión", en palabras. Se deriva del arranque
 * configurado (`cobrosSinComision + 1`): el número jamás se escribe a mano.
 */
function cobroOrdinal(n: number): string {
  if (n <= 1) return "primer cobro";
  if (n === 2) return "segundo cobro";
  if (n === 3) return "tercer cobro";
  return `cobro número ${n}`;
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
  mesesIniciales = PASOS[PASO_DEFAULT].meses,
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
  const [pasoIdx, setPasoIdx] = useState<number>(() => indiceDePaso(mesesIniciales));

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

  // El horizonte llega en MESES desde el escalón; el acumulado sale de los
  // cobros que de verdad comisionan.
  const paso = PASOS[pasoIdx] ?? PASOS[PASO_DEFAULT];
  const horizonteMeses = paso.meses;
  const horizonteLabel = paso.label;
  const cobros = Math.max(0, horizonteMeses - skip);
  const acum = monthly * cobros;
  const diff = acum - unico;
  const max = Math.max(acum, unico, 1);

  // Unidad de las barras según el escalón: hasta 1 año una por MES (1, 6 o 12
  // barras), de 3 años en adelante una por AÑO (3, 5 o 10). Nunca pasan de 12,
  // así que ninguna se encima ni hay que agrupar.
  const barPorMes = horizonteMeses <= 12;
  const nBars = barPorMes ? horizonteMeses : Math.round(horizonteMeses / 12);
  const bars: { i: number; pct: string; title: string }[] = [];
  if (monthly > 0) {
    for (let i = 1; i <= nBars; i++) {
      const mesesHasta = barPorMes ? i : i * 12;
      const v = monthly * Math.max(0, mesesHasta - skip);
      bars.push({
        i,
        pct: Math.max((v / max) * 100, 2).toFixed(1),
        title: barPorMes
          ? `Mes ${i}: ${fmtMxn(v)} acumulados`
          : `Año ${i}: ${fmtMxn(v)} acumulados`,
      });
    }
  }

  const linePct = Math.min((unico / max) * 100, 100).toFixed(1);
  // Con horizontes cortos el pago único va arriba y su línea queda pegada al
  // borde superior: ahí la etiqueta se encimaría con la leyenda, así que baja
  // al otro lado de la línea.
  const etiquetaUnicoArriba = Number(linePct) < 80;
  const hasData = monthly > 0 || unico > 0;
  // Horizonte tan corto que ningún cobro comisiona todavía (con el arranque de
  // hoy, el escalón de 1 mes). El $0 es real y no se maquilla, pero se explica.
  const sinCobros = cobros === 0;
  const primerCobroLabel = cobroOrdinal(skip + 1);

  // Mes en el que el fijo recurrente alcanza al pago único. Es lo que convierte
  // una diferencia negativa en información útil en vez de un "vas perdiendo".
  const mesCruce =
    monthly > 0 && unico > 0 ? skip + Math.ceil(unico / monthly) : null;
  const cruceLabel =
    mesCruce === null
      ? null
      : mesCruce > 12
        ? `mes ${mesCruce} (año ${Math.ceil(mesCruce / 12)})`
        : `mes ${mesCruce}`;

  // La fórmula habla en la unidad del escalón elegido: "6 meses − 1" cuando se
  // eligieron 6 meses, "12 × 3 − 1" cuando se eligieron 3 años.
  const baseFormula =
    horizonteMeses < 12
      ? `${horizonteMeses} ${horizonteMeses === 1 ? "mes" : "meses"}`
      : horizonteMeses === 12
        ? "12 meses"
        : `12 × ${Math.round(horizonteMeses / 12)}`;

  // La nota tiene que seguir al arranque configurado: con 0 no hay "−0" que
  // explicar, y con 2 o más el plural cambia.
  const notaSkip =
    skip === 1
      ? "El −1 es el primer cobro de cada clínica, que no comisiona por ser su mes promocional."
      : `Los −${skip} son los primeros cobros de cada clínica, que no comisionan por ser promocionales.`;

  const formulaNota =
    skip === 0
      ? `Cálculo: ${fmtMxn(monthly)} × ${cobros} cobros por clínica (${baseFormula}). Cada cobro de la clínica comisiona.`
      : sinCobros
        ? `Cálculo: ${baseFormula} − ${skip} = 0 cobros que comisionen. ${notaSkip}`
        : `Cálculo: ${fmtMxn(monthly)} × ${cobros} cobros por clínica (${baseFormula} − ${skip}). ${notaSkip}`;

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
            <label htmlFor="dcaf-horizonte" style={{ fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Horizonte
            </label>
            <span style={{ background: "#2563eb", color: "#ffffff", fontWeight: 700, fontSize: 14, padding: "6px 14px", borderRadius: 999 }}>
              {horizonteLabel}
            </span>
          </div>

          {/* Chips y slider son dos caras del MISMO estado (`pasoIdx`): mover
              uno marca el otro. Rejilla fija de 3 columnas —dos filas de tres—
              porque a 375px los seis en un renglón no caben y esta página no
              puede scrollear en horizontal. */}
          <div
            role="group"
            aria-label="Horizonte de la proyección"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 12 }}
          >
            {PASOS.map((p, i) => {
              const activo = i === pasoIdx;
              return (
                <button
                  key={p.meses}
                  type="button"
                  className="dcaf-chip"
                  aria-pressed={activo}
                  onClick={() => setPasoIdx(i)}
                  style={{
                    minHeight: 44,
                    padding: "10px 6px",
                    borderRadius: 12,
                    fontSize: 13.5,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    border: activo ? "1px solid #2563eb" : "1px solid #bfdbfe",
                    background: activo ? "#2563eb" : "#eff6ff",
                    color: activo ? "#ffffff" : "#1d4ed8",
                    boxShadow: activo ? "0 4px 12px rgba(37,99,235,.25)" : undefined,
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <input
            id="dcaf-horizonte"
            className="dcaf-range"
            type="range"
            min={0}
            max={PASOS.length - 1}
            step={1}
            value={pasoIdx}
            // El lector de pantalla anuncia "3 años", no el índice crudo.
            aria-valuetext={horizonteLabel}
            onChange={(e) => setPasoIdx(clampN(Number(e.target.value), 0, PASOS.length - 1))}
            style={{ marginTop: 14 }}
          />
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
              {sinCobros && monthly > 0 ? (
                <>
                  Todavía $0 en {horizonteLabel} — tu primera comisión llega con el{" "}
                  {primerCobroLabel} de la clínica. A partir de ahí, {fmtMxn(monthly)} al mes
                  con todas activas.
                </>
              ) : (
                <>
                  acumulado en {horizonteLabel} · {fmtMxn(monthly)} al mes con todas activas
                </>
              )}
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
              Diferencia en {horizonteLabel}
            </span>
            <div style={{ fontSize: "clamp(28px,3vw,34px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#15803d", marginTop: 6, overflowWrap: "anywhere" }}>
              {(diff >= 0 ? "+" : "−") + fmtMxn(Math.abs(diff))}
            </div>
            <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>
              {diff >= 0 ? "a favor del fijo recurrente" : "a favor del pago único"}
            </div>
            {/* La comparación habla SIEMPRE del horizonte elegido: en escalones
                cortos el pago único va arriba, y decir en qué mes lo alcanza el
                fijo recurrente es más útil que dejar el número negativo solo. */}
            {hasData && (
              <div style={{ fontSize: 12, color: "#15803d", marginTop: 12, borderTop: "1px dashed #bbf7d0", paddingTop: 10, lineHeight: 1.55 }}>
                {diff >= 0 ? (
                  <>
                    En {horizonteLabel} el fijo recurrente ya va arriba, y sigue corriendo
                    mientras esas clínicas sigan activas. El pago único termina donde lo ves.
                  </>
                ) : cruceLabel ? (
                  <>
                    En {horizonteLabel} el pago único todavía va arriba. El fijo recurrente lo
                    alcanza en el {cruceLabel} y de ahí en adelante nunca se detiene.
                  </>
                ) : (
                  <>
                    En {horizonteLabel} el pago único todavía va arriba; el fijo recurrente
                    sigue sumando mientras esas clínicas sigan activas.
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Gráfica: acumulado por año contra el pago único ───────────── */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, marginTop: 14, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>Cómo crece en {horizonteLabel}</h3>
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
            {/* `justifyContent: center` + el tope de ancho sólo hacen algo con
                UNA barra (escalón de 1 mes): sin ellos, esa única barra se
                estira de lado a lado y parece una regla, no una barra. Con dos
                o más, `flex: 1 1 0` las reparte igual que siempre. */}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 6 }}>
              {bars.map((bar) => (
                <div key={bar.i} title={bar.title} style={{ flex: "1 1 0", maxWidth: bars.length === 1 ? 96 : undefined, height: "100%", display: "flex", alignItems: "flex-end", minWidth: 0 }}>
                  <div style={{ width: "100%", height: `${bar.pct}%`, background: "linear-gradient(180deg,#60a5fa,#2563eb)", borderRadius: "6px 6px 2px 2px", transition: "height .25s ease" }} />
                </div>
              ))}
            </div>

            {hasData && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: `${linePct}%`, borderTop: "2px dashed #15803d", transition: "bottom .25s ease" }}>
                <span style={{ position: "absolute", right: 0, top: etiquetaUnicoArriba ? -26 : 6, fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid #bbf7d0", padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>
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
              {/* Mismo reparto que las barras para que cada número caiga bajo la suya. */}
              <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "center" }}>
                {bars.map((bar) => (
                  <div key={bar.i} style={{ flex: "1 1 0", maxWidth: bars.length === 1 ? 96 : undefined, textAlign: "center", fontSize: 11, color: "#94a3b8", minWidth: 0 }}>
                    {bar.i}
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "center", fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>
                {barPorMes ? "meses del horizonte" : "años del horizonte"}
              </div>
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
