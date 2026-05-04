"use client";
// Periodontics — columna vertical de un diente: 3 sitios vestibulares arriba
// (MV-MB-DV), ToothCenter, 3 sitios palatinos abajo (DL-ML-MB_PAL).
//
// Florida Probe convention: vestibular ARRIBA en ambas arcadas.
// TODO: validar con periodoncista real si prefiere arcada inferior espejada
// (lingual arriba en arcada inferior). Decisión actual: vestibular arriba
// en ambas arcadas (SPEC §1, §6.3).

import { memo } from "react";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import type { SitePos } from "@/lib/periodontics/site-helpers";
import { SiteCell } from "./SiteCell";
import { ToothCenter } from "./ToothCenter";

const VESTIBULAR_ORDER: SitePos[] = ["MV", "MB", "DV"];
const PALATAL_ORDER: SitePos[] = ["DL", "ML", "MB_PAL"];

export interface ToothColumnProps {
  fdi: number;
  tooth?: ToothLevel;
  sitesByPosition: Partial<Record<SitePos, Site>>;
  cursor?: { fdi: number; position: SitePos } | null;
  isUpperArcade: boolean;
  onSiteClick: (fdi: number, position: SitePos) => void;
  onToothClick: (fdi: number) => void;
}

function ToothColumnInner({
  fdi,
  tooth,
  sitesByPosition,
  cursor,
  isUpperArcade,
  onSiteClick,
  onToothClick,
}: ToothColumnProps) {
  return (
    <div
      data-perio-column
      data-fdi={fdi}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 38,
      }}
    >
      {VESTIBULAR_ORDER.map((pos) => (
        <SiteCell
          key={`v-${pos}`}
          fdi={fdi}
          position={pos}
          site={sitesByPosition[pos]}
          isActive={cursor?.fdi === fdi && cursor?.position === pos}
          onClick={onSiteClick}
        />
      ))}

      <ToothCenter
        fdi={fdi}
        tooth={tooth}
        isUpperArcade={isUpperArcade}
        onClick={onToothClick}
      />

      {PALATAL_ORDER.map((pos) => (
        <SiteCell
          key={`p-${pos}`}
          fdi={fdi}
          position={pos}
          site={sitesByPosition[pos]}
          isActive={cursor?.fdi === fdi && cursor?.position === pos}
          onClick={onSiteClick}
        />
      ))}
    </div>
  );
}

export const ToothColumn = memo(ToothColumnInner);
