"use client";

import { useState } from "react";
import { Check } from "lucide-react";

interface AcupuncturePoint {
  id: string;
  name: string;
  x: number;
  y: number;
  meridian:
    | "LU"
    | "LI"
    | "ST"
    | "SP"
    | "HT"
    | "SI"
    | "BL"
    | "KI"
    | "PC"
    | "TE"
    | "GB"
    | "LV"
    | "CV"
    | "GV";
}

interface MeridianMapProps {
  usedPointIds?: string[];
  onPointToggle?: (id: string) => void;
  editable?: boolean;
  points?: AcupuncturePoint[];
}

const DEFAULT_POINTS: AcupuncturePoint[] = [
  { id: "GV20", name: "Baihui", x: 100, y: 20, meridian: "GV" },
  { id: "GV14", name: "Dazhui", x: 100, y: 66, meridian: "GV" },
  { id: "CV17", name: "Shanzhong", x: 100, y: 110, meridian: "CV" },
  { id: "CV12", name: "Zhongwan", x: 100, y: 140, meridian: "CV" },
  { id: "CV6", name: "Qihai", x: 100, y: 165, meridian: "CV" },
  { id: "LU1", name: "Zhongfu", x: 80, y: 92, meridian: "LU" },
  { id: "LI4", name: "Hegu", x: 60, y: 170, meridian: "LI" },
  { id: "LI11", name: "Quchi", x: 58, y: 128, meridian: "LI" },
  { id: "PC6", name: "Neiguan", x: 64, y: 155, meridian: "PC" },
  { id: "HT7", name: "Shenmen", x: 58, y: 175, meridian: "HT" },
  { id: "ST25", name: "Tianshu", x: 110, y: 160, meridian: "ST" },
  { id: "ST36", name: "Zusanli", x: 115, y: 290, meridian: "ST" },
  { id: "SP6", name: "Sanyinjiao", x: 90, y: 345, meridian: "SP" },
  { id: "SP9", name: "Yinlingquan", x: 92, y: 280, meridian: "SP" },
  { id: "BL40", name: "Weizhong", x: 110, y: 285, meridian: "BL" },
  { id: "BL60", name: "Kunlun", x: 115, y: 360, meridian: "BL" },
  { id: "KI3", name: "Taixi", x: 95, y: 360, meridian: "KI" },
  { id: "LV3", name: "Taichong", x: 110, y: 370, meridian: "LV" },
  { id: "GB20", name: "Fengchi", x: 88, y: 55, meridian: "GB" },
  { id: "GB34", name: "Yanglingquan", x: 120, y: 280, meridian: "GB" },
];

const MERIDIAN_PATHS: { meridian: AcupuncturePoint["meridian"]; d: string }[] = [
  { meridian: "GV", d: "M 100 18 L 100 180" },
  { meridian: "CV", d: "M 100 85 L 100 190" },
  { meridian: "ST", d: "M 110 80 L 115 290 L 115 380" },
  { meridian: "SP", d: "M 90 200 L 90 345 L 100 380" },
  { meridian: "BL", d: "M 110 280 L 115 370" },
  { meridian: "GB", d: "M 88 55 L 120 280" },
  { meridian: "LI", d: "M 58 128 L 60 170" },
  { meridian: "LV", d: "M 110 370 L 112 385" },
];

export function MeridianMap({
  usedPointIds = [],
  onPointToggle,
  editable,
  points = DEFAULT_POINTS,
}: MeridianMapProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const usedSet = new Set(usedPointIds);

  const stroke = "#fbbf2466";
  const fill = "#fbbf241a";

  return (
    <div className="card" style={{ padding: 16 }}>
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
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
            Mapa de meridianos
          </div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
            {usedPointIds.length} / {points.length} puntos activados
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg viewBox="0 0 200 400" width={220} height={440}>
          <g fill={fill} stroke={stroke} strokeWidth={1}>
            <ellipse cx={100} cy={40} rx={18} ry={22} />
            <rect x={92} y={58} width={16} height={10} rx={3} />
            <path d="M70 70 Q70 68 72 68 L128 68 Q130 68 130 70 L132 150 Q132 170 125 185 L75 185 Q68 170 68 150 Z" />
            <path d="M68 72 Q55 80 52 110 Q50 140 54 170 Q58 185 62 190 L70 188 Q66 170 64 140 Q64 110 72 85 Z" />
            <path d="M132 72 Q145 80 148 110 Q150 140 146 170 Q142 185 138 190 L130 188 Q134 170 136 140 Q136 110 128 85 Z" />
            <path d="M75 185 L72 260 Q70 320 78 380 L92 382 Q94 340 94 280 Q96 220 98 185 Z" />
            <path d="M125 185 L128 260 Q130 320 122 380 L108 382 Q106 340 106 280 Q104 220 102 185 Z" />
          </g>

          <g stroke="#fbbf24" strokeWidth={0.5} opacity={0.4} fill="none">
            {MERIDIAN_PATHS.map((m, i) => (
              <path key={`mp-${i}`} d={m.d} />
            ))}
          </g>

          {points.map((p) => {
            const used = usedSet.has(p.id);
            const isHover = hoverId === p.id;
            return (
              <g key={p.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  fill={used ? "#fbbf24" : "transparent"}
                  stroke="#fbbf24"
                  strokeWidth={1.4}
                  style={{
                    cursor: editable ? "pointer" : "default",
                    filter: used ? "drop-shadow(0 0 4px #fbbf24)" : "none",
                  }}
                  onClick={() => editable && onPointToggle?.(p.id)}
                  onMouseEnter={() => setHoverId(p.id)}
                  onMouseLeave={() => setHoverId(null)}
                >
                  <title>{`${p.id} · ${p.name}`}</title>
                </circle>
                {isHover && (
                  <g>
                    <rect
                      x={p.x + 8}
                      y={p.y - 12}
                      width={`${p.id.length + p.name.length + 3}`.length > 0 ? p.id.length * 6 + p.name.length * 5 + 16 : 60}
                      height={16}
                      fill="var(--bg-elev)"
                      stroke="var(--border)"
                      rx={3}
                    />
                    <text
                      x={p.x + 12}
                      y={p.y - 1}
                      fontSize={9}
                      fill="var(--text-1)"
                      fontFamily="ui-monospace, monospace"
                    >
                      {p.id} · {p.name}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 6,
        }}
      >
        {points.map((p) => {
          const used = usedSet.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => editable && onPointToggle?.(p.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                background: used ? "rgba(251,191,36,0.15)" : "transparent",
                border: `1px solid ${used ? "rgba(251,191,36,0.4)" : "var(--border)"}`,
                borderRadius: 6,
                cursor: editable ? "pointer" : "default",
                fontSize: 11,
                color: "var(--text-1)",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 10,
                  background: used ? "#fbbf24" : "transparent",
                  border: "1px solid #fbbf24",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {used && <Check size={7} color="#000" strokeWidth={3} />}
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{p.id}</span>
              <span style={{ color: "var(--text-2)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
