// Badge de nivel (bronce/plata/oro) + barra de progreso al siguiente nivel.
// Server-safe: SIN "use client" (solo render de props, sin hooks).
// Colores: bronce #d97706-ish, plata #94a3b8, oro #eab308 (suaves sobre dark,
// patrón BadgeNew-like pero custom para los 3 metales).
import { Medal } from "lucide-react";
import type { LevelInfo } from "@/lib/affiliate-levels";
import { LEVEL_LABELS } from "@/lib/affiliate-levels";

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

export function LevelProgress({ info }: { info: LevelInfo }) {
  const styles = LEVEL_STYLES[info.level];
  const isGold = !info.legacy && info.level === "gold";

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
      {/* Fila superior: tile + nivel + chip de % + clínicas activas */}
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
          {info.pct}% de comisión
        </span>
        <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-3)" }}>{activeLabel}</div>
      </div>

      {info.legacy ? (
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
