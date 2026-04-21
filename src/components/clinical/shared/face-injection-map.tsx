"use client";

interface Injection {
  x: number;
  y: number;
  units: number;
  product?: string;
}

interface FaceInjectionMapProps {
  injections: Injection[];
  product?: string;
  totalUnits?: number;
  onAdd?: (x: number, y: number) => void;
  editable?: boolean;
}

export function FaceInjectionMap({
  injections,
  product,
  totalUnits,
  onAdd,
  editable,
}: FaceInjectionMapProps) {
  const total =
    totalUnits ?? injections.reduce((acc, inj) => acc + inj.units, 0);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!editable || !onAdd) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    onAdd(px, py);
  }

  const stroke = "#a78bfa66";
  const fill = "#a78bfa14";

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
          }}
        >
          {product || "Aplicación"}
        </div>
        <div
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          {total} U
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg
          viewBox="0 0 200 260"
          width={200}
          height={260}
          onClick={handleClick}
          style={{ cursor: editable ? "crosshair" : "default" }}
        >
          <g fill={fill} stroke={stroke} strokeWidth={1}>
            <ellipse cx={100} cy={130} rx={70} ry={105} />
            <ellipse cx={75} cy={115} rx={8} ry={4} fill={stroke} />
            <ellipse cx={125} cy={115} rx={8} ry={4} fill={stroke} />
            <path d="M100 130 L94 165 L106 165 Z" fill="none" stroke={stroke} />
            <path d="M82 195 Q100 206 118 195" fill="none" stroke={stroke} strokeWidth={1.5} />
          </g>

          {injections.map((inj, i) => {
            const cx = (inj.x / 100) * 200;
            const cy = (inj.y / 100) * 260;
            return (
              <g key={i}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={10}
                  stroke="#a78bfa66"
                  strokeWidth={1}
                  fill="none"
                />
                <circle cx={cx} cy={cy} r={5} fill="#a78bfa" />
                <text
                  x={cx + 14}
                  y={cy + 4}
                  fontSize={9}
                  fontFamily="ui-monospace, monospace"
                  fill="var(--text-2)"
                >
                  {inj.units}U
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          color: "var(--text-2)",
          textAlign: "center",
        }}
      >
        {injections.length} puntos · {total} U totales
      </div>
    </div>
  );
}
