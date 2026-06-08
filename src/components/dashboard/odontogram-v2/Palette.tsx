"use client";

import { useState } from "react";
import { GROUPS, CONDITIONS, GROUP_COLOR, I18N, classify } from "./data";
import type { PaletteProps, ConditionSwatchProps } from "./types";
import { Surface2D } from "./Surface2D";

/**
 * Palette — specialty tabs + finding chips + eraser. Wires onPick/onEraser.
 * WS3-T5/T6 refine the chip visuals; the swatch preview uses the Surface2D stub.
 */
export function Palette({ lang, brush, eraser, onPick, onEraser }: PaletteProps) {
  const t = I18N[lang];
  const [active, setActive] = useState<string>("diagnostic");
  const conds = CONDITIONS.filter((c) => c.group === active);
  const gc = GROUP_COLOR[active];

  return (
    <div className="odo-palette" data-odo-stub="palette">
      <div className="odo-pal-tabs">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            className={"odo-tab" + (active === g.id ? " on" : "")}
            style={active === g.id ? { color: g.color, borderColor: g.color } : {}}
            onClick={() => setActive(g.id)}
          >
            <span className="odo-tab-dot" style={{ background: g.color }} />
            {g[lang]}
          </button>
        ))}
      </div>
      <div className="odo-pal-items">
        <button className={"odo-chip eraser" + (eraser ? " on" : "")} onClick={onEraser}>
          <span className="odo-chip-ic">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 21h10" />
              <path d="M5 13l6-6 7 7-5 5H9z" />
            </svg>
          </span>
          <span className="odo-chip-lb">{t.eraser}</span>
        </button>
        {conds.map((c) => (
          <button
            key={c.id}
            className={"odo-chip" + (brush === c.id ? " on" : "")}
            style={brush === c.id ? { borderColor: gc, boxShadow: `0 0 0 2px ${gc}33` } : {}}
            onClick={() => onPick(c.id)}
          >
            <span className="odo-chip-ic"><ConditionSwatch cond={c} /></span>
            <span className="odo-chip-lb">{c[lang]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** ConditionSwatch — mini preview of how a finding renders (uses Surface2D stub). */
export function ConditionSwatch({ cond }: ConditionSwatchProps) {
  const meta = classify(16);
  const record =
    cond.target === "surface"
      ? { surfaces: { [meta.center]: [cond.id] }, tooth: [] as string[] }
      : { surfaces: {}, tooth: [cond.id] };
  return (
    <span style={{ display: "inline-flex" }}>
      <Surface2D meta={meta} record={record} size={30} onSurface={() => {}} />
    </span>
  );
}
