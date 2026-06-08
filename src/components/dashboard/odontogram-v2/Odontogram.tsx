"use client";

import { Fragment } from "react";
import type { CSSProperties } from "react";
import { classify, numberLabel, PERM, PRIMARY, MIXED, I18N, COND_BY_ID } from "./data";
import type { OdontogramProps, ToothCellProps, PalmerLabelProps } from "./types";
import { Surface2D } from "./Surface2D";
import { ToothGlyph } from "./ToothGlyph";

/** Bracket hugging the corner toward midline+occlusal. */
const PALMER_BRACKET: Record<string, CSSProperties> = {
  ur: { borderRight: "2px solid", borderBottom: "2px solid" },
  ul: { borderLeft: "2px solid", borderBottom: "2px solid" },
  lr: { borderRight: "2px solid", borderTop: "2px solid" },
  ll: { borderLeft: "2px solid", borderTop: "2px solid" },
};

export function PalmerLabel({ quad, label }: PalmerLabelProps) {
  return (
    <span className="palmer" style={{ padding: "1px 4px", borderColor: "#9aa3af", ...(quad ? PALMER_BRACKET[quad] : {}) }}>
      {label}
    </span>
  );
}

/**
 * ToothCell — one tooth (glyph + circle + label, ordered by arch).
 * Composes the (stub) Surface2D/ToothGlyph and wires the real click logic
 * (surface vs whole-tooth vs select). WS3-T5/T6 refine the visuals.
 */
export function ToothCell({ fdi, numbering, record, brush, eraser, selected, onApply, onSelect, compact }: ToothCellProps) {
  const meta = classify(fdi);
  const num = numberLabel(fdi, numbering);
  const glyphW = compact ? 34 : 42;
  const glyphH = compact ? 48 : 58;
  const circle = compact ? 52 : 62;

  const surfaceClick = (letter: string) => {
    if (brush || eraser) onApply(fdi, "surface", letter);
    else onSelect(fdi);
  };
  const cellClick = () => {
    if (eraser) { onApply(fdi, "glyphErase"); return; }
    if (brush && COND_BY_ID[brush] && COND_BY_ID[brush].target === "tooth") { onApply(fdi, "tooth"); return; }
    onSelect(fdi);
  };

  const glyph = <ToothGlyph meta={meta} record={record} w={glyphW} h={glyphH} />;
  const circ = (
    <Surface2D meta={meta} record={record} size={circle} onSurface={surfaceClick} dimmed={(record.tooth || []).includes("missing")} />
  );
  const label = (
    <button className="odo-num" onClick={(e) => { e.stopPropagation(); onSelect(fdi); }}>
      {numbering === "palmer" ? <PalmerLabel quad={num.quad} label={num.label} /> : num.label}
    </button>
  );
  const order = meta.upper ? [glyph, circ, label] : [label, circ, glyph];

  return (
    <div className={"odo-cell" + (selected ? " sel" : "")} data-fdi={fdi} onClick={cellClick}>
      <div className="odo-cell-inner">
        <div className="odo-glyph-wrap">{order[0]}</div>
        <div className="odo-circle-wrap">{order[1]}</div>
        <div className="odo-label-wrap">{order[2]}</div>
      </div>
    </div>
  );
}

function Arch({ list, parent }: { list: number[]; parent: OdontogramProps }) {
  const mid = Math.floor(list.length / 2);
  return (
    <div className="odo-arch">
      <div className="odo-arch-row">
        {list.map((fdi, i) => (
          <Fragment key={fdi}>
            {i === mid && <div className="odo-midline" />}
            <ToothCell
              fdi={fdi}
              lang={parent.lang}
              numbering={parent.numbering}
              record={parent.records[fdi] || { surfaces: {}, tooth: [] }}
              brush={parent.brush}
              eraser={parent.eraser}
              selected={parent.selected === fdi}
              onApply={parent.onApply}
              onSelect={parent.onSelect}
              compact={parent.compact}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Odontogram — both arches with the midline. STUB-level visuals (composes the
 * stub cell) but full structure + interaction. WS3-T5/T6 fill the real chart.
 */
export function Odontogram(props: OdontogramProps) {
  const { dentition, lang } = props;
  const t = I18N[lang];
  const set = dentition === "primary" ? PRIMARY : dentition === "mixed" ? MIXED : PERM;
  return (
    <div className="odo-chart" data-odo-stub="odontogram">
      <div className="odo-arch-label top">{t.upperArch}</div>
      <Arch list={set.upper} parent={props} />
      <div className="odo-divider" />
      <Arch list={set.lower} parent={props} />
      <div className="odo-arch-label bottom">{t.lowerArch}</div>
    </div>
  );
}
