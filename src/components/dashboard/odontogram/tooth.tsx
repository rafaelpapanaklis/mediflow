"use client";

import { useMemo } from "react";
import {
  buildToothSurfaces,
  isMesialOnRight,
  notationLabel,
  STATE_COLOR,
  type Notation,
  type SurfaceKey,
  type ToothState,
} from "./odontogram-data";
import styles from "./odontogram.module.css";

interface ToothProps {
  fdi: number;
  notation: Notation;
  /** State per surface. */
  surfaces: Partial<Record<SurfaceKey, ToothState>>;
  /** Estado a nivel diente completo (corona, ausente, etc). */
  fullToothState: ToothState | null;
  /** Si está en multi-select. */
  selected: boolean;
  /** Modo activo de la toolbar (para cursor crosshair). */
  activeMode: ToothState | null;
  onSurfaceClick: (surface: SurfaceKey, shiftKey: boolean) => void;
  onToothClick: (shiftKey: boolean) => void;
}

const SURFACE_KEYS: SurfaceKey[] = ["V", "L", "M", "D", "O"];

export function Tooth({
  fdi,
  notation,
  surfaces,
  fullToothState,
  selected,
  activeMode,
  onSurfaceClick,
  onToothClick,
}: ToothProps) {
  const mesialOnRight = isMesialOnRight(fdi);
  const geometry = useMemo(() => buildToothSurfaces(mesialOnRight), [mesialOnRight]);

  const isCorona = fullToothState === "CORONA";
  const isEndo = fullToothState === "ENDODONCIA";
  const isImplant = fullToothState === "IMPLANTE";
  const isAusente = fullToothState === "AUSENTE";
  const isExtract = fullToothState === "EXTRACCION";

  const cellClasses = [
    styles.tooth,
    selected ? styles.selected : "",
    isCorona ? styles.hasCorona : "",
    isEndo ? styles.hasEndo : "",
    isImplant ? styles.hasImplant : "",
    isAusente ? styles.hasAusente : "",
    isExtract ? styles.hasExtract : "",
    activeMode ? styles.hasActiveMode : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cellClasses}
      data-tooth={fdi}
      onClick={(e) => {
        // Click fuera de una superficie → selecciona el diente para multi.
        if ((e.target as HTMLElement).closest(`.${styles.surface}`)) return;
        onToothClick(e.shiftKey);
      }}
    >
      <div className={styles.toothNum}>{notationLabel(fdi, notation)}</div>
      <svg viewBox="0 0 60 60" className={styles.toothSvg} xmlns="http://www.w3.org/2000/svg">
        <rect className={styles.toothBase} x="2" y="2" width="56" height="56" rx="6" pointerEvents="none" />
        {SURFACE_KEYS.map((surf) => {
          const g = geometry[surf];
          const state = surfaces[surf] ?? "SANO";
          const fillColor = state !== "SANO" ? STATE_COLOR[state] : undefined;
          const commonProps = {
            className: `${styles.surface} ${state !== "SANO" ? styles.surfaceActive : ""}`,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              onSurfaceClick(surf, e.shiftKey);
            },
            style: fillColor ? ({ fill: fillColor } as React.CSSProperties) : undefined,
            "data-surface": surf,
          };
          if (g.rect) {
            return (
              <rect
                key={surf}
                {...commonProps}
                x={g.rect.x}
                y={g.rect.y}
                width={g.rect.w}
                height={g.rect.h}
                rx={g.rect.rx}
              />
            );
          }
          return <path key={surf} {...commonProps} d={g.d!} />;
        })}
        {SURFACE_KEYS.map((surf) => {
          const g = geometry[surf];
          const state = surfaces[surf] ?? "SANO";
          const isActive = state !== "SANO";
          return (
            <text
              key={`l-${surf}`}
              className={`${styles.letter} ${isActive ? styles.letterOnActive : ""}`}
              x={g.labelX}
              y={g.labelY}
              textAnchor="middle"
              dominantBaseline="central"
              pointerEvents="none"
            >
              {surf}
            </text>
          );
        })}
        {/* Overlays de estados full-tooth */}
        {isCorona && (
          <rect
            className={styles.ovCrown}
            x="3" y="3" width="54" height="54" rx="6"
            pointerEvents="none"
          />
        )}
        {isEndo && (
          <line className={styles.ovEndo} x1="30" y1="6" x2="30" y2="54" pointerEvents="none" />
        )}
        {(isAusente || isExtract) && (
          <>
            <line className={isAusente ? styles.ovAusenteX : styles.ovExtract} x1="6" y1="6" x2="54" y2="54" pointerEvents="none" />
            <line className={isAusente ? styles.ovAusenteX : styles.ovExtract} x1="54" y1="6" x2="6" y2="54" pointerEvents="none" />
          </>
        )}
        {isImplant && (
          <g pointerEvents="none">
            <rect x="22" y="22" width="16" height="16" rx="2" fill={STATE_COLOR.IMPLANTE} />
            <line x1="22" y1="27" x2="38" y2="27" stroke="#fff" strokeWidth="0.6" />
            <line x1="22" y1="32" x2="38" y2="32" stroke="#fff" strokeWidth="0.6" />
            <line x1="22" y1="37" x2="38" y2="37" stroke="#fff" strokeWidth="0.6" />
          </g>
        )}
      </svg>
    </div>
  );
}
