"use client";

import { useState } from "react";

interface Marker {
  x: number;
  y: number;
  color: string;
  label?: string;
  size?: number;
}

interface BodyMapProps {
  view: "front" | "back" | "face";
  markers: Marker[];
  onMarkerClick?: (index: number) => void;
  onBodyClick?: (x: number, y: number) => void;
  editable?: boolean;
  legend?: { color: string; label: string }[];
  color?: string;
}

function FrontSilhouette({ color }: { color: string }) {
  const fill = `${color}14`;
  const stroke = `${color}66`;
  return (
    <g fill={fill} stroke={stroke} strokeWidth={1}>
      {/* Cabeza */}
      <ellipse cx={100} cy={40} rx={18} ry={22} />
      {/* Cuello */}
      <rect x={92} y={58} width={16} height={10} rx={3} />
      {/* Torso */}
      <path d="M70 70 Q70 68 72 68 L128 68 Q130 68 130 70 L132 150 Q132 170 125 185 L75 185 Q68 170 68 150 Z" />
      {/* Brazo izq */}
      <path d="M68 72 Q55 80 52 110 Q50 140 54 170 Q58 185 62 190 L70 188 Q66 170 64 140 Q64 110 72 85 Z" />
      {/* Brazo der */}
      <path d="M132 72 Q145 80 148 110 Q150 140 146 170 Q142 185 138 190 L130 188 Q134 170 136 140 Q136 110 128 85 Z" />
      {/* Pierna izq */}
      <path d="M75 185 L72 260 Q70 320 78 380 L92 382 Q94 340 94 280 Q96 220 98 185 Z" />
      {/* Pierna der */}
      <path d="M125 185 L128 260 Q130 320 122 380 L108 382 Q106 340 106 280 Q104 220 102 185 Z" />
    </g>
  );
}

function BackSilhouette({ color }: { color: string }) {
  const fill = `${color}14`;
  const stroke = `${color}66`;
  return (
    <g fill={fill} stroke={stroke} strokeWidth={1}>
      <ellipse cx={100} cy={40} rx={18} ry={22} />
      <rect x={92} y={58} width={16} height={10} rx={3} />
      <path d="M70 70 Q70 68 72 68 L128 68 Q130 68 130 70 L132 150 Q132 170 125 185 L75 185 Q68 170 68 150 Z" />
      <path d="M68 72 Q55 80 52 110 Q50 140 54 170 Q58 185 62 190 L70 188 Q66 170 64 140 Q64 110 72 85 Z" />
      <path d="M132 72 Q145 80 148 110 Q150 140 146 170 Q142 185 138 190 L130 188 Q134 170 136 140 Q136 110 128 85 Z" />
      <path d="M75 185 L72 260 Q70 320 78 380 L92 382 Q94 340 94 280 Q96 220 98 185 Z" />
      <path d="M125 185 L128 260 Q130 320 122 380 L108 382 Q106 340 106 280 Q104 220 102 185 Z" />
      {/* Línea columna */}
      <line x1={100} y1={72} x2={100} y2={180} stroke={stroke} strokeWidth={0.5} strokeDasharray="2 2" fill="none" />
    </g>
  );
}

function FaceSilhouette({ color }: { color: string }) {
  const fill = `${color}14`;
  const stroke = `${color}66`;
  return (
    <g fill={fill} stroke={stroke} strokeWidth={1}>
      <ellipse cx={100} cy={120} rx={70} ry={100} />
      {/* Ojos */}
      <ellipse cx={75} cy={110} rx={8} ry={4} fill={stroke} />
      <ellipse cx={125} cy={110} rx={8} ry={4} fill={stroke} />
      {/* Nariz */}
      <path d="M100 120 L94 150 L106 150 Z" fill="none" stroke={stroke} />
      {/* Boca */}
      <path d="M82 180 Q100 190 118 180" fill="none" stroke={stroke} strokeWidth={1.5} />
    </g>
  );
}

export function BodyMap({
  view,
  markers,
  onMarkerClick,
  onBodyClick,
  editable,
  legend,
  color = "#a78bfa",
}: BodyMapProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const viewBox = view === "face" ? "0 0 200 240" : "0 0 200 400";

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!editable || !onBodyClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    onBodyClick(px, py);
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg
          viewBox={viewBox}
          width={200}
          height={view === "face" ? 240 : 400}
          onClick={handleSvgClick}
          style={{ cursor: editable ? "crosshair" : "default" }}
        >
          {view === "front" && <FrontSilhouette color={color} />}
          {view === "back" && <BackSilhouette color={color} />}
          {view === "face" && <FaceSilhouette color={color} />}

          {markers.map((m, i) => {
            const cx = (m.x / 100) * 200;
            const cy = (m.y / 100) * (view === "face" ? 240 : 400);
            return (
              <g key={i}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={m.size || 6}
                  fill={m.color}
                  style={{ filter: `drop-shadow(0 0 6px ${m.color})`, cursor: onMarkerClick ? "pointer" : "default" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkerClick?.(i);
                  }}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                >
                  {m.label && <title>{m.label}</title>}
                </circle>
                {hoverIdx === i && m.label && (
                  <g>
                    <rect
                      x={cx + 10}
                      y={cy - 14}
                      width={m.label.length * 6 + 8}
                      height={18}
                      fill="var(--bg-elev)"
                      stroke="var(--border)"
                      rx={3}
                    />
                    <text
                      x={cx + 14}
                      y={cy - 2}
                      fontSize={10}
                      fill="var(--text-1)"
                      fontFamily="ui-monospace, monospace"
                    >
                      {m.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {legend && legend.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
            marginTop: 12,
          }}
        >
          {legend.map((l, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--text-2)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 8,
                  background: l.color,
                  boxShadow: `0 0 6px ${l.color}`,
                }}
              />
              {l.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
