"use client";
// EndodonticRadiographCompare — vista lado a lado de RX endo en hitos
// pre_tc / post_tc_immediate / control_6m / 12m / 24m. Selector lateral
// + delta de PAI calculado vía effectivePaiScore (manual > detectado).
//
// La detección automática de PAI vía IA queda deshabilitada por ahora
// (XrayAnalysisMode no incluye PERIAPICAL_PAI todavía); el componente
// acepta detectedPaiScore para cuando esté listo.

import { useEffect, useMemo, useState } from "react";
import { Activity, Sparkles } from "lucide-react";
import {
  RADIOGRAPH_MILESTONES,
  RADIOGRAPH_MILESTONE_LABEL,
  availableMilestones,
  describePAI,
  describePaiDelta,
  effectivePaiScore,
  paiDelta,
  type RadiographEntry,
  type RadiographMilestone,
} from "@/lib/endodontics/radiograph-compare/milestones";

export interface EndodonticRadiographCompareProps {
  toothFdi: number;
  entries: RadiographEntry[];
  showAiHint?: boolean;
}

export function EndodonticRadiographCompare(props: EndodonticRadiographCompareProps) {
  const milestones = useMemo(() => availableMilestones(props.entries), [props.entries]);

  const [leftMilestone, setLeftMilestone] = useState<RadiographMilestone | null>(
    milestones[0] ?? null,
  );
  const [rightMilestone, setRightMilestone] = useState<RadiographMilestone | null>(
    milestones[milestones.length - 1] ?? null,
  );

  useEffect(() => {
    if (!leftMilestone && milestones[0]) setLeftMilestone(milestones[0]);
    if (!rightMilestone && milestones.length > 1) {
      setRightMilestone(milestones[milestones.length - 1]!);
    }
  }, [milestones, leftMilestone, rightMilestone]);

  const left = useMemo(
    () => props.entries.find((e) => e.milestone === leftMilestone) ?? null,
    [leftMilestone, props.entries],
  );
  const right = useMemo(
    () => props.entries.find((e) => e.milestone === rightMilestone) ?? null,
    [rightMilestone, props.entries],
  );

  const delta = left && right ? paiDelta(left, right) : null;

  if (props.entries.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-2)",
          border: "1px dashed var(--border)",
          borderRadius: 10,
          background: "var(--surface-1)",
          fontSize: 13,
        }}
      >
        Sin radiografías endodónticas para la pieza {props.toothFdi}.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          <Activity size={14} /> Comparativo radiográfico · pieza {props.toothFdi}
        </strong>
        {(props.showAiHint ?? true) ? (
          <span
            title="Si tu plan tiene IA y el archivo cuenta con XrayAnalysis modo PERIAPICAL_PAI, el score se sugiere automáticamente."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "var(--text-2)",
            }}
          >
            <Sparkles size={12} /> PAI detectado por IA cuando esté disponible
          </span>
        ) : null}
      </header>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Selector
          label="Izquierda"
          value={leftMilestone}
          onChange={setLeftMilestone}
          options={RADIOGRAPH_MILESTONES.filter((m) => milestones.includes(m))}
        />
        <Selector
          label="Derecha"
          value={rightMilestone}
          onChange={setRightMilestone}
          options={RADIOGRAPH_MILESTONES.filter((m) => milestones.includes(m))}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Pane entry={left} side="left" />
        <Pane entry={right} side="right" />
      </div>

      {left && right ? (
        <div
          style={{
            padding: 10,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface-2)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 13,
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          <span>
            <strong>{describePaiDelta(delta)}</strong> entre{" "}
            {RADIOGRAPH_MILESTONE_LABEL[left.milestone]} y {" "}
            {RADIOGRAPH_MILESTONE_LABEL[right.milestone]}.
          </span>
          <span style={{ color: "var(--text-2)" }}>
            {describePAI(effectivePaiScore(left))} → {describePAI(effectivePaiScore(right))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Selector(props: {
  label: string;
  value: RadiographMilestone | null;
  onChange: (m: RadiographMilestone | null) => void;
  options: readonly RadiographMilestone[];
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 12,
        color: "var(--text-2)",
        flex: 1,
      }}
    >
      <span>{props.label}</span>
      <select
        value={props.value ?? ""}
        onChange={(e) =>
          props.onChange((e.target.value || null) as RadiographMilestone | null)
        }
        style={{
          padding: "6px 8px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--surface-1)",
          color: "var(--text-1)",
          fontSize: 13,
        }}
      >
        <option value="">— sin selección —</option>
        {props.options.map((m) => (
          <option key={m} value={m}>
            {RADIOGRAPH_MILESTONE_LABEL[m]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pane(props: { entry: RadiographEntry | null; side: "left" | "right" }) {
  if (!props.entry) {
    return (
      <div
        style={{
          aspectRatio: "1 / 1",
          border: "1px dashed var(--border)",
          borderRadius: 8,
          background: "var(--surface-1)",
          color: "var(--text-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
        }}
      >
        Selecciona un hito para esta vista.
      </div>
    );
  }
  const pai = effectivePaiScore(props.entry);
  return (
    <figure
      style={{
        margin: 0,
        padding: 8,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <figcaption style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
        <strong>{RADIOGRAPH_MILESTONE_LABEL[props.entry.milestone]}</strong>
        <span style={{ color: "var(--text-2)" }}>
          {new Date(props.entry.takenAt).toLocaleDateString("es-MX")}
        </span>
      </figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={props.entry.fileUrl}
        alt={`RX ${props.side} ${RADIOGRAPH_MILESTONE_LABEL[props.entry.milestone]}`}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          objectFit: "contain",
          background: "#000",
          borderRadius: 6,
        }}
      />
      <div
        style={{
          fontSize: 12,
          color: "var(--text-1)",
          padding: "4px 6px",
          background: "var(--surface-2)",
          borderRadius: 6,
        }}
      >
        <strong>PAI:</strong> {describePAI(pai)}
        {props.entry.manualPaiScore != null
          ? " (manual)"
          : props.entry.detectedPaiScore != null
            ? " (IA)"
            : ""}
      </div>
      {props.entry.caption ? (
        <small style={{ color: "var(--text-2)", fontSize: 11 }}>{props.entry.caption}</small>
      ) : null}
    </figure>
  );
}
