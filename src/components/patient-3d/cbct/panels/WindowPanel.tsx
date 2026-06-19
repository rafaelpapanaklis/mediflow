"use client";

// Panel de ventana de densidad (HU): presets (Hueso/Esmalte/Tejido/Vía aérea)
// que fijan brillo+contraste, más ajuste fino con dos sliders. Escribe en `setHu`
// (forma updater). Ajustar un slider marca el preset como "custom" (ninguno
// resaltado). Estilo en cbct.css.

import type { ReactNode } from "react";
import type { WindowPanelProps } from "../types";
import { HU_PRESETS } from "../constants";
import { IcSun, IcContrast } from "../icons";
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

export function WindowPanel({ hu, setHu }: WindowPanelProps) {
  return (
    <div className="vc-section">
      <div className="vc-sec-title">
        Ventana de densidad <span className="vc-hu">HU</span>
      </div>
      <div className="vc-preset-grid">
        {HU_PRESETS.map((p) => {
          const Ic = p.Icon;
          const on = hu.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              className={"vc-preset" + (on ? " on" : "")}
              onClick={() => setHu({ preset: p.id, brillo: p.brillo, contraste: p.contraste })}
            >
              <span className="vc-preset-ic">
                <Ic />
              </span>
              <span className="vc-preset-tx">
                <b>{p.label}</b>
                <small>{p.sub}</small>
              </span>
            </button>
          );
        })}
      </div>
      <Slider
        icon={<IcSun />}
        label="Brillo"
        value={hu.brillo}
        onChange={(v) => setHu((prev) => ({ ...prev, preset: "custom", brillo: v }))}
      />
      <Slider
        icon={<IcContrast />}
        label="Contraste"
        value={hu.contraste}
        onChange={(v) => setHu((prev) => ({ ...prev, preset: "custom", contraste: v }))}
      />
    </div>
  );
}

export default WindowPanel;
