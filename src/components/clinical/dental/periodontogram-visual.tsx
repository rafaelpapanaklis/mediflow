"use client";

import { useMemo, useState } from "react";
import { Droplet } from "lucide-react";

interface ToothPerio {
  toothNumber: number;
  probingDepths: [number, number, number];
  bleeding: [boolean, boolean, boolean];
  plaque?: boolean;
}

interface PeriodontogramProps {
  teeth: ToothPerio[];
  onToothChange?: (toothNumber: number, data: ToothPerio) => void;
  editable?: boolean;
}

const MAX_DEPTH = 12;
const BAR_MAX_HEIGHT = 60;

const Q1 = [18, 17, 16, 15, 14, 13, 12, 11];
const Q2 = [21, 22, 23, 24, 25, 26, 27, 28];
const Q4 = [48, 47, 46, 45, 44, 43, 42, 41];
const Q3 = [31, 32, 33, 34, 35, 36, 37, 38];

function depthColor(d: number): string {
  if (d <= 3) return "#34d399";
  if (d <= 5) return "#fbbf24";
  return "#ef4444";
}

interface ToothCellProps {
  tooth?: ToothPerio;
  toothNumber: number;
  editable?: boolean;
  editingSite: { tooth: number; site: number } | null;
  setEditingSite: (v: { tooth: number; site: number } | null) => void;
  onToothChange?: (toothNumber: number, data: ToothPerio) => void;
}

function ToothCell({
  tooth,
  toothNumber,
  editable,
  editingSite,
  setEditingSite,
  onToothChange,
}: ToothCellProps) {
  const data: ToothPerio =
    tooth ?? {
      toothNumber,
      probingDepths: [0, 0, 0],
      bleeding: [false, false, false],
    };

  const anyBleeding = data.bleeding.some(Boolean);

  function handleSiteClick(siteIdx: number) {
    if (!editable) return;
    setEditingSite({ tooth: toothNumber, site: siteIdx });
  }

  function handleSiteEdit(siteIdx: number, newValue: number) {
    if (!onToothChange) return;
    const depths: [number, number, number] = [...data.probingDepths] as [number, number, number];
    depths[siteIdx] = Math.max(0, Math.min(MAX_DEPTH, newValue));
    onToothChange(toothNumber, { ...data, probingDepths: depths });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        width: 34,
      }}
    >
      <div style={{ height: 10, display: "flex", alignItems: "center" }}>
        {anyBleeding && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 6,
              background: "#ef4444",
              boxShadow: "0 0 4px #ef4444",
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 1,
          alignItems: "flex-end",
          height: BAR_MAX_HEIGHT,
          width: 30,
          justifyContent: "center",
        }}
      >
        {data.probingDepths.map((d, i) => {
          const isEditing = editingSite?.tooth === toothNumber && editingSite?.site === i;
          const h = (d / MAX_DEPTH) * BAR_MAX_HEIGHT;
          return (
            <div
              key={i}
              style={{
                position: "relative",
                width: 8,
                height: BAR_MAX_HEIGHT,
                display: "flex",
                alignItems: "flex-end",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 2,
                cursor: editable ? "pointer" : "default",
              }}
              onClick={() => handleSiteClick(i)}
              title={`Sitio ${i + 1}: ${d}mm${data.bleeding[i] ? " (sangrado)" : ""}`}
            >
              {d > 0 && (
                <div
                  style={{
                    width: "100%",
                    height: h,
                    background: depthColor(d),
                    borderRadius: 2,
                  }}
                />
              )}
              {data.bleeding[i] && (
                <div
                  style={{
                    position: "absolute",
                    top: -3,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 4,
                    height: 4,
                    borderRadius: 4,
                    background: "#ef4444",
                  }}
                />
              )}
              {isEditing && (
                <input
                  type="number"
                  min={0}
                  max={MAX_DEPTH}
                  autoFocus
                  defaultValue={d}
                  onBlur={(e) => {
                    handleSiteEdit(i, Number(e.target.value));
                    setEditingSite(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSiteEdit(i, Number((e.target as HTMLInputElement).value));
                      setEditingSite(null);
                    }
                    if (e.key === "Escape") setEditingSite(null);
                  }}
                  style={{
                    position: "absolute",
                    bottom: BAR_MAX_HEIGHT + 4,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 40,
                    padding: 2,
                    fontSize: 10,
                    border: "1px solid var(--brand)",
                    background: "var(--bg-elev)",
                    color: "var(--text-1)",
                    borderRadius: 3,
                    zIndex: 10,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--text-2)",
          fontFamily: "ui-monospace, monospace",
          paddingTop: 2,
          borderTop: data.plaque ? "2px solid #38bdf8" : "1px solid transparent",
          width: "100%",
          textAlign: "center",
        }}
      >
        {toothNumber}
      </div>
    </div>
  );
}

function renderQuadrant(
  numbers: number[],
  teethMap: Map<number, ToothPerio>,
  editable: boolean | undefined,
  editingSite: { tooth: number; site: number } | null,
  setEditingSite: (v: { tooth: number; site: number } | null) => void,
  onToothChange: PeriodontogramProps["onToothChange"]
) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {numbers.map((n) => (
        <ToothCell
          key={n}
          toothNumber={n}
          tooth={teethMap.get(n)}
          editable={editable}
          editingSite={editingSite}
          setEditingSite={setEditingSite}
          onToothChange={onToothChange}
        />
      ))}
    </div>
  );
}

export function PeriodontogramVisual({ teeth, onToothChange, editable }: PeriodontogramProps) {
  const [editingSite, setEditingSite] = useState<{ tooth: number; site: number } | null>(null);

  const stats = useMemo(() => {
    let totalSites = 0;
    let plaqueTeeth = 0;
    let bleedingSites = 0;
    let deepPocketTeeth = 0;
    for (const t of teeth) {
      totalSites += 3;
      if (t.plaque) plaqueTeeth++;
      t.bleeding.forEach((b) => b && bleedingSites++);
      if (t.probingDepths.some((d) => d >= 5)) deepPocketTeeth++;
    }
    const plaquePct = teeth.length > 0 ? Math.round((plaqueTeeth / teeth.length) * 100) : 0;
    const bleedingPct = totalSites > 0 ? Math.round((bleedingSites / totalSites) * 100) : 0;
    return { plaquePct, bleedingPct, deepPocketTeeth };
  }, [teeth]);

  const teethMap = useMemo(() => {
    const m = new Map<number, ToothPerio>();
    for (const t of teeth) m.set(t.toothNumber, t);
    return m;
  }, [teeth]);

  return (
    <div className="card" style={{ overflow: "auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          gap: 20,
          marginBottom: 16,
          flexWrap: "wrap",
          fontSize: 12,
        }}
      >
        <div>
          <div style={{ color: "var(--text-2)", fontSize: 10, textTransform: "uppercase" }}>Placa</div>
          <div style={{ fontWeight: 700, color: "var(--text-1)", fontSize: 18 }}>
            {stats.plaquePct}%
          </div>
        </div>
        <div>
          <div style={{ color: "var(--text-2)", fontSize: 10, textTransform: "uppercase" }}>Sangrado</div>
          <div style={{ fontWeight: 700, color: "#ef4444", fontSize: 18 }}>{stats.bleedingPct}%</div>
        </div>
        <div>
          <div style={{ color: "var(--text-2)", fontSize: 10, textTransform: "uppercase" }}>
            Piezas con bolsa ≥5mm
          </div>
          <div style={{ fontWeight: 700, color: "#fbbf24", fontSize: 18 }}>{stats.deepPocketTeeth}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-2)" }}>
            <span style={{ width: 8, height: 8, background: "#34d399", borderRadius: 2 }} /> ≤3mm
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-2)" }}>
            <span style={{ width: 8, height: 8, background: "#fbbf24", borderRadius: 2 }} /> 4-5mm
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-2)" }}>
            <span style={{ width: 8, height: 8, background: "#ef4444", borderRadius: 2 }} /> ≥6mm
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-2)" }}>
            <Droplet size={10} color="#38bdf8" /> placa
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          minWidth: 620,
        }}
      >
        <div>
          <div style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 6, textTransform: "uppercase" }}>
            Arcada superior
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              borderBottom: "1px solid var(--border)",
              paddingBottom: 8,
            }}
          >
            {renderQuadrant(Q1, teethMap, editable, editingSite, setEditingSite, onToothChange)}
            <div style={{ borderLeft: "1px dashed var(--border)" }} />
            {renderQuadrant(Q2, teethMap, editable, editingSite, setEditingSite, onToothChange)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 6, textTransform: "uppercase" }}>
            Arcada inferior
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {renderQuadrant(Q4, teethMap, editable, editingSite, setEditingSite, onToothChange)}
            <div style={{ borderLeft: "1px dashed var(--border)" }} />
            {renderQuadrant(Q3, teethMap, editable, editingSite, setEditingSite, onToothChange)}
          </div>
        </div>
      </div>
    </div>
  );
}
