"use client";

import type { CSSProperties } from "react";
import type {
  Surface2DProps, ToothMeta, ToothRecord, SurfaceLetter, Condition,
} from "./types";
import { COND_BY_ID, GROUP_COLOR } from "./data";

/* ---------- geometry helpers (ported 1:1 from design jsx/surface2d.jsx) ---------- */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function annular(cx: number, cy: number, ri: number, ro: number, a0: number, a1: number): string {
  const [x0o, y0o] = polar(cx, cy, ro, a0);
  const [x1o, y1o] = polar(cx, cy, ro, a1);
  const [x1i, y1i] = polar(cx, cy, ri, a1);
  const [x0i, y0i] = polar(cx, cy, ri, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0o} ${y0o} A${ro} ${ro} 0 ${large} 1 ${x1o} ${y1o} L${x1i} ${y1i} A${ri} ${ri} 0 ${large} 0 ${x0i} ${y0i} Z`;
}

/* zone position -> surface letter, given tooth meta */
function zoneSurface(pos: string, meta: ToothMeta): SurfaceLetter {
  if (pos === "center") return meta.center; // O or I
  if (pos === "top") return meta.upper ? "V" : "L";
  if (pos === "bottom") return meta.upper ? "L" : "V";
  // sides: mesial faces midline. chart-left half (right teeth) -> mesial on right
  if (pos === "right") return meta.right ? "M" : "D";
  if (pos === "left") return meta.right ? "D" : "M";
  return meta.center;
}

const ZONES: { pos: string; a0: number; a1: number }[] = [
  { pos: "right", a0: -45, a1: 45 },
  { pos: "bottom", a0: 45, a1: 135 },
  { pos: "left", a0: 135, a1: 225 },
  { pos: "top", a0: 225, a1: 315 },
];

interface ZoneStyle {
  fill: string;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
}

/* =========================================================
   Surface2D — the 5-zone clickable circle
   props: meta, record, onSurface(letter), onTooth(), dimmed, size
   ========================================================= */
export function Surface2D({ meta, record, onSurface, dimmed, size = 64 }: Surface2DProps) {
  const cx = 50, cy = 50, ri = 20, ro = 46;
  const surfaces = record.surfaces || {};

  // resolve the visible condition for a surface letter (top = last of the array)
  function topCond(letter: string): Condition | null {
    const arr = surfaces[letter];
    if (!arr || !arr.length) return null;
    return COND_BY_ID[arr[arr.length - 1]] || null;
  }
  function zoneFill(letter: string): ZoneStyle {
    const c = topCond(letter);
    if (!c) return { fill: "transparent" };
    const color = GROUP_COLOR[c.group];
    if (c.render === "fill") return { fill: color, opacity: 0.9 };
    if (c.render === "outline") return { fill: "transparent", stroke: color, strokeWidth: 3 };
    if (c.render === "stipple") return { fill: `url(#stipple-${c.group})` };
    if (c.render === "dots") return { fill: `url(#dots-${c.group})` };
    return { fill: color, opacity: 0.9 };
  }

  // whole-tooth renders that paint the circle (missing/hatch echo here; ring/crown
  // echoed as a colored stroke around the circle; glyph layer draws the rest)
  const toothConds = (record.tooth || []).map((id) => COND_BY_ID[id]).filter(Boolean);
  const ringCond = toothConds.find((c) => c.render === "ring");
  const hatchTooth = toothConds.find((c) => c.render === "hatch");
  const missing = toothConds.find((c) => c.render === "missing");

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ overflow: "visible", opacity: dimmed ? 0.4 : 1 }}>
      {/* base circle */}
      <circle cx={cx} cy={cy} r={ro} fill="#fff" stroke="#cfd6e0" strokeWidth="2" />
      {missing && <circle cx={cx} cy={cy} r={ro} fill="#6b7280" opacity="0.85" />}
      {hatchTooth && <circle cx={cx} cy={cy} r={ro} fill="url(#hatch-gray)" />}

      {/* outer 4 zones */}
      {ZONES.map((z) => {
        const letter = zoneSurface(z.pos, meta);
        const st = zoneFill(letter);
        return (
          <path
            key={z.pos}
            d={annular(cx, cy, ri, ro, z.a0, z.a1)}
            fill={st.fill}
            stroke={st.stroke || "#cfd6e0"}
            strokeWidth={st.strokeWidth || 1.2}
            opacity={st.opacity}
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); onSurface(letter); }}
          />
        );
      })}

      {/* center */}
      {(() => {
        const letter = meta.center;
        const st = zoneFill(letter);
        return (
          <circle
            cx={cx} cy={cy} r={ri}
            fill={st.fill}
            stroke={st.stroke || "#cfd6e0"}
            strokeWidth={st.strokeWidth || 1.4}
            opacity={st.opacity}
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); onSurface(letter); }}
          />
        );
      })()}

      {/* ring (crown / band / steel crown) */}
      {ringCond && (
        <circle cx={cx} cy={cy} r={ro - 1} fill="none"
          stroke={ringCond.steel ? "#64748b" : GROUP_COLOR[ringCond.group]}
          strokeWidth="3.5" strokeDasharray={ringCond.band ? "5 4" : ""} />
      )}

      {/* badges / icons for tooth-level point findings */}
      <ToothBadges meta={meta} record={record} />
    </svg>
  );
}

/* small badges drawn on top of the circle (pulpitis P, mobility, rotate, etc.) */
function ToothBadges({ meta, record }: { meta: ToothMeta; record: ToothRecord }) {
  const conds = (record.tooth || []).map((id) => COND_BY_ID[id]).filter(Boolean);
  const badge = conds.find((c) => c.render === "badge");
  const roman = conds.find((c) => c.render === "roman");
  const icon = conds.find((c) => c.render === "icon");
  const cross = conds.find((c) => c.render === "cross");
  const out: JSX.Element[] = [];
  if (badge) {
    out.push(
      <g key="b">
        <circle cx="50" cy="50" r="13" fill="#fff" stroke={GROUP_COLOR[badge.group]} strokeWidth="2.5" />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="16" fontWeight="800" fill={GROUP_COLOR[badge.group]}>{badge.letter}</text>
      </g>
    );
  }
  if (cross) {
    const col = GROUP_COLOR[cross.group];
    out.push(
      <g key="x" stroke={col} strokeWidth="4" strokeLinecap="round" opacity={cross.soft ? 0.7 : 1}>
        <line x1="20" y1="20" x2="80" y2="80" strokeDasharray={cross.soft ? "6 5" : ""} />
        <line x1="80" y1="20" x2="20" y2="80" strokeDasharray={cross.soft ? "6 5" : ""} />
      </g>
    );
  }
  if (roman) {
    const r = ["", "I", "II", "III"][roman.degree ?? 0] || "I";
    out.push(
      <g key="r" transform="translate(74,26)">
        <circle r="13" fill={GROUP_COLOR[roman.group]} />
        <text textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="800" fill="#fff">{r}</text>
      </g>
    );
  }
  if (icon) {
    out.push(<g key="i" transform="translate(50,50)">{glyphIcon(icon.icon || "", GROUP_COLOR[icon.group])}</g>);
  }
  return <>{out}</>;
}

/* tiny vector icons used as badges */
function glyphIcon(name: string, color: string): JSX.Element | null {
  const s: CSSProperties = { fill: "none", stroke: color, strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "rotate":
      return <g style={s}><path d="M-14 -4 a14 14 0 1 1 4 12" /><path d="M-14 -12 v8 h8" /></g>;
    case "displace":
      return <g style={s}><line x1="-16" y1="0" x2="16" y2="0" /><path d="M10 -6 l6 6 -6 6" /><path d="M-10 -6 l-6 6 6 6" /></g>;
    case "drop":
      return <g><path d="M0 -16 C 10 -2, 12 4, 0 14 C -12 4, -10 -2, 0 -16 Z" fill={color} opacity="0.85" /></g>;
    case "sparkle":
      return <g stroke={color} strokeWidth="3.5" strokeLinecap="round"><line x1="0" y1="-14" x2="0" y2="14" /><line x1="-14" y1="0" x2="14" y2="0" /><line x1="-9" y1="-9" x2="9" y2="9" /><line x1="9" y1="-9" x2="-9" y2="9" /></g>;
    case "probe":
      return <g style={s}><line x1="0" y1="-15" x2="0" y2="13" /><line x1="-7" y1="13" x2="7" y2="13" /><line x1="-5" y1="-15" x2="5" y2="-15" /></g>;
    case "furca":
      return <g style={s}><path d="M0 -14 V2" /><path d="M0 2 L-12 14" /><path d="M0 2 L12 14" /></g>;
    case "diastema":
      return <g style={s}><line x1="-12" y1="-12" x2="-12" y2="12" /><line x1="12" y1="-12" x2="12" y2="12" /><path d="M-5 0 h10" /><path d="M2 -4 l4 4 -4 4" /><path d="M-2 -4 l-4 4 4 4" /></g>;
    case "maintainer":
      return <g style={s}><circle cx="-9" cy="0" r="5" /><circle cx="9" cy="0" r="5" /><line x1="-4" y1="0" x2="4" y2="0" /></g>;
    default:
      return null;
  }
}
