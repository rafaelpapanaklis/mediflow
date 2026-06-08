"use client";

import type { ToothGlyphProps } from "./types";

/**
 * ToothGlyph — schematic anatomical tooth (crown + roots) drawing.
 * STUB: minimal placeholder. WS3-T3/T4 fill the real crown/root paths and
 * endo/implant/apical/fracture/post overlays per design jsx/surface2d.jsx.
 * (Note: the upper arch is flipped vertically — transform kept here.)
 */
export function ToothGlyph({ meta, record, w = 44, h = 62 }: ToothGlyphProps) {
  const hasTooth = (record.tooth || []).length > 0;
  return (
    <svg
      viewBox="0 0 40 60"
      width={w}
      height={h}
      style={{ overflow: "visible", transform: meta.upper ? "scaleY(-1)" : "none" }}
      data-odo-stub="tooth-glyph"
    >
      <rect x={10} y={3} width={20} height={23} rx={5} fill={hasTooth ? "#eef2f8" : "#fff"} stroke="#b7c0cd" strokeWidth={1.6} />
      <line x1={20} y1={26} x2={20} y2={57} stroke="#b7c0cd" strokeWidth={1.5} />
    </svg>
  );
}
