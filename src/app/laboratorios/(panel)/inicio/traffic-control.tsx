"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { DENTAL_LAB_TRAFFIC, type DentalLabTrafficLevel } from "@/lib/laboratorios/types";

const LEVELS: DentalLabTrafficLevel[] = ["LOW", "MEDIUM", "HIGH"];

// Tono semántico de DENTAL_LAB_TRAFFIC → variables CSS del design system.
const TONE_VARS: Record<"success" | "warning" | "danger", { color: string; soft: string }> = {
  success: { color: "var(--success)", soft: "var(--success-soft)" },
  warning: { color: "var(--warning)", soft: "var(--warning-soft)" },
  danger: { color: "var(--danger)", soft: "var(--danger-soft)" },
};

interface TrafficControlProps {
  canEdit: boolean;
  initialLevel: DentalLabTrafficLevel;
  initialManualMin: number | null;
  initialManualMax: number | null;
  initialNote: string;
  updatedAtLabel: string | null;
}

export function TrafficControl({
  canEdit,
  initialLevel,
  initialManualMin,
  initialManualMax,
  initialNote,
  updatedAtLabel,
}: TrafficControlProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [level, setLevel] = useState<DentalLabTrafficLevel>(initialLevel);
  const [minStr, setMinStr] = useState(initialManualMin != null ? String(initialManualMin) : "");
  const [maxStr, setMaxStr] = useState(initialManualMax != null ? String(initialManualMax) : "");
  const [note, setNote] = useState(initialNote);

  const minNorm = initialManualMin != null ? String(initialManualMin) : "";
  const maxNorm = initialManualMax != null ? String(initialManualMax) : "";
  const dirty =
    level !== initialLevel ||
    minStr.trim() !== minNorm ||
    maxStr.trim() !== maxNorm ||
    note.trim() !== initialNote.trim();

  const meta = DENTAL_LAB_TRAFFIC[level];
  const hasManual = minStr.trim() !== "" && maxStr.trim() !== "";
  const etaLabel = hasManual ? `${minStr.trim()}–${maxStr.trim()} min` : meta.rangeLabel;

  async function save() {
    const min = minStr.trim() === "" ? null : Number(minStr);
    const max = maxStr.trim() === "" ? null : Number(maxStr);
    if (min !== null && (!Number.isInteger(min) || min < 0)) {
      toast.error("Los minutos mínimos deben ser un número entero.");
      return;
    }
    if (max !== null && (!Number.isInteger(max) || max < 0)) {
      toast.error("Los minutos máximos deben ser un número entero.");
      return;
    }
    if (min != null && max != null && min > max) {
      toast.error("El mínimo no puede ser mayor que el máximo.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/laboratorios/traffic", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, manualMin: min, manualMax: max, note: note.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo actualizar el tráfico.");
      }
      toast.success("Nivel de tráfico actualizado");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Selector de nivel */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {LEVELS.map((lvl) => {
          const m = DENTAL_LAB_TRAFFIC[lvl];
          const v = TONE_VARS[m.tone];
          const selected = lvl === level;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => canEdit && setLevel(lvl)}
              disabled={!canEdit || saving}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: "var(--radius)",
                border: `1px solid ${selected ? v.color : "var(--border-soft)"}`,
                background: selected ? v.soft : "transparent",
                cursor: canEdit ? "pointer" : "default",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                transition: "border-color .15s, background .15s",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: v.color,
                    boxShadow: selected ? `0 0 6px ${v.color}` : "none",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{m.label}</span>
              </span>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                {m.rangeLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* ETA efectiva */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>Tiempo estimado de entrega:</span>
        <BadgeNew tone={meta.tone} dot>
          {etaLabel}
        </BadgeNew>
        {hasManual && <span style={{ fontSize: 11, color: "var(--text-3)" }}>(anulación manual)</span>}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{meta.desc}</p>

      {/* Anulación manual opcional */}
      <div className="form-section__title" style={{ marginTop: 4 }}>
        Anulación manual (opcional) <span className="form-section__rule" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <div className="field-new">
          <label className="field-new__label">Mín. (min)</label>
          <input
            className="input-new mono"
            type="number"
            inputMode="numeric"
            min={0}
            value={minStr}
            onChange={(e) => setMinStr(e.target.value)}
            disabled={!canEdit || saving}
            placeholder={String(meta.minMinutes)}
          />
        </div>
        <div className="field-new">
          <label className="field-new__label">Máx. (min)</label>
          <input
            className="input-new mono"
            type="number"
            inputMode="numeric"
            min={0}
            value={maxStr}
            onChange={(e) => setMaxStr(e.target.value)}
            disabled={!canEdit || saving}
            placeholder={String(meta.maxMinutes)}
          />
        </div>
      </div>
      <div className="field-new">
        <label className="field-new__label">Nota (opcional)</label>
        <input
          className="input-new"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!canEdit || saving}
          maxLength={500}
          placeholder="Ej. Lluvia fuerte en la zona"
        />
      </div>

      {!canEdit ? (
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          Solo el propietario o un gerente puede cambiar el nivel de tráfico.
        </span>
      ) : (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {updatedAtLabel && (
            <span style={{ fontSize: 11, color: "var(--text-3)", marginRight: "auto" }}>
              Actualizado: {updatedAtLabel}
            </span>
          )}
          <ButtonNew variant="primary" size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? "Guardando…" : "Guardar nivel"}
          </ButtonNew>
        </div>
      )}
    </div>
  );
}
