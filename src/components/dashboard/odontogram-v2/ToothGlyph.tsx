"use client";

import type { ToothGlyphProps } from "./types";
import { COND_BY_ID, GROUP_COLOR } from "./data";

/* =========================================================
   ToothGlyph — schematic anatomical drawing (ported 1:1 from
   design jsx/surface2d.jsx). Crown at TOP, roots downward; the
   upper arch is flipped vertically via scaleY(-1).
   props: meta, record, w, h
   ========================================================= */
export function ToothGlyph({ meta, record, w = 44, h = 62 }: ToothGlyphProps) {
  const conds = (record.tooth || []).map((id) => COND_BY_ID[id]).filter(Boolean);
  const missing = conds.find((c) => c.render === "missing");
  const endo = conds.find((c) => c.render === "endo");
  const implant = conds.find((c) => c.render === "implant");
  const apical = conds.find((c) => c.render === "apical");
  const fracture = conds.find((c) => c.render === "fracture");
  const post = conds.find((c) => c.render === "post");
  const remnant = conds.find((c) => c.render === "remnant");

  // canonical: crown at TOP (biting edge up), roots downward. viewBox 0..40 x 0..60
  const stroke = "#b7c0cd";
  const fill = missing ? "#eef1f5" : "#fff";
  const crownTop = 2, crownBot = 26, rootBot = 58;
  const roots = implant ? 0 : meta.roots;

  // crown path with subtle cusps for posteriors
  let crownPath: string;
  if (meta.posterior) {
    crownPath = `M6 ${crownBot} V12 q0 -10 8 -10 q6 3 6 -0 q0 -3 6 0 q8 0 8 10 V${crownBot} Z`;
  } else if (meta.type === "canine") {
    crownPath = `M10 ${crownBot} V14 q0 -6 4 -9 q6 -7 6 -3 q0 -4 6 3 q4 3 4 9 V${crownBot} Z`;
  } else {
    crownPath = `M9 ${crownBot} V14 q0 -8 11 -12 q11 4 11 12 V${crownBot} Z`;
  }

  // roots
  const rootEls: JSX.Element[] = [];
  if (roots === 1) {
    rootEls.push(<path key="r1" d={`M13 ${crownBot} q-2 ${rootBot - crownBot} 7 ${rootBot - crownBot} q9 0 7 -${rootBot - crownBot} Z`} fill={fill} stroke={stroke} strokeWidth="1.5" />);
  } else if (roots === 2) {
    rootEls.push(<path key="r1" d={`M12 ${crownBot} q-3 ${rootBot - crownBot - 4} 2 ${rootBot - crownBot} q3 1 4 -2 Z`} fill={fill} stroke={stroke} strokeWidth="1.5" />);
    rootEls.push(<path key="r2" d={`M28 ${crownBot} q3 ${rootBot - crownBot - 4} -2 ${rootBot - crownBot} q-3 1 -4 -2 Z`} fill={fill} stroke={stroke} strokeWidth="1.5" />);
  } else {
    rootEls.push(<path key="r1" d={`M11 ${crownBot} q-3 ${rootBot - crownBot - 6} 1 ${rootBot - crownBot - 4} q3 1 4 -2 Z`} fill={fill} stroke={stroke} strokeWidth="1.5" />);
    rootEls.push(<path key="r2" d={`M20 ${crownBot} q0 ${rootBot - crownBot} 0 ${rootBot - crownBot} q1 0 1 0 Z`} fill={fill} stroke={stroke} strokeWidth="1.5" />);
    rootEls.push(<path key="r3" d={`M29 ${crownBot} q3 ${rootBot - crownBot - 6} -1 ${rootBot - crownBot - 4} q-3 1 -4 -2 Z`} fill={fill} stroke={stroke} strokeWidth="1.5" />);
  }

  // endo: line(s) down the roots
  const endoEls = endo && roots > 0 ? rootCenters(roots).map((x, i) => (
    <line key={i} x1={x} y1={crownBot - 6} x2={x} y2={rootBot - 4}
      stroke={GROUP_COLOR[endo.group]} strokeWidth="2.4"
      strokeDasharray={endo.dashed ? "4 3" : ""} strokeLinecap="round" />
  )) : null;

  // apical lesion: circle at root apex, size by mm
  const apicalEls = apical ? rootCenters(roots).slice(0, 1).map((x, i) => (
    <circle key={i} cx={20} cy={rootBot - 2} r={3 + (apical.mm ?? 1) * 2.5} fill={GROUP_COLOR[apical.group]} opacity="0.28" stroke={GROUP_COLOR[apical.group]} strokeWidth="1.2" />
  )) : null;

  return (
    <svg viewBox="0 0 40 60" width={w} height={h}
      style={{ overflow: "visible", transform: meta.upper ? "scaleY(-1)" : "none" }}>
      {missing && <line x1="4" y1="4" x2="36" y2="56" stroke="#9aa3af" strokeWidth="2" />}
      {!implant && rootEls}
      {implant && <ImplantBody crownBot={crownBot} rootBot={rootBot} color={GROUP_COLOR[implant.group]} />}
      <path d={crownPath} fill={fill} stroke={stroke} strokeWidth="1.6" />
      {post && <rect x="17" y={crownBot - 4} width="6" height={rootBot - crownBot - 6} rx="2" fill={GROUP_COLOR[post.group]} opacity="0.5" />}
      {remnant && <line x1="6" y1="12" x2="34" y2="12" stroke={GROUP_COLOR[remnant.group]} strokeWidth="2" strokeDasharray="4 3" />}
      {endoEls}
      {apicalEls}
      {fracture && <polyline points="20,4 16,14 24,20 18,26" fill="none" stroke={GROUP_COLOR[fracture.group]} strokeWidth="2" strokeLinejoin="round" />}
      {missing && <line x1="36" y1="4" x2="4" y2="56" stroke="#9aa3af" strokeWidth="2" />}
    </svg>
  );
}

function rootCenters(n: number): number[] {
  if (n <= 1) return [20];
  if (n === 2) return [14, 26];
  return [13, 20, 27];
}

function ImplantBody({ crownBot, rootBot, color }: { crownBot: number; rootBot: number; color: string }) {
  const threads: JSX.Element[] = [];
  for (let y = crownBot + 2; y < rootBot - 4; y += 5) {
    threads.push(<line key={y} x1="14" y1={y} x2="26" y2={y + 2} stroke={color} strokeWidth="1.4" />);
  }
  return (
    <g>
      <path d={`M14 ${crownBot} L26 ${crownBot} L22 ${rootBot - 2} L18 ${rootBot - 2} Z`} fill="#e7ecf3" stroke={color} strokeWidth="1.6" />
      {threads}
    </g>
  );
}
