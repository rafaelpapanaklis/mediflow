// Badge de nivel (bronce/plata/oro) + barra de progreso al siguiente nivel.
// Con el programa en modo "fixed" los % ya no aplican: en su lugar se pinta la
// tabla de montos por plan de la modalidad vigente del afiliado (los montos
// llegan ya calculados desde el server vía props).
// Server-safe: SIN "use client" (solo render de props, sin hooks).
// Colores: bronce #d97706-ish, plata #94a3b8, oro #eab308 (suaves sobre dark,
// patrón BadgeNew-like pero custom para los 3 metales).
import { Medal } from "lucide-react";
import type { LevelInfo } from "@/lib/affiliate-levels";
import { LEVEL_LABELS } from "@/lib/affiliate-levels";
// payout-core es PURO (sin Prisma): el componente sigue siendo server-safe.
import { PAYOUT_MODE_LABELS, type PayoutMode, type ProgramMode } from "@/lib/affiliates/payout-core";
import { formatCurrency } from "@/lib/utils";

// Paleta por nivel: color del metal + fondos/bordes suaves + gradiente de la
// barra de progreso.
const LEVEL_STYLES = {
  bronze: {
    color: "#d97706",
    soft: "rgba(217,119,6,0.12)",
    border: "rgba(217,119,6,0.35)",
    gradient: "linear-gradient(90deg, #b45309, #d97706)",
  },
  silver: {
    color: "#94a3b8",
    soft: "rgba(148,163,184,0.12)",
    border: "rgba(148,163,184,0.35)",
    gradient: "linear-gradient(90deg, #64748b, #94a3b8)",
  },
  gold: {
    color: "#eab308",
    soft: "rgba(234,179,8,0.12)",
    border: "rgba(234,179,8,0.35)",
    gradient: "linear-gradient(90deg, #ca8a04, #eab308)",
  },
};

/** Monto que paga el programa por un plan, ya resuelto en el server. */
export interface LevelAmountRow {
  /** Id del plan ("BASIC" | "PRO" | "CLINIC"). */
  plan: string;
  /** Etiqueta real del plan (sale de plan_configs, nunca escrita a mano). */
  label: string;
  /** Fijo que se paga cada mes mientras la clínica siga pagando. */
  recurringMxn: number;
  /** Fijo que se paga UNA sola vez por clínica. */
  oneTimeMxn: number;
}

export interface LevelProgressProps {
  info: LevelInfo;
  /**
   * Modo del programa. "fixed" = montos fijos por plan (los % del nivel ya no
   * aplican); "pct" o ausente = escalera de porcentajes de siempre.
   */
  mode?: ProgramMode;
  /** Modalidad vigente del afiliado (decide qué columna de montos se muestra). */
  payoutMode?: PayoutMode;
  /** Montos por plan ya calculados en el server (solo se usan en modo "fixed"). */
  amounts?: LevelAmountRow[];
}

export function LevelProgress({ info, mode, payoutMode, amounts }: LevelProgressProps) {
  const styles = LEVEL_STYLES[info.level];
  const isGold = !info.legacy && info.level === "gold";

  // Modo "fixed": los % del nivel dejan de aplicar, así que NO se pintan ni el
  // chip de % ni la barra de progreso (sería mentirle al afiliado).
  const isFixed = mode === "fixed";
  const effectiveMode: PayoutMode = payoutMode === "onetime" ? "onetime" : "recurring";
  // Un plan en $0 es un plan que el programa apagó: no genera comisión, no se lista.
  const amountRows = isFixed
    ? (amounts ?? []).filter(
        (a) => (effectiveMode === "onetime" ? a.oneTimeMxn : a.recurringMxn) > 0,
      )
    : [];

  // Singular/plural correcto en español.
  const activeLabel =
    info.activeCount === 1 ? "1 clínica activa" : `${info.activeCount} clínicas activas`;

  // Ancho de la barra: oro = llena; resto = avance hacia el siguiente umbral.
  const progressPct = isGold
    ? 100
    : info.nextThreshold && info.nextThreshold > 0
      ? Math.min(100, (info.activeCount / info.nextThreshold) * 100)
      : 0;

  const missingLabel =
    info.nextLevel != null && info.missing != null
      ? info.missing === 1
        ? `Te falta 1 clínica activa para ${LEVEL_LABELS[info.nextLevel]} (${info.nextPct}%)`
        : `Te faltan ${info.missing} clínicas activas para ${LEVEL_LABELS[info.nextLevel]} (${info.nextPct}%)`
      : null;

  return (
    <div
      style={{
        background: "var(--bg-elev-1, transparent)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Fila superior: tile + nivel + chip (% o modalidad) + clínicas activas */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            background: styles.soft,
            border: `1px solid ${styles.border}`,
            color: styles.color,
          }}
        >
          <Medal size={18} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
          Nivel {LEVEL_LABELS[info.level]}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: styles.color,
            background: styles.soft,
            border: `1px solid ${styles.border}`,
          }}
        >
          {/* El fragmento conserva el markup exacto del modo % (mismos nodos). */}
          {isFixed ? PAYOUT_MODE_LABELS[effectiveMode] : <>{info.pct}% de comisión</>}
        </span>
        <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-3)" }}>{activeLabel}</div>
      </div>

      {isFixed ? (
        // Programa con montos fijos: la tabla real de lo que gana por clínica,
        // en su modalidad vigente. Sin % ni barra de progreso a otro %.
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
              Ganas por cada clínica
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              {effectiveMode === "onetime"
                ? "Un solo pago por clínica"
                : "Cada mes que la clínica siga pagando"}
            </div>
          </div>
          {amountRows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>
              Tus montos por plan se están configurando. En cuanto estén listos los verás aquí.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {amountRows.map((a) => (
                <div
                  key={a.plan}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 12,
                    padding: "7px 0",
                    borderTop: "1px solid var(--border-soft)",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--text-2)" }}>{a.label}</span>
                  <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
                      {formatCurrency(effectiveMode === "onetime" ? a.oneTimeMxn : a.recurringMxn)}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                      {effectiveMode === "onetime" ? "una vez" : "al mes"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : info.legacy ? (
        // Modo legacy (tabla de config sin aplicar): % fijo, sin barra.
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>
          Comisión fija de {info.pct}%. Los niveles se activan próximamente.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: "var(--bg-elev-2)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                borderRadius: 999,
                background: "var(--brand-grad)",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            {isGold ? "Estás en el nivel máximo" : missingLabel}
          </div>
        </div>
      )}
    </div>
  );
}
