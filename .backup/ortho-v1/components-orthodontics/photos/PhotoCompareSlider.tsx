"use client";
// Orthodontics — comparativo lado a lado T0/T2 con slider sincronizado. SPEC §6.7.

import { useState } from "react";
import type { PhotoComparePair } from "@/lib/types/orthodontics";
import { VIEW_LABELS, type OrthoPhotoView } from "@/lib/orthodontics/photo-set-helpers";

export interface PhotoCompareSliderProps {
  pairs: PhotoComparePair[];
  beforeLabel: string;
  afterLabel: string;
  onClose?: () => void;
}

export function PhotoCompareSlider(props: PhotoCompareSliderProps) {
  const initialView = props.pairs.find((p) => p.beforeUrl && p.afterUrl)?.view ?? props.pairs[0]?.view ?? "EXTRA_FRONTAL";
  const [view, setView] = useState<OrthoPhotoView>(initialView as OrthoPhotoView);
  const [splitPct, setSplitPct] = useState(50);

  const pair = props.pairs.find((p) => p.view === view);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <select
          value={view}
          onChange={(e) => setView(e.target.value as OrthoPhotoView)}
          style={{
            padding: "6px 10px",
            background: "var(--bg)",
            color: "var(--text-1)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {props.pairs.map((p) => (
            <option key={p.view} value={p.view}>
              {VIEW_LABELS[p.view]}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          {props.beforeLabel} ↔ {props.afterLabel}
        </span>
        {props.onClose ? (
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Cerrar
          </button>
        ) : null}
      </header>

      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 10",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {pair?.beforeUrl ? (
          <img
            src={pair.beforeUrl}
            alt={`${props.beforeLabel} ${VIEW_LABELS[view]}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <Empty label={props.beforeLabel} />
        )}
        {pair?.afterUrl ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              clipPath: `inset(0 0 0 ${splitPct}%)`,
            }}
          >
            <img
              src={pair.afterUrl}
              alt={`${props.afterLabel} ${VIEW_LABELS[view]}`}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </div>
        ) : null}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${splitPct}%`,
            width: 2,
            background: "white",
            boxShadow: "0 0 8px rgba(0,0,0,0.6)",
          }}
        />
      </div>

      <div>
        <input
          type="range"
          min={0}
          max={100}
          value={splitPct}
          onChange={(e) => setSplitPct(Number(e.target.value))}
          aria-label="Posición del slider comparativo"
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-3)",
        fontSize: 12,
      }}
    >
      Sin foto {label}
    </div>
  );
}
