"use client";

interface Props {
  presets: readonly number[];
  duration: number;
  customInput: string;
  onSelectPreset: (minutes: number) => void;
  onCustomChange: (raw: string) => void;
}

/**
 * Selector de duración del rediseño: chips segmentados + input numérico
 * personalizado (5–480 min). El padre conserva el clamping y el reseteo del
 * input custom al elegir un preset (lógica intacta vía callbacks).
 */
export function DurationPicker({ presets, duration, customInput, onSelectPreset, onCustomChange }: Props) {
  const hasCustom = customInput.length > 0;
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {presets.map((min) => {
        const active = duration === min;
        return (
          <button
            key={min}
            type="button"
            onClick={() => onSelectPreset(min)}
            style={{
              flex: 1,
              padding: "9px 0",
              border: "1px solid",
              borderColor: active ? "var(--border-brand)" : "var(--border-soft)",
              background: active ? "var(--brand-soft)" : "var(--bg-elev)",
              color: active ? "var(--trial-accent-calm)" : "var(--text-2)",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            {min}
            <span style={{ fontWeight: 400, opacity: 0.6 }}>m</span>
          </button>
        );
      })}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flex: 1.2,
          padding: "0 8px 0 12px",
          border: "1px solid",
          borderColor: hasCustom ? "var(--border-brand)" : "var(--border-soft)",
          background: hasCustom ? "var(--brand-soft)" : "var(--bg-elev)",
          borderRadius: 8,
          transition: "all 0.12s",
        }}
      >
        <input
          type="number"
          min={5}
          max={480}
          step={5}
          value={customInput}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="otro"
          aria-label="Duración personalizada en minutos"
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: "9px 0",
            fontSize: 13,
            fontWeight: 600,
            textAlign: "center",
            color: hasCustom ? "var(--trial-accent-calm)" : "var(--text-1)",
            fontFamily: "var(--font-jetbrains-mono, monospace)",
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: hasCustom ? "var(--trial-accent-calm)" : "var(--text-4)",
            fontWeight: 500,
            marginLeft: 2,
          }}
        >
          min
        </span>
      </div>
    </div>
  );
}
