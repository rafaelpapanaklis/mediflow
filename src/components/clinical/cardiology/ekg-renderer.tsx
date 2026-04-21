"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";

interface EkgProps {
  rhythm: "sinus" | "afib" | "flutter" | "vtach" | "paced" | "normal";
  rate: number;
  intervals?: { pr?: number; qrs?: number; qt?: number };
  leads?: "II" | "12";
  height?: number;
}

const TRACE_COLOR = "#34d399";
const GRID_MINOR = "rgba(239,68,68,0.15)";
const GRID_MAJOR = "rgba(239,68,68,0.25)";
const PX_PER_MM = 5;
const PX_PER_SECOND = 25 * PX_PER_MM;

type Point = [number, number];

function beatPath(
  xStart: number,
  baseline: number,
  rhythm: EkgProps["rhythm"],
  beatSpacingPx: number
): { points: Point[]; spikeX?: number } {
  const points: Point[] = [];
  let spikeX: number | undefined;

  if (rhythm === "normal" || rhythm === "sinus") {
    points.push([xStart, baseline]);
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = xStart + t * 20;
      const y = baseline - 6 * Math.sin(t * Math.PI);
      points.push([x, y]);
    }
    points.push([xStart + 25, baseline]);
    points.push([xStart + 30, baseline + 4]);
    points.push([xStart + 33, baseline - 55]);
    points.push([xStart + 36, baseline + 10]);
    points.push([xStart + 40, baseline]);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const x = xStart + 55 + t * 30;
      const y = baseline - 14 * Math.sin(t * Math.PI);
      points.push([x, y]);
    }
    points.push([xStart + beatSpacingPx, baseline]);
  } else if (rhythm === "afib") {
    const undulate = 8;
    for (let x = xStart; x < xStart + 28; x += 2) {
      const y = baseline + Math.sin(x * 0.5) * 2 + (Math.random() - 0.5) * 2;
      points.push([x, y]);
    }
    points.push([xStart + 30, baseline + 4]);
    points.push([xStart + 33, baseline - 50]);
    points.push([xStart + 36, baseline + 12]);
    points.push([xStart + 40, baseline]);
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = xStart + 50 + t * 25;
      const y = baseline - 12 * Math.sin(t * Math.PI);
      points.push([x, y]);
    }
    for (let x = xStart + 75; x < xStart + beatSpacingPx; x += 2) {
      const y = baseline + Math.sin(x * 0.5) * 2 + (Math.random() - 0.5) * 2;
      points.push([x, y]);
    }
    void undulate;
  } else if (rhythm === "flutter") {
    for (let x = xStart; x < xStart + 28; x += 4) {
      points.push([x, baseline - 6]);
      points.push([x + 2, baseline + 6]);
    }
    points.push([xStart + 30, baseline + 4]);
    points.push([xStart + 33, baseline - 48]);
    points.push([xStart + 36, baseline + 10]);
    points.push([xStart + 40, baseline]);
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = xStart + 50 + t * 25;
      const y = baseline - 10 * Math.sin(t * Math.PI);
      points.push([x, y]);
    }
    for (let x = xStart + 75; x < xStart + beatSpacingPx; x += 4) {
      points.push([x, baseline - 6]);
      points.push([x + 2, baseline + 6]);
    }
  } else if (rhythm === "vtach") {
    points.push([xStart, baseline]);
    points.push([xStart + 5, baseline + 8]);
    points.push([xStart + 12, baseline - 55]);
    points.push([xStart + 20, baseline + 40]);
    points.push([xStart + 28, baseline - 20]);
    points.push([xStart + 40, baseline]);
    points.push([xStart + beatSpacingPx, baseline]);
  } else if (rhythm === "paced") {
    spikeX = xStart + 25;
    points.push([xStart, baseline]);
    points.push([xStart + 25, baseline]);
    points.push([xStart + 26, baseline]);
    points.push([xStart + 30, baseline + 4]);
    points.push([xStart + 33, baseline - 55]);
    points.push([xStart + 36, baseline + 10]);
    points.push([xStart + 40, baseline]);
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = xStart + 55 + t * 28;
      const y = baseline - 13 * Math.sin(t * Math.PI);
      points.push([x, y]);
    }
    points.push([xStart + beatSpacingPx, baseline]);
  }

  return { points, spikeX };
}

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
  }
  return d;
}

export function EkgRenderer({
  rhythm,
  rate,
  intervals,
  leads = "II",
  height = 180,
}: EkgProps) {
  const width = 760;
  const clampedRate = Math.max(40, Math.min(200, rate));

  const { tracePath, spikes, baseline } = useMemo(() => {
    const baseline = height / 2;
    const beatSpacingPx = (60 / clampedRate) * PX_PER_SECOND;
    const numBeats = Math.floor(width / beatSpacingPx) + 1;
    const allPoints: Point[] = [];
    const spikes: number[] = [];

    for (let i = 0; i < numBeats; i++) {
      let effectiveSpacing = beatSpacingPx;
      if (rhythm === "afib") {
        effectiveSpacing = beatSpacingPx * (0.7 + Math.random() * 0.6);
      }
      const xStart = i * beatSpacingPx;
      const { points, spikeX } = beatPath(xStart, baseline, rhythm, effectiveSpacing);
      allPoints.push(...points);
      if (spikeX !== undefined) spikes.push(spikeX);
    }
    return { tracePath: pointsToPath(allPoints), spikes, baseline };
  }, [rhythm, clampedRate, height]);

  const rhythmLabel: Record<EkgProps["rhythm"], string> = {
    sinus: "Ritmo sinusal",
    normal: "Normal",
    afib: "Fibrilación auricular",
    flutter: "Flutter auricular",
    vtach: "Taquicardia ventricular",
    paced: "Ritmo con marcapasos",
  };

  const gridLinesMinor: number[] = [];
  for (let x = 0; x <= width; x += 25) gridLinesMinor.push(x);
  const gridLinesMinorY: number[] = [];
  for (let y = 0; y <= height; y += 25) gridLinesMinorY.push(y);
  const gridLinesMajor: number[] = [];
  for (let x = 0; x <= width; x += 125) gridLinesMajor.push(x);
  const gridLinesMajorY: number[] = [];
  for (let y = 0; y <= height; y += 125) gridLinesMajorY.push(y);

  return (
    <div
      className="card"
      style={{
        background: "rgba(0,0,0,0.3)",
        overflow: "hidden",
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Activity size={18} color={TRACE_COLOR} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
              {clampedRate} bpm
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              {rhythmLabel[rhythm]} · Derivación {leads === "II" ? "II" : "12 derivaciones"}
            </div>
          </div>
        </div>
        {intervals && (
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-2)" }}>
            {intervals.pr !== undefined && (
              <div>
                <span style={{ color: "var(--text-2)" }}>PR</span>{" "}
                <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{intervals.pr} ms</span>
              </div>
            )}
            {intervals.qrs !== undefined && (
              <div>
                <span style={{ color: "var(--text-2)" }}>QRS</span>{" "}
                <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{intervals.qrs} ms</span>
              </div>
            )}
            {intervals.qt !== undefined && (
              <div>
                <span style={{ color: "var(--text-2)" }}>QT</span>{" "}
                <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{intervals.qt} ms</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ overflow: "hidden", borderRadius: 8 }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          style={{ display: "block" }}
        >
          <rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0.4)" />
          {gridLinesMinor.map((x) => (
            <line key={`vx-${x}`} x1={x} y1={0} x2={x} y2={height} stroke={GRID_MINOR} strokeWidth={0.5} />
          ))}
          {gridLinesMinorY.map((y) => (
            <line key={`hy-${y}`} x1={0} y1={y} x2={width} y2={y} stroke={GRID_MINOR} strokeWidth={0.5} />
          ))}
          {gridLinesMajor.map((x) => (
            <line key={`vxM-${x}`} x1={x} y1={0} x2={x} y2={height} stroke={GRID_MAJOR} strokeWidth={1} />
          ))}
          {gridLinesMajorY.map((y) => (
            <line key={`hyM-${y}`} x1={0} y1={y} x2={width} y2={y} stroke={GRID_MAJOR} strokeWidth={1} />
          ))}

          {spikes.map((sx, i) => (
            <line
              key={`spike-${i}`}
              x1={sx}
              y1={baseline - 70}
              x2={sx}
              y2={baseline + 20}
              stroke="#fbbf24"
              strokeWidth={1}
            />
          ))}

          <path
            d={tracePath}
            stroke={TRACE_COLOR}
            strokeWidth={1.5}
            fill="none"
            style={{ filter: `drop-shadow(0 0 4px ${TRACE_COLOR})` }}
          />
        </svg>
      </div>
    </div>
  );
}
