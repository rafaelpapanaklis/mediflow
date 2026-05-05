"use client";
// Periodontics — celda atómica del periodontograma (un sitio: PD, REC, BoP,
// placa, supuración). SPEC §6.4 + §6.5.

import { memo } from "react";
import type { Site } from "@/lib/periodontics/schemas";
import { pdSeverity } from "@/lib/periodontics/periodontogram-math";
import type { SitePos } from "@/lib/periodontics/site-helpers";

export interface SiteCellProps {
  fdi: number;
  position: SitePos;
  site?: Site;
  isActive: boolean;
  onClick: (fdi: number, position: SitePos) => void;
}

/**
 * Una celda del periodontograma: muestra PD/REC compactos y dots de
 * marcadores (BoP/placa/supuración). Color por severidad PD.
 *
 * Layout: 28×52px aprox. Vertical para que el texto "5/2" entre cómodo.
 *
 * Sitio activo: borde brand. Sitio sin capturar: tono base.
 */
function SiteCellInner({ fdi, position, site, isActive, onClick }: SiteCellProps) {
  const sev = site ? pdSeverity(site.pdMm) : null;
  const bg =
    sev === "green"
      ? "var(--success-soft, rgba(34,197,94,0.12))"
      : sev === "yellow"
        ? "var(--warning-soft, rgba(234,179,8,0.15))"
        : sev === "red"
          ? "var(--danger-soft, rgba(239,68,68,0.18))"
          : "var(--bg-elev, #11151c)";
  const border = isActive
    ? "1px solid var(--brand, #6366f1)"
    : "1px solid var(--border, #1f2937)";

  return (
    <button
      type="button"
      data-perio-cell
      data-fdi={fdi}
      data-position={position}
      onClick={() => onClick(fdi, position)}
      className="perio-cell"
      style={{
        background: bg,
        border,
        color: "var(--text-1, #e5e7eb)",
        padding: "2px 0",
        minHeight: 38,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        fontSize: 10,
        cursor: "pointer",
        outline: "none",
      }}
      aria-label={`Diente ${fdi} sitio ${position}${
        site ? `: PD ${site.pdMm}mm REC ${site.recMm}mm` : " — sin captura"
      }`}
    >
      <span style={{ lineHeight: 1, fontWeight: 600 }}>
        {site ? `${site.pdMm}-${site.recMm}` : "·"}
      </span>
      <span style={{ display: "flex", gap: 2, height: 6 }}>
        {site?.bop ? (
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#EF4444",
            }}
          />
        ) : null}
        {site?.plaque ? (
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#3B82F6",
            }}
          />
        ) : null}
        {site?.suppuration ? (
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#F97316",
            }}
          />
        ) : null}
      </span>
    </button>
  );
}

export const SiteCell = memo(SiteCellInner);
