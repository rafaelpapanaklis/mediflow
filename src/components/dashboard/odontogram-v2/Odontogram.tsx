"use client";

import { Fragment } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
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
 * Composes Surface2D/ToothGlyph and wires the click logic
 * (surface vs whole-tooth vs select). 1:1 with design jsx/odontogram.jsx.
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
  const glyphClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (eraser) onApply(fdi, "glyphErase");
    else if (brush && COND_BY_ID[brush] && COND_BY_ID[brush].target === "tooth") onApply(fdi, "tooth");
    else onSelect(fdi);
  };

  const glyph = <ToothGlyph meta={meta} record={record} w={glyphW} h={glyphH} />;
  const circ = (
    <Surface2D meta={meta} record={record} size={circle} onSurface={surfaceClick} dimmed={(record.tooth || []).includes("missing")} />
  );
  const label = (
    <button type="button" className="odo-num" data-screen-label={`tooth-${num.label}`} onClick={(e) => { e.stopPropagation(); onSelect(fdi); }}>
      {numbering === "palmer" ? <PalmerLabel quad={num.quad} label={num.label} /> : num.label}
    </button>
  );
  const order = meta.upper ? [glyph, circ, label] : [label, circ, glyph];

  return (
    <div className={"odo-cell" + (selected ? " sel" : "")} data-fdi={fdi} onClick={glyphClick}>
      <div className="odo-cell-inner">
        <div className="odo-glyph-wrap" onClick={glyphClick}>{order[0]}</div>
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
 * Odontogram — both arches with the midline. 1:1 port of design jsx/odontogram.jsx
 * (Odontogram + Arch + ToothCell). Composes Surface2D/ToothGlyph for the visuals.
 */
export function Odontogram(props: OdontogramProps) {
  const { dentition, lang } = props;
  const t = I18N[lang];
  const set = dentition === "primary" ? PRIMARY : dentition === "mixed" ? MIXED : PERM;
  return (
    <div className="odo-chart">
      <div className="odo-arch-label top">{t.upperArch}</div>
      <Arch list={set.upper} parent={props} />
      <div className="odo-divider" />
      <Arch list={set.lower} parent={props} />
      <div className="odo-arch-label bottom">{t.lowerArch}</div>
    </div>
  );
}
