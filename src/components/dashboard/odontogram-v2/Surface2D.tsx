"use client";

import type { Surface2DProps } from "./types";

/**
 * Surface2D — the classic 5-zone clickable circle.
 * STUB: minimal placeholder that still emits onSurface. WS3-T3/T4 fill the
 * real renderer (annular zones, condition fills, ring/hatch/missing/badges)
 * per design jsx/surface2d.jsx.
 */
export function Surface2D({ meta, record, onSurface, dimmed, size = 64 }: Surface2DProps) {
  const surfaceCount = Object.keys(record.surfaces || {}).length;
  const toothCount = (record.tooth || []).length;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ overflow: "visible", opacity: dimmed ? 0.4 : 1, cursor: "pointer" }}
      data-odo-stub="surface2d"
      data-fdi={meta.fdi}
      onClick={(e) => { e.stopPropagation(); onSurface(meta.center); }}
    >
      <circle cx={50} cy={50} r={46} fill="#fff" stroke="#cfd6e0" strokeWidth={2} />
      <circle
        cx={50}
        cy={50}
        r={20}
        fill={surfaceCount ? "#dbe6f7" : "transparent"}
        stroke={toothCount ? "var(--accent)" : "#cfd6e0"}
        strokeWidth={1.4}
      />
    </svg>
  );
}
