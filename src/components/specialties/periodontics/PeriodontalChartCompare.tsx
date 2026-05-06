"use client";
// Periodontics — vista comparativa de N sondajes lado a lado + heatmap de
// evolución por sextante. SPEC §6 visual comparativo, COMMIT 10.

import { useMemo, useState } from "react";
import {
  SEXTANT_LABEL,
  SEXTANT_ORDER,
  computeSextantMetrics,
  diffSextants,
  type Sextant,
  type SextantMetrics,
} from "@/lib/periodontics/sextants";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";

export interface PerioRecordSnapshot {
  id: string;
  recordedAt: string;
  recordType: string;
  sites: Site[];
  toothLevel: ToothLevel[];
  bopPercentage: number | null;
  plaqueIndexOleary: number | null;
}

export interface PeriodontalChartCompareProps {
  /** Cronológico ascendente (más antiguo primero). El componente invierte para mostrar el más reciente a la derecha. */
  records: PerioRecordSnapshot[];
}

const TREND_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  improved: { bg: "rgba(34, 197, 94, 0.16)", fg: "rgb(22, 163, 74)", border: "rgba(34, 197, 94, 0.4)" },
  worsened: { bg: "rgba(239, 68, 68, 0.16)", fg: "rgb(220, 38, 38)", border: "rgba(239, 68, 68, 0.4)" },
  stable: { bg: "var(--bg-1)", fg: "var(--text-2)", border: "var(--border)" },
  no_data: { bg: "var(--bg-1)", fg: "var(--text-3)", border: "var(--border)" },
};

export function PeriodontalChartCompare(props: PeriodontalChartCompareProps) {
  const records = props.records;
  // Selecciona dos registros para el heatmap: por defecto el más antiguo
  // y el más reciente. El usuario puede cambiar el "before".
  const sortedAsc = useMemo(
    () => [...records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)),
    [records],
  );
  const [beforeIdx, setBeforeIdx] = useState(0);
  const [afterIdx, setAfterIdx] = useState(Math.max(0, sortedAsc.length - 1));

  if (sortedAsc.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-3)",
          border: "1px dashed var(--border)",
          borderRadius: 8,
        }}
      >
        No hay sondajes registrados para comparar.
      </div>
    );
  }

  if (sortedAsc.length === 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <RecordCard record={sortedAsc[0]} />
        <div
          style={{
            padding: 12,
            color: "var(--text-3)",
            fontSize: 12,
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          Necesitas al menos 2 sondajes para ver el comparativo y heatmap de evolución.
        </div>
      </div>
    );
  }

  const before = sortedAsc[beforeIdx];
  const after = sortedAsc[afterIdx];
  const beforeMetrics = computeSextantMetrics(before.sites, before.toothLevel);
  const afterMetrics = computeSextantMetrics(after.sites, after.toothLevel);
  const deltas = diffSextants(beforeMetrics, afterMetrics);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PickerRow
        records={sortedAsc}
        beforeIdx={beforeIdx}
        afterIdx={afterIdx}
        onChangeBefore={setBeforeIdx}
        onChangeAfter={setAfterIdx}
      />

      <Heatmap deltas={deltas} beforeMetrics={beforeMetrics} afterMetrics={afterMetrics} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <RecordCard record={before} title="Antes" />
        <RecordCard record={after} title="Después" />
      </div>
    </div>
  );
}

function PickerRow(props: {
  records: PerioRecordSnapshot[];
  beforeIdx: number;
  afterIdx: number;
  onChangeBefore: (i: number) => void;
  onChangeAfter: (i: number) => void;
}) {
  const opts = props.records.map((r, i) => ({
    value: i,
    label: `${new Date(r.recordedAt).toLocaleDateString("es-MX")} · ${recordTypeLabel(r.recordType)}`,
  }));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        padding: 12,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <PickerSelect label="Antes" value={props.beforeIdx} options={opts} onChange={props.onChangeBefore} />
      <PickerSelect label="Después" value={props.afterIdx} options={opts} onChange={props.onChangeAfter} />
    </div>
  );
}

function PickerSelect(props: {
  label: string;
  value: number;
  options: Array<{ value: number; label: string }>;
  onChange: (i: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-3)" }}>
      {props.label}
      <select
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{
          padding: "8px 10px",
          background: "var(--bg-1)",
          color: "var(--text-1)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Heatmap(props: {
  deltas: ReturnType<typeof diffSextants>;
  beforeMetrics: SextantMetrics[];
  afterMetrics: SextantMetrics[];
}) {
  // Layout 2 filas × 3 columnas (estilo CPITN: maxilar arriba, mandíbula abajo).
  // S1 S2 S3
  // S6 S5 S4
  const order: Sextant[][] = [
    ["S1", "S2", "S3"],
    ["S6", "S5", "S4"],
  ];
  const beforeMap = new Map(props.beforeMetrics.map((m) => [m.sextant, m]));
  const afterMap = new Map(props.afterMetrics.map((m) => [m.sextant, m]));
  const deltaMap = new Map(props.deltas.map((d) => [d.sextant, d]));

  return (
    <div
      style={{
        padding: 14,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 10 }}>
        Heatmap de evolución por sextante
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {order.map((row, rIdx) => (
          <div
            key={rIdx}
            style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}
          >
            {row.map((sx) => {
              const d = deltaMap.get(sx);
              const b = beforeMap.get(sx);
              const a = afterMap.get(sx);
              const trend = d?.trend ?? "no_data";
              const colors = TREND_COLOR[trend];
              return (
                <div
                  key={sx}
                  style={{
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    padding: 10,
                    minHeight: 78,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>{sx}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: colors.fg }}>
                      {trendShortLabel(trend)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                    {SEXTANT_LABEL[sx]}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: "var(--text-2)",
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>PD: {fmtMm(b?.avgPd)} → {fmtMm(a?.avgPd)}</span>
                    <span>BoP: {fmtPct(b?.bopPct)} → {fmtPct(a?.bopPct)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div
      style={{
        marginTop: 10,
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        fontSize: 11,
        color: "var(--text-2)",
      }}
    >
      <Swatch trend="improved" label="Mejoró (PD ↓ ≥0.3 mm o BoP ↓ ≥5%)" />
      <Swatch trend="stable" label="Estable" />
      <Swatch trend="worsened" label="Empeoró (PD ↑ ≥0.3 mm o BoP ↑ ≥5%)" />
    </div>
  );
}

function Swatch(props: { trend: string; label: string }) {
  const c = TREND_COLOR[props.trend];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: c.bg,
          border: `1px solid ${c.border}`,
          display: "inline-block",
        }}
      />
      {props.label}
    </span>
  );
}

function RecordCard(props: { record: PerioRecordSnapshot; title?: string }) {
  const { record } = props;
  return (
    <div
      style={{
        padding: 12,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      {props.title ? (
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase" }}>
          {props.title}
        </div>
      ) : null}
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 4 }}>
        {new Date(record.recordedAt).toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
        {recordTypeLabel(record.recordType)}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-2)", display: "flex", flexDirection: "column", gap: 2 }}>
        <span>BoP: {fmtPct(record.bopPercentage)}</span>
        <span>Placa O&apos;Leary: {fmtPct(record.plaqueIndexOleary)}</span>
        <span>Sitios: {record.sites.length}</span>
      </div>
    </div>
  );
}

function fmtMm(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(1)} mm`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n)}%`;
}

function trendShortLabel(trend: string): string {
  switch (trend) {
    case "improved":
      return "↓ Mejoró";
    case "worsened":
      return "↑ Empeoró";
    case "stable":
      return "= Estable";
    default:
      return "—";
  }
}

function recordTypeLabel(type: string): string {
  switch (type) {
    case "INICIAL":
      return "Inicial";
    case "PRE_TRATAMIENTO":
      return "Pre-tratamiento";
    case "POST_FASE_1":
      return "Post Fase 1";
    case "POST_FASE_2":
      return "Post Fase 2";
    case "MANTENIMIENTO":
      return "Mantenimiento";
    case "CIRUGIA_PRE":
      return "Pre-cirugía";
    case "CIRUGIA_POST":
      return "Post-cirugía";
    default:
      return type;
  }
}
