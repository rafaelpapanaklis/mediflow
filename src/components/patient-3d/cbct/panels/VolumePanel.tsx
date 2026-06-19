"use client";

// Panel de render de volumen: modo Sólido/MIP + umbral de hueso. Deshabilitado
// cuando !active (volumen no visible): la sección se atenúa (.dim → opacity +
// pointer-events:none) y los controles quedan inertes. Estilo en cbct.css.

import type { ReactNode } from "react";
import type { VolumePanelProps, VolState } from "../types";
import { IcLayers } from "../icons";
import { Seg } from "./Seg";
import "../cbct.css";

function Slider({
  icon,
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={"vc-slider" + (disabled ? " is-disabled" : "")}>
      <div className="vc-slider-head">
        <span className="vc-slider-lb">
          {icon}
          {label}
        </span>
        <span className="vc-slider-val">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function VolumePanel({ vol, setVol, active }: VolumePanelProps) {
  return (
    <div className={"vc-section" + (active ? "" : " dim")} aria-disabled={!active}>
      <div className="vc-sec-title">
        Render de volumen {!active && <span className="vc-hu">3D</span>}
      </div>
      <Seg
        small
        options={[
          { id: "solido", label: "Sólido" },
          { id: "mip", label: "MIP" },
        ]}
        value={vol.mode}
        onChange={(m) => active && setVol((prev) => ({ ...prev, mode: m as VolState["mode"] }))}
      />
      <div style={{ height: 10 }} />
      <Slider
        icon={<IcLayers />}
        label="Umbral de hueso"
        value={vol.umbral}
        disabled={!active}
        onChange={(v) => active && setVol((prev) => ({ ...prev, umbral: v }))}
      />
    </div>
  );
}

export default VolumePanel;
