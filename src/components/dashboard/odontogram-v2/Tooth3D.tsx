"use client";

import type { Tooth3DProps } from "./types";

/**
 * Tooth3D — procedural Three.js tooth with 5 clickable face patches.
 * STUB: placeholder mount. WS3-T3/T4 fill the real imperative Three.js scene
 * (buildTooth, face patches, drag-rotate, raycast, render-on-demand st.draw())
 * per design jsx/tooth3d.jsx. The `.odo-3d-mount` element fills its stage.
 */
export function Tooth3D({ meta }: Tooth3DProps) {
  return (
    <div
      className="odo-3d-mount"
      style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 12, fontWeight: 600 }}
      data-odo-stub="tooth-3d"
    >
      Vista 3D · {meta.fdi}
    </div>
  );
}
