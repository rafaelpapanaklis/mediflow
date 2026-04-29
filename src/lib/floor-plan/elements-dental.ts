/**
 * Catálogo de elementos para clínicas DENTAL — v2 (rich materials).
 *
 * Cada `draw(ox, oy, opts?)` acepta `opts.isOpen` (puertas/gabinete) y
 * `opts.isOccupied` (sillón dental — recline + lámpara activa). Materiales
 * inspirados en mockups/clinica-visual/ v2: cromo, tapizado médico, madera
 * laminada, vidrio, y cerámica.
 *
 * Otras categorías (AESTHETIC_MEDICINE, HAIR_SALON, etc.) se agregarán en
 * iteraciones posteriores; esta entrega cubre solo DENTAL.
 */

import { box, flat, toScreen, C } from "./iso";
import type { DrawOpts, ElementType } from "./element-types";

// ── Helpers internos ──────────────────────────────────
function B(
  ox: number,
  oy: number,
  cw: number,
  rh: number,
  ph: number,
  t: string,
  l: string,
  r: string,
  s = "rgba(0,0,0,0.07)",
  sw = 0.5,
): string {
  return box(ox, oy, cw, rh, ph, { top: t, left: l, right: r, stroke: s, sw });
}
function F(
  ox: number,
  oy: number,
  cw: number,
  rh: number,
  fill: string,
): string {
  return flat(ox, oy, cw, rh, fill, "rgba(0,0,0,0.06)");
}
function g2(col: number, row: number, ox: number, oy: number): [number, number] {
  return toScreen(col, row, ox, oy);
}
function isoLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = "rgba(0,0,0,0.12)",
  sw = 0.7,
  opacity = 1,
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
}
function circle(
  cx: number,
  cy: number,
  r: number,
  fill = "white",
  stroke: string | "none" = "none",
  sw = 0.8,
): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill = "white",
  stroke: string | "none" = "none",
  sw = 0.8,
): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  rx = 0,
  fill = "white",
  stroke: string | "none" = "none",
  sw = 0.5,
): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

// ── Material palettes ──────────────────────────────────
const MAT = {
  metal: { t: "#DDE6EF", l: "#7A8EA8", r: "#9AAEC4", hi: "#F4F8FC" },
  steel: { t: "#CDD8E4", l: "#606E82", r: "#808EA0", hi: "#E8EFF5" },
  upholstery: { t: "#BDD0E8", l: "#2E5888", r: "#4A78A8" },
  upholstery2: { t: "#C8D8F0", l: "#3A5A8A", r: "#5070A0" },
  wood: { t: "#C8824A", l: "#6A3410", r: "#8C4A1E" },
  woodLt: { t: "#D4956A", l: "#7A4020", r: "#9A5830" },
  white: { t: "#EEF3F8", l: "#A8B8CC", r: "#C4D4E4" },
  wallClr: { t: "#E8EDF8", l: "#8090B4", r: "#9AACC8" },
  glass: {
    t: "rgba(195,225,252,0.65)",
    l: "rgba(80,148,210,0.35)",
    r: "rgba(135,185,235,0.5)",
  },
  darkMt: { t: "#B8C8D8", l: "#404E5E", r: "#586474" },
  screen: {
    t: "rgba(30,50,80,0.92)",
    l: "rgba(10,20,40,0.95)",
    r: "rgba(18,32,55,0.93)",
  },
  chrome: { t: "#E4EAF2", l: "#8090A8", r: "#A8B8CC", hi: "#F8FAFC" },
};

function specular(
  ox: number,
  oy: number,
  cw: number,
  rh: number,
): string {
  const p = toScreen(0, 0, ox, oy);
  const pc = toScreen(cw * 0.25, rh * 0.25, ox, oy);
  return `<polygon points="${p[0]},${p[1]} ${p[0] + C * cw * 0.22},${p[1]} ${pc[0]},${pc[1]}" fill="rgba(255,255,255,0.22)" stroke="none"/>`;
}

// ═══════════════════════════════════════════════════════
// ESTRUCTURA
// ═══════════════════════════════════════════════════════
export const wall_h: ElementType = {
  key: "wall_h",
  label: "Pared Horiz.",
  category: "estructura",
  w: 4,
  h: 1,
  draw: (ox, oy) => {
    const wall = B(ox, oy, 4, 0.22, 62, MAT.wallClr.t, MAT.wallClr.l, MAT.wallClr.r);
    const board = B(ox, oy, 4, 0.22, 5, "#C8D0E0", "#606880", "#7880A0");
    const crown = B(ox, oy - 57, 4, 0.22, 4, "#F4F7FC", "#9AAAC0", "#B0BED4");
    const p1 = g2(0, 0, ox, oy);
    const tl =
      isoLine(p1[0], p1[1] - 15, p1[0], p1[1] - 45, "rgba(130,145,175,0.18)", 0.8) +
      isoLine(p1[0], p1[1] - 25, p1[0] + 5, p1[1] - 22, "rgba(130,145,175,0.12)", 0.5);
    return wall + board + crown + tl;
  },
  icon:
    '<rect x="2" y="15" width="36" height="8" rx="1" fill="#9AACC8"/>' +
    '<rect x="2" y="23" width="36" height="3" rx="1" fill="#7880A0"/>' +
    '<rect x="2" y="12" width="36" height="4" rx="1" fill="#F4F7FC" opacity="0.9"/>',
};

export const wall_v: ElementType = {
  key: "wall_v",
  label: "Pared Vert.",
  category: "estructura",
  w: 1,
  h: 4,
  draw: (ox, oy) => {
    const wall = B(ox, oy, 0.22, 4, 62, MAT.wallClr.t, MAT.wallClr.l, MAT.wallClr.r);
    const board = B(ox, oy, 0.22, 4, 5, "#C8D0E0", "#606880", "#7880A0");
    const crown = B(ox, oy - 57, 0.22, 4, 4, "#F4F7FC", "#9AAAC0", "#B0BED4");
    return wall + board + crown;
  },
  icon:
    '<rect x="14" y="2" width="8" height="36" rx="1" fill="#9AACC8"/>' +
    '<rect x="10" y="2" width="5" height="36" rx="1" fill="#7880A0"/>' +
    '<rect x="14" y="2" width="5" height="36" rx="1" fill="#F4F7FC" opacity="0.9"/>',
};

export const puerta: ElementType = {
  key: "puerta",
  label: "Puerta",
  category: "estructura",
  w: 2,
  h: 1,
  draw: (ox, oy, opts) => {
    const isOpen = opts?.isOpen === true;
    const frame = B(ox, oy, 2, 0.18, 64, MAT.woodLt.t, MAT.woodLt.l, MAT.woodLt.r);
    const p = g2(0, 0, ox, oy);
    if (isOpen) {
      const opW = 28;
      const opH = 54;
      const dx = p[0] + 6;
      const dy = p[1] - 58;
      const panelOpen = `<polygon points="${dx},${dy + opH} ${dx + opW * 0.3},${dy} ${dx + opW},${dy} ${dx + opW * 0.7},${dy + opH}" fill="rgba(220,240,255,0.5)" stroke="#9A6828" stroke-width="0.8"/>`;
      const handleOpen = circle(dx + opW * 0.55, dy + opH * 0.52, 2.5, "#C09040", "#907030", 0.7);
      return frame + panelOpen + handleOpen;
    }
    const dX = p[0] + 6;
    const dY = p[1] - 58;
    const panel = rect(dX, dY, 34, 54, 1, "rgba(195,225,252,0.38)", "#9A6828", 0.8);
    const mp1 = rect(dX + 4, dY + 6, 26, 19, 1, "rgba(255,255,255,0.08)", "rgba(150,110,50,0.4)", 0.6);
    const mp2 = rect(dX + 4, dY + 29, 26, 19, 1, "rgba(255,255,255,0.08)", "rgba(150,110,50,0.4)", 0.6);
    const handle = rect(dX + 26, dY + 25, 5, 10, 2, "#D0A040", "#907030", 0.8);
    const knob = circle(dX + 28, dY + 30, 3, "#E0B050", "#A07020", 0.8);
    const refl = `<line x1="${dX + 7}" y1="${dY + 4}" x2="${dX + 12}" y2="${dY + 50}" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>`;
    return frame + panel + mp1 + mp2 + refl + handle + knob;
  },
  icon:
    '<rect x="9" y="4" width="20" height="30" rx="1" fill="#C8954A" stroke="#8A5020" stroke-width="1.2"/>' +
    '<rect x="11" y="6" width="16" height="11" rx="1" fill="rgba(195,225,252,0.5)" stroke="rgba(150,100,40,0.4)" stroke-width="0.7"/>' +
    '<rect x="11" y="19" width="16" height="11" rx="1" fill="rgba(195,225,252,0.5)" stroke="rgba(150,100,40,0.4)" stroke-width="0.7"/>' +
    '<circle cx="26" cy="24" r="2.5" fill="#D4A040"/>',
};

export const ventana: ElementType = {
  key: "ventana",
  label: "Ventana",
  category: "estructura",
  w: 2,
  h: 1,
  draw: (ox, oy) => {
    const wall = B(ox, oy, 2, 0.15, 64, MAT.wallClr.t, MAT.wallClr.l, MAT.wallClr.r);
    const wPos = g2(0.22, 0, ox, oy);
    const frame = B(wPos[0], wPos[1] - 14, 1.56, 0.11, 42, "#F4F7FC", "#B0BED4", "#C8D6E8");
    const g1 = g2(0.3, 0, ox, oy);
    const pane1 = B(g1[0], g1[1] - 16, 0.6, 0.09, 32, MAT.glass.t, MAT.glass.l, MAT.glass.r);
    const g2p = g2(1.05, 0, ox, oy);
    const pane2 = B(g2p[0], g2p[1] - 16, 0.6, 0.09, 32, MAT.glass.t, MAT.glass.l, MAT.glass.r);
    const mulPos = g2(0.96, 0, ox, oy);
    const mullion = B(mulPos[0], mulPos[1] - 14, 0.08, 0.1, 40, "#E0E8F4", "#8898B4", "#A0B0C8");
    const r1 = g2(0.36, 0.01, ox, oy);
    const refl1 = `<line x1="${r1[0]}" y1="${r1[1] - 18}" x2="${r1[0] + 5}" y2="${r1[1] - 42}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>`;
    const r2 = g2(1.12, 0.01, ox, oy);
    const refl2 = `<line x1="${r2[0]}" y1="${r2[1] - 18}" x2="${r2[0] + 5}" y2="${r2[1] - 42}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>`;
    return wall + frame + pane1 + pane2 + mullion + refl1 + refl2;
  },
  icon:
    '<rect x="3" y="11" width="34" height="18" rx="2" fill="#9AACC8"/>' +
    '<rect x="5" y="13" width="14" height="14" rx="1" fill="rgba(195,225,252,0.85)"/>' +
    '<rect x="21" y="13" width="14" height="14" rx="1" fill="rgba(195,225,252,0.85)"/>' +
    '<line x1="7" y1="14" x2="9" y2="26" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>' +
    '<line x1="23" y1="14" x2="25" y2="26" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>',
};

// ═══════════════════════════════════════════════════════
// EQUIPO DENTAL
// ═══════════════════════════════════════════════════════
export const sillon: ElementType = {
  key: "sillon",
  label: "Sillón Dental",
  category: "dental",
  w: 2,
  h: 3,
  isChair: true,
  draw: (ox, oy, opts) => {
    const occ = opts?.isOccupied === true;
    const reclAmt = occ ? 0.35 : 0;

    // Pedestal base (cromo)
    const base = B(ox, oy, 2, 3, 8, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const fd = g2(0.15, 0.2, ox, oy);
    const disk = B(fd[0], fd[1] - 8, 1.7, 2.6, 4, MAT.steel.t, MAT.steel.l, MAT.steel.r);
    const col = g2(0.8, 1.1, ox, oy);
    const column = B(col[0], col[1] - 8, 0.38, 0.8, 28, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const colHi = B(col[0], col[1] - 32, 0.1, 0.3, 28, MAT.chrome.hi, "transparent", "transparent");

    // Asiento (tapizado azul médico)
    const sc = g2(0.14, 0.38, ox, oy);
    const seat = B(sc[0], sc[1] - 8, 1.62, 1.55, 13, MAT.upholstery.t, MAT.upholstery.l, MAT.upholstery.r);
    const sm1 = g2(0.55, 0.38, ox, oy);
    const sm2 = g2(0.55, 1.5, ox, oy);
    const seams =
      isoLine(sm1[0], sm1[1] - 8, sm2[0], sm2[1] - 8, "rgba(30,70,130,0.25)", 0.6) +
      isoLine(sm1[0] + 15, sm1[1] - 11, sm2[0] + 15, sm2[1] - 11, "rgba(30,70,130,0.15)", 0.5);

    // Respaldo (se reclina si ocupado)
    const brC = 1.62 + reclAmt;
    const brR = 0.38;
    const br = g2(brC, brR, ox, oy);
    const backH = occ ? 20 : 32;
    const backDepth = 1.55 - reclAmt * 0.5;
    const back = B(br[0], br[1] - 8, 0.26, backDepth, backH, MAT.upholstery2.t, MAT.upholstery2.l, MAT.upholstery2.r);
    const bsm = g2(brC + 0.13, brR, ox, oy);
    const backSeam = isoLine(bsm[0], bsm[1] - 10, bsm[0] - 8 * reclAmt, bsm[1] - 8 - backH, "rgba(40,80,140,0.2)", 0.6);

    // Apoyacabezas
    const hr = g2(brC + reclAmt * 0.1, brR, ox, oy);
    const headrest = B(hr[0] - 2 * reclAmt, hr[1] - 8 - backH, 0.26, 0.5, 7, "#D0E4F4", "#4870A0", "#6090BC");

    // Brazos
    const ar1 = g2(0.14, 0.38, ox, oy);
    const armL = B(ar1[0], ar1[1] - 21, 0.22, 1.55, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const ar2 = g2(1.68, 0.38, ox, oy);
    const armR = B(ar2[0], ar2[1] - 21, 0.22, 1.55, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);

    // Reposapiés
    const fr = g2(0.14, 1.78, ox, oy);
    const foot = B(fr[0], fr[1] - 8, 0.95, 0.82, 9, MAT.upholstery.t, MAT.upholstery.l, MAT.upholstery.r);

    // Brazo lámpara
    const lpBase = g2(1.72, 0.42, ox, oy);
    const lampPole = B(lpBase[0], lpBase[1] - 8, 0.09, 0.09, 50, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const lj = g2(1.22, 0.4, ox, oy);
    const joint = B(lj[0], lj[1] - 54, 0.18, 0.18, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const la = g2(1.1, 0.4, ox, oy);
    const lampArm = B(la[0], la[1] - 56, 0.5, 0.09, 4, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const lh = g2(0.72, 0.38, ox, oy);
    const lampHead = B(lh[0], lh[1] - 58, 0.82, 0.38, 12, "#FBBF24", "#A07800", "#C89800");
    const lb = g2(0.9, 0.52, ox, oy);
    const bulb = ellipse(lb[0], lb[1] - 59, 8, 4, "#FFF8DC", "#E0A000", 0.7);

    let glow = "";
    if (occ) {
      const gc = g2(0.9, 0.95, ox, oy);
      glow =
        ellipse(gc[0], gc[1] - 20, 48, 24, "rgba(251,191,36,0.10)") +
        ellipse(gc[0], gc[1] - 20, 28, 14, "rgba(251,191,36,0.18)");
    }
    return (
      disk + base + column + colHi + seat + seams + armL + armR +
      back + backSeam + headrest + foot +
      lampPole + joint + lampArm + lampHead + bulb + glow
    );
  },
  icon:
    '<rect x="7" y="20" width="22" height="12" rx="2" fill="#BDD0E8" stroke="#3A6898" stroke-width="0.8"/>' +
    '<rect x="27" y="10" width="5" height="22" rx="2" fill="#5A88B8"/>' +
    '<rect x="7" y="8" width="5" height="22" rx="2" fill="#8090A8" opacity="0.7"/>' +
    '<rect x="27" y="8" width="6" height="4" rx="1" fill="#5A88B8"/>' +
    '<rect x="29" y="4" width="2" height="8" rx="1" fill="#A0B8CC"/>' +
    '<ellipse cx="26" cy="4" rx="5" ry="2.5" fill="#FBBF24"/>',
};

export const rayosx: ElementType = {
  key: "rayosx",
  label: "Rayos X",
  category: "dental",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 2, 2, 22, MAT.white.t, MAT.white.l, MAT.white.r);
    const bodyHi = specular(ox, oy, 2, 2);
    const pnl = g2(0.15, 0.15, ox, oy);
    const panel = B(pnl[0], pnl[1] - 22, 1.7, 1.7, 4, "#D8E8F4", "#5878A0", "#7898B8");
    const scr = g2(0.3, 0.3, ox, oy);
    const screen = B(scr[0], scr[1] - 22, 1.2, 0.8, 3, MAT.screen.t, "#0A1422", MAT.screen.r);
    const led1 = g2(0.4, 1.55, ox, oy);
    const led2 = g2(0.65, 1.55, ox, oy);
    const led3 = g2(0.9, 1.55, ox, oy);
    const leds =
      circle(led1[0], led1[1] - 22, 3, "#10B981", "#0A8060") +
      circle(led2[0], led2[1] - 22, 3, "#FBBF24", "#C08800") +
      circle(led3[0], led3[1] - 22, 3, "#EF4444", "#B02020");
    const ap = g2(0.84, 0.88, ox, oy);
    const post = B(ap[0], ap[1] - 22, 0.14, 0.14, 58, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const aj = g2(0.84, 0.88, ox, oy);
    const armJoint = B(aj[0] - 3, aj[1] - 70, 0.22, 0.22, 7, MAT.steel.t, MAT.steel.l, MAT.steel.r);
    const ah = g2(0.4, 0.86, ox, oy);
    const armH = B(ah[0], ah[1] - 72, 0.7, 0.12, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const xh = g2(0.22, 0.84, ox, oy);
    const xHead = B(xh[0], xh[1] - 74, 0.5, 0.5, 22, MAT.darkMt.t, MAT.darkMt.l, MAT.darkMt.r);
    const cn = g2(0.28, 0.9, ox, oy);
    const cone = B(cn[0], cn[1] - 58, 0.38, 0.38, 16, "#505868", "#282E38", "#363E4A");
    return body + bodyHi + panel + screen + leds + post + armJoint + armH + xHead + cone;
  },
  icon:
    '<rect x="6" y="18" width="28" height="16" rx="3" fill="#C8D8E8" stroke="#8098B0" stroke-width="0.8"/>' +
    '<rect x="8" y="20" width="14" height="8" rx="1" fill="#1A2840"/>' +
    '<rect x="16" y="4" width="3" height="17" rx="1.5" fill="#A0B0C4"/>' +
    '<rect x="9" y="3" width="14" height="6" rx="1.5" fill="#6080A0"/>' +
    '<rect x="10" y="4" width="5" height="4" rx="1" fill="#282E48"/>' +
    '<circle cx="27" cy="21" r="2" fill="#10B981"/>' +
    '<circle cx="32" cy="21" r="2" fill="#FBBF24"/>',
};

export const esterilizador: ElementType = {
  key: "esterilizador",
  label: "Esterilizador",
  category: "dental",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 2, 2, 34, MAT.white.t, MAT.white.l, MAT.white.r);
    const bodyHi = specular(ox, oy, 2, 2);
    const d = g2(0.08, 0.08, ox, oy);
    const door = B(d[0], d[1] - 34, 0.6, 0.12, 26, "#D8E8F4", MAT.steel.l, MAT.steel.r);
    const dr = g2(0.1, 0.1, ox, oy);
    const seal = B(dr[0] - 1, dr[1] - 34, 0.58, 0.1, 24, "#C8DAE8", "#5878A0", "#7098B8");
    const dh = g2(0.62, 0.08, ox, oy);
    const handle = B(dh[0], dh[1] - 38, 0.08, 0.1, 20, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const cp = g2(0.78, 0.1, ox, oy);
    const ctrlPanel = B(cp[0], cp[1] - 34, 1.14, 0.1, 30, "#E4EEF8", "#6080A8", "#8098C0");
    const dp = g2(0.82, 0.14, ox, oy);
    const disp = B(dp[0], dp[1] - 36, 0.7, 0.06, 16, MAT.screen.t, "#0A1422", MAT.screen.r);
    const dtx = g2(0.86, 0.16, ox, oy);
    const dispText =
      rect(dtx[0] - 1, dtx[1] - 46, 20, 6, 1, "transparent", "rgba(0,200,120,0.7)", 0.8) +
      isoLine(dtx[0] + 2, dtx[1] - 47, dtx[0] + 14, dtx[1] - 47, "rgba(0,220,140,0.5)", 1);
    const b1 = g2(0.84, 1.55, ox, oy);
    const b2 = g2(1.1, 1.55, ox, oy);
    const b3 = g2(1.36, 1.55, ox, oy);
    const btns =
      circle(b1[0], b1[1] - 34, 4, "#4A90E2", "#2A68C2") +
      circle(b2[0], b2[1] - 34, 4, "#10B981", "#0A7050") +
      circle(b3[0], b3[1] - 34, 4, "#EF4444", "#B02020");
    const v = g2(2, 0.3, ox, oy);
    const vents =
      isoLine(v[0] - 2, v[1] - 36, v[0] - 2, v[1] - 28, "rgba(100,130,160,0.3)", 0.8) +
      isoLine(v[0] - 6, v[1] - 34, v[0] - 6, v[1] - 26, "rgba(100,130,160,0.3)", 0.8) +
      isoLine(v[0] - 10, v[1] - 32, v[0] - 10, v[1] - 24, "rgba(100,130,160,0.3)", 0.8);
    return body + bodyHi + door + seal + handle + ctrlPanel + disp + dispText + btns + vents;
  },
  icon:
    '<rect x="5" y="9" width="30" height="22" rx="3" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<rect x="7" y="11" width="14" height="18" rx="2" fill="#C8DAE8" stroke="#7090B0" stroke-width="0.8"/>' +
    '<rect x="7" y="11" width="7" height="18" rx="1" fill="#D8E8F4"/>' +
    '<rect x="23" y="11" width="10" height="10" rx="1" fill="#1A2840"/>' +
    '<circle cx="25" cy="25" r="2.5" fill="#4A90E2"/>' +
    '<circle cx="30" cy="25" r="2.5" fill="#10B981"/>',
};

export const lavabo: ElementType = {
  key: "lavabo",
  label: "Lavabo Clínico",
  category: "dental",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const cab = B(ox, oy, 2, 2, 22, MAT.white.t, MAT.white.l, MAT.white.r);
    const dr = g2(0.08, 0.08, ox, oy);
    const drawer = B(dr[0], dr[1] - 22, 1.84, 0.08, 11, "#E0ECF4", MAT.steel.l, MAT.steel.r);
    const dh = g2(0.85, 0.08, ox, oy);
    const dhandle = B(dh[0], dh[1] - 26, 0.3, 0.04, 4, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const ct = B(ox - 2, oy - 22, 2.04, 2.04, 5, "#F4F8FA", "#B0C4D4", "#C8D8E8");
    const bs = g2(0.22, 0.28, ox, oy);
    const basin = F(bs[0], bs[1] - 22, 1.56, 1.44, "#DCF0FA");
    const bi = g2(0.36, 0.42, ox, oy);
    const basinInner = F(bi[0], bi[1] - 21, 1.28, 1.16, "rgba(180,215,240,0.7)");
    const brim = g2(0.22, 0.28, ox, oy);
    const rimH = F(brim[0], brim[1] - 23, 1.56, 1.44, "rgba(255,255,255,0.3)");
    const dn = g2(0.92, 0.98, ox, oy);
    const drain =
      circle(dn[0], dn[1] - 21, 4, "#A0B8D0", "#7090A8") +
      circle(dn[0], dn[1] - 21, 2, "#8090A0");
    const fp = g2(0.9, 0.3, ox, oy);
    const faucetBase = B(fp[0], fp[1] - 26, 0.2, 0.12, 10, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const faucetNeck = B(fp[0] + 2, fp[1] - 36, 0.1, 0.08, 18, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const faucetSpout = B(fp[0] - 4, fp[1] - 45, 0.35, 0.08, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const h1 = g2(0.55, 0.32, ox, oy);
    const h2 = g2(1.35, 0.32, ox, oy);
    const handles =
      circle(h1[0], h1[1] - 27, 4, "#EF4444", "#B02020") +
      circle(h2[0], h2[1] - 27, 4, "#4A90E2", "#1A5898");
    return cab + drawer + dhandle + ct + basin + basinInner + rimH + drain + faucetBase + faucetNeck + faucetSpout + handles;
  },
  icon:
    '<rect x="5" y="17" width="30" height="16" rx="3" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<ellipse cx="20" cy="21" rx="12" ry="7" fill="#DCF0FA" stroke="#A0C8E0" stroke-width="0.8"/>' +
    '<ellipse cx="20" cy="21" rx="7" ry="4" fill="rgba(180,215,240,0.7)"/>' +
    '<rect x="18" y="10" width="3" height="9" rx="1.5" fill="#C8D8E4"/>' +
    '<circle cx="14" cy="22" r="2" fill="#EF4444"/>' +
    '<circle cx="26" cy="22" r="2" fill="#4A90E2"/>',
};

export const gabinete: ElementType = {
  key: "gabinete",
  label: "Gabinete",
  category: "dental",
  w: 1,
  h: 2,
  draw: (ox, oy, opts) => {
    const isOpen = opts?.isOpen === true;
    const body = B(ox, oy, 1, 2, 42, MAT.white.t, MAT.white.l, MAT.white.r);
    const bodyHi = specular(ox, oy, 1, 2);
    const d1 = g2(0.06, 0.08, ox, oy);
    const dr1 = B(d1[0], d1[1] - 42, 0.88, 0.08, 13, "#E4EEF8", MAT.steel.l, MAT.steel.r);
    const h1 = g2(0.35, 0.08, ox, oy);
    const hdl1 = B(h1[0], h1[1] - 48, 0.3, 0.04, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const d2 = g2(0.06, 0.65, ox, oy);
    const dr2 = B(d2[0], d2[1] - 42, 0.88, 0.08, 13, "#E4EEF8", MAT.steel.l, MAT.steel.r);
    const h2 = g2(0.35, 0.65, ox, oy);
    const hdl2 = B(h2[0], h2[1] - 48, 0.3, 0.04, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const d3 = g2(0.06, 1.28, ox, oy);
    const dr3 = B(d3[0], d3[1] - 42, 0.88, 0.08, 13, "#E4EEF8", MAT.steel.l, MAT.steel.r);
    const h3 = g2(0.35, 1.28, ox, oy);
    const hdl3 = B(h3[0], h3[1] - 48, 0.3, 0.04, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    let openDrawer = "";
    if (isOpen) {
      const od = g2(-0.3, 0.06, ox, oy);
      openDrawer =
        B(od[0], od[1] - 42, 0.9, 0.08, 12, "#F0F5FA", "#9AAAC0", "#B0C0D0") +
        isoLine(od[0] + 5, od[1] - 42, od[0] + 30, od[1] - 42, "rgba(74,144,226,0.5)", 1) +
        isoLine(od[0] + 8, od[1] - 42, od[0] + 8, od[1] - 48, "rgba(74,144,226,0.4)", 0.8);
    }
    return body + bodyHi + dr1 + hdl1 + dr2 + hdl2 + dr3 + hdl3 + openDrawer;
  },
  icon:
    '<rect x="10" y="4" width="20" height="34" rx="2" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<rect x="11" y="8" width="18" height="7" rx="1" fill="#E4EEF8" stroke="#9AAAC0" stroke-width="0.5"/>' +
    '<rect x="11" y="18" width="18" height="7" rx="1" fill="#E4EEF8" stroke="#9AAAC0" stroke-width="0.5"/>' +
    '<rect x="11" y="28" width="18" height="7" rx="1" fill="#E4EEF8" stroke="#9AAAC0" stroke-width="0.5"/>' +
    '<rect x="17" y="10" width="6" height="2" rx="1" fill="#A8B8CC"/>' +
    '<rect x="17" y="20" width="6" height="2" rx="1" fill="#A8B8CC"/>' +
    '<rect x="17" y="30" width="6" height="2" rx="1" fill="#A8B8CC"/>',
};

export const taburete: ElementType = {
  key: "taburete",
  label: "Taburete",
  category: "dental",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const base = g2(0.5, 0.5, ox, oy);
    let star = "";
    for (let i = 0; i < 5; i++) {
      const angle = ((i * 72 - 90) * Math.PI) / 180;
      const bx = base[0] + Math.cos(angle) * 18;
      const by = base[1] + 8 + Math.sin(angle) * 9;
      star += isoLine(base[0], base[1] + 8, bx, by, "rgba(60,70,85,0.8)", 2.5);
      star += circle(bx, by + 1, 3.5, "#2A2E38", "#1A1E28");
    }
    const cyl = g2(0.42, 0.42, ox, oy);
    const cylinder = B(cyl[0], cyl[1] + 5, 0.16, 0.16, 22, "#C0C8D4", "#606878", "#808898");
    const s = g2(0.18, 0.18, ox, oy);
    const seat = B(s[0], s[1] - 17, 0.64, 0.64, 8, MAT.upholstery.t, MAT.upholstery.l, MAT.upholstery.r);
    const sHi = B(s[0], s[1] - 24, 0.64, 0.64, 2, "rgba(210,230,250,0.6)", "transparent", "transparent");
    return star + cylinder + seat + sHi;
  },
  icon:
    '<circle cx="20" cy="15" r="11" fill="#BDD0E8" stroke="#3A6898" stroke-width="0.8"/>' +
    '<circle cx="20" cy="15" r="6" fill="#D0E4F4"/>' +
    '<rect x="18.5" y="24" width="3" height="8" rx="1.5" fill="#808898"/>' +
    '<line x1="20" y1="32" x2="12" y2="36" stroke="#2A2E38" stroke-width="2" stroke-linecap="round"/>' +
    '<line x1="20" y1="32" x2="28" y2="36" stroke="#2A2E38" stroke-width="2" stroke-linecap="round"/>' +
    '<line x1="20" y1="32" x2="14" y2="38" stroke="#2A2E38" stroke-width="2" stroke-linecap="round"/>',
};

// ═══════════════════════════════════════════════════════
// RECEPCIÓN
// ═══════════════════════════════════════════════════════
export const mostrador: ElementType = {
  key: "mostrador",
  label: "Mostrador",
  category: "recepcion",
  w: 4,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 4, 2, 36, MAT.white.t, MAT.white.l, MAT.white.r);
    const strip = B(ox, oy, 4, 2, 4, "#4A90E2", "#1A60B0", "#2A78C8");
    const top = B(ox - 2, oy - 36, 4.08, 2.08, 6, MAT.woodLt.t, MAT.woodLt.l, MAT.woodLt.r);
    const g1 = g2(0.1, 0.1, ox, oy);
    const grain =
      isoLine(g1[0] + 5, g1[1] - 36, g1[0] + C * 3.8 + 5, g1[1] - 36 - C * 0.5, "rgba(100,50,20,0.15)", 1) +
      isoLine(g1[0] + 5, g1[1] - 39, g1[0] + C * 3.8 + 5, g1[1] - 39 - C * 0.5, "rgba(100,50,20,0.10)", 0.8);
    const mon = g2(2.5, 0.25, ox, oy);
    const monBase = B(mon[0], mon[1] - 36, 0.12, 0.12, 6, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const monArm = B(mon[0] + 1, mon[1] - 42, 0.08, 0.08, 24, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const monScreen = B(mon[0] - 4, mon[1] - 64, 0.7, 0.42, 26, MAT.screen.t, "#0A1422", MAT.screen.r);
    const sg = g2(2.5, 0.4, ox, oy);
    const screenGlow = `<rect x="${sg[0] - 8}" y="${sg[1] - 88}" width="28" height="22" rx="2" fill="rgba(74,144,226,0.22)"/>`;
    const dw = g2(0.1, 0.1, ox, oy);
    const drawerLine = isoLine(dw[0] + 2, dw[1] - 37, dw[0] + C * 2 - 2, dw[1] - 37 - C * 0.5, "rgba(180,160,130,0.35)", 0.8);
    return body + strip + top + grain + drawerLine + monBase + monArm + monScreen + screenGlow;
  },
  icon:
    '<rect x="3" y="18" width="34" height="16" rx="2" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<rect x="3" y="18" width="34" height="3" rx="1" fill="#4A90E2"/>' +
    '<rect x="3" y="13" width="34" height="7" rx="1" fill="#C8824A"/>' +
    '<rect x="24" y="6" width="7" height="8" rx="1" fill="#1A2840"/>' +
    '<rect x="23" y="13" width="2" height="4" rx="1" fill="#A0B0C0"/>',
};

export const silla_espera: ElementType = {
  key: "silla_espera",
  label: "Silla Espera",
  category: "recepcion",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const legPositions: [number, number][] = [
      [0.1, 0.1],
      [0.8, 0.1],
      [0.1, 0.8],
      [0.8, 0.8],
    ];
    let legs = "";
    for (const lp of legPositions) {
      const lpos = g2(lp[0], lp[1], ox, oy);
      legs += B(lpos[0], lpos[1], 0.12, 0.12, 20, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    }
    const s = g2(0.08, 0.08, ox, oy);
    const seat = B(s[0], s[1] - 20, 0.84, 0.84, 11, "#4A90E2", "#1A58A0", "#2A70B8");
    const sHi = B(s[0] + 1, s[1] - 28, 0.78, 0.78, 3, "rgba(140,195,245,0.7)", "transparent", "transparent");
    const br = g2(0.84, 0.08, ox, oy);
    const back = B(br[0], br[1] - 20, 0.16, 0.84, 32, "#2A70B8", "#0A40A0", "#1A58B0");
    const backHi = B(br[0], br[1] - 50, 0.08, 0.84, 14, "rgba(140,195,245,0.5)", "transparent", "transparent");
    return legs + seat + sHi + back + backHi;
  },
  icon:
    '<rect x="7" y="22" width="26" height="11" rx="2" fill="#4A90E2" stroke="#1A58A0" stroke-width="0.8"/>' +
    '<rect x="7" y="18" width="26" height="6" rx="1" fill="rgba(140,195,245,0.6)"/>' +
    '<rect x="31" y="11" width="4" height="22" rx="2" fill="#2A70B8"/>' +
    '<rect x="8" y="32" width="2" height="6" rx="1" fill="#8090A8"/>' +
    '<rect x="30" y="32" width="2" height="6" rx="1" fill="#8090A8"/>',
};

export const banca: ElementType = {
  key: "banca",
  label: "Banca 3P",
  category: "recepcion",
  w: 3,
  h: 1,
  draw: (ox, oy) => {
    const legL = g2(0.08, 0.08, ox, oy);
    const legR = g2(2.8, 0.08, ox, oy);
    const frameLl = B(legL[0], legL[1], 0.12, 0.84, 18, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const frameLr = B(legR[0], legR[1], 0.12, 0.84, 18, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const xb = g2(0.12, 0.84, ox, oy);
    const crossbar = B(xb[0], xb[1], 2.76, 0.1, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    let pads = "";
    let dividers = "";
    for (let i = 0; i < 3; i++) {
      const ps = g2(0.08 + i, 0.08, ox, oy);
      pads += B(ps[0], ps[1] - 18, 0.84, 0.84, 10, "#4A90E2", "#1A58A0", "#2A70B8");
      if (i < 2) {
        const ds = g2(0.94 + i, 0.08, ox, oy);
        dividers += B(ds[0], ds[1] - 18, 0.12, 0.84, 24, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
      }
    }
    const br = g2(2.8, 0.08, ox, oy);
    const back = B(br[0], br[1] - 18, 0.2, 2.84, 28, "#2A70B8", "#0A40A0", "#1A58B0");
    return frameLl + frameLr + crossbar + pads + dividers + back;
  },
  icon:
    '<rect x="3" y="22" width="34" height="10" rx="2" fill="#4A90E2"/>' +
    '<rect x="35" y="12" width="3" height="20" rx="1.5" fill="#2A70B8"/>' +
    '<line x1="14" y1="22" x2="14" y2="32" stroke="#1A58A0" stroke-width="1.5"/>' +
    '<line x1="25" y1="22" x2="25" y2="32" stroke="#1A58A0" stroke-width="1.5"/>' +
    '<rect x="3" y="32" width="2" height="5" rx="1" fill="#9AAAC0"/>' +
    '<rect x="35" y="32" width="2" height="5" rx="1" fill="#9AAAC0"/>',
};

export const mesa_centro: ElementType = {
  key: "mesa_centro",
  label: "Mesa Centro",
  category: "recepcion",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const legPos: [number, number][] = [
      [0.1, 0.1],
      [1.8, 0.1],
      [0.1, 1.8],
      [1.8, 1.8],
    ];
    let legs = "";
    for (const lp of legPos) {
      const lpos = g2(lp[0], lp[1], ox, oy);
      legs += B(lpos[0], lpos[1], 0.12, 0.12, 28, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    }
    const ls = g2(0.18, 0.18, ox, oy);
    const shelf = B(ls[0], ls[1] + 4, 1.64, 1.64, 4, "#D4906A", "#7A4020", "#9A5830");
    const gt = B(ox - 3, oy - 24, 2.06, 2.06, 5, MAT.glass.t, MAT.glass.l, MAT.glass.r);
    const gr = g2(0.1, 0.1, ox, oy);
    const glassRefl = isoLine(gr[0] + 4, gr[1] - 26, gr[0] + C * 1.2, gr[1] - 26 - C * 0.3, "rgba(255,255,255,0.3)", 2);
    return legs + shelf + gt + glassRefl;
  },
  icon:
    '<rect x="7" y="15" width="26" height="14" rx="1" fill="rgba(195,225,252,0.8)" stroke="#7090B0" stroke-width="0.8"/>' +
    '<line x1="9" y1="16" x2="20" y2="22" stroke="rgba(255,255,255,0.5)" stroke-width="2"/>' +
    '<rect x="10" y="25" width="2" height="8" rx="1" fill="#8090A8"/>' +
    '<rect x="28" y="25" width="2" height="8" rx="1" fill="#8090A8"/>' +
    '<rect x="9" y="27" width="22" height="3" rx="1" fill="#C8824A"/>',
};

// ═══════════════════════════════════════════════════════
// MOBILIARIO
// ═══════════════════════════════════════════════════════
export const escritorio: ElementType = {
  key: "escritorio",
  label: "Escritorio",
  category: "mobiliario",
  w: 3,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 3, 2, 28, MAT.white.t, MAT.white.l, MAT.white.r);
    const ped = g2(0.06, 0.06, ox, oy);
    const pedUnit = B(ped[0], ped[1] - 28, 0.9, 0.08, 28, "#E0ECF4", MAT.steel.l, MAT.steel.r);
    const pd1 = g2(0.08, 0.1, ox, oy);
    const pdraw1 = B(pd1[0], pd1[1] - 28, 0.84, 0.06, 9, "#E8F0F8", MAT.steel.l, MAT.steel.r);
    const pd1h = g2(0.3, 0.1, ox, oy);
    const phdl1 = B(pd1h[0], pd1h[1] - 31, 0.24, 0.04, 3, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const pd2 = g2(0.08, 0.65, ox, oy);
    const pdraw2 = B(pd2[0], pd2[1] - 28, 0.84, 0.06, 9, "#E8F0F8", MAT.steel.l, MAT.steel.r);
    const pd2h = g2(0.3, 0.65, ox, oy);
    const phdl2 = B(pd2h[0], pd2h[1] - 31, 0.24, 0.04, 3, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const top = B(ox - 2, oy - 28, 3.04, 2.04, 5, MAT.woodLt.t, MAT.woodLt.l, MAT.woodLt.r);
    const gp = g2(0.1, 0.1, ox, oy);
    const grain =
      isoLine(gp[0] + 4, gp[1] - 28, gp[0] + C * 2.8, gp[1] - 28 - C * 0.4, "rgba(100,50,20,0.13)", 0.9) +
      isoLine(gp[0] + 4, gp[1] - 31, gp[0] + C * 2.8, gp[1] - 31 - C * 0.4, "rgba(100,50,20,0.09)", 0.7);
    const mp = g2(1.8, 0.25, ox, oy);
    const mbase = B(mp[0], mp[1] - 28, 0.14, 0.12, 5, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const mneck = B(mp[0] + 2, mp[1] - 33, 0.08, 0.08, 22, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const mscr = B(mp[0] - 5, mp[1] - 55, 0.72, 0.44, 24, MAT.screen.t, "#0A1422", MAT.screen.r);
    const mscrGlow = `<rect x="${mp[0] - 6}" y="${mp[1] - 79}" width="30" height="20" rx="2" fill="rgba(74,144,226,0.2)"/>`;
    const mpos = g2(1.2, 1.3, ox, oy);
    const mouse = ellipse(mpos[0], mpos[1] - 29, 5, 4, "#E8EEF4", "#9AAAC0", 0.8);
    return body + pedUnit + pdraw1 + phdl1 + pdraw2 + phdl2 + top + grain + mbase + mneck + mscr + mscrGlow + mouse;
  },
  icon:
    '<rect x="3" y="17" width="34" height="16" rx="2" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<rect x="3" y="12" width="34" height="7" rx="1" fill="#C8824A"/>' +
    '<rect x="3" y="22" width="10" height="11" rx="1" fill="#D8E8F4" stroke="#9AAAC0" stroke-width="0.5"/>' +
    '<rect x="24" y="6" width="7" height="7" rx="1" fill="#1A2840"/>' +
    '<rect x="23" y="12" width="2" height="4" rx="1" fill="#9AAAC0"/>',
};

export const silla_oficina: ElementType = {
  key: "silla_oficina",
  label: "Silla Oficina",
  category: "mobiliario",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const base = g2(0.5, 0.5, ox, oy);
    let star = "";
    for (let i = 0; i < 5; i++) {
      const angle = ((i * 72 - 90) * Math.PI) / 180;
      const bx = base[0] + Math.cos(angle) * 17;
      const by = base[1] + 9 + Math.sin(angle) * 9;
      star += isoLine(base[0], base[1] + 9, bx, by, "#2A2E38", 2.5);
      star += circle(bx, by + 2, 3.5, "#1A1E28", "#0A0E18");
    }
    const gl = g2(0.42, 0.42, ox, oy);
    const gaslift = B(gl[0], gl[1] + 7, 0.16, 0.16, 20, "#D0D8E0", "#6A7880", "#8A9AA8");
    const s = g2(0.1, 0.1, ox, oy);
    const seat = B(s[0], s[1] - 13, 0.8, 0.8, 11, "#282832", "#0A0A18", "#181820");
    const sHi = B(s[0] + 1, s[1] - 20, 0.7, 0.7, 2, "rgba(100,100,130,0.3)", "transparent", "transparent");
    const br = g2(0.82, 0.1, ox, oy);
    const back = B(br[0], br[1] - 13, 0.18, 0.8, 36, "#1E1E2A", "#060610", "#101018");
    const backHi = B(br[0], br[1] - 45, 0.1, 0.8, 14, "rgba(80,80,110,0.35)", "transparent", "transparent");
    const hr = g2(0.82, 0.1, ox, oy);
    const headrest = B(hr[0], hr[1] - 49, 0.18, 0.5, 9, "#28283A", "#080818", "#141422");
    const ar1 = g2(0.1, 0.1, ox, oy);
    const arm1 = B(ar1[0], ar1[1] - 24, 0.18, 0.8, 5, "#D0D8E0", "#6A7880", "#8A9AA8");
    const ar2 = g2(0.8, 0.1, ox, oy);
    const arm2 = B(ar2[0], ar2[1] - 24, 0.02, 0.8, 5, "#D0D8E0", "#6A7880", "#8A9AA8");
    return star + gaslift + seat + sHi + back + backHi + headrest + arm1 + arm2;
  },
  icon:
    '<rect x="8" y="20" width="22" height="11" rx="2" fill="#282832" stroke="#101018" stroke-width="0.8"/>' +
    '<rect x="29" y="10" width="4" height="22" rx="2" fill="#1E1E2A"/>' +
    '<rect x="29" y="6" width="5" height="6" rx="2" fill="#28283A"/>' +
    '<rect x="8" y="20" width="3" height="11" rx="1" fill="#D0D8E0" opacity="0.7"/>' +
    '<circle cx="20" cy="35" r="6" fill="#1A1E28" opacity="0.7"/>',
};

export const archivero: ElementType = {
  key: "archivero",
  label: "Archivero",
  category: "mobiliario",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const body = B(ox, oy, 1, 1, 52, MAT.white.t, MAT.white.l, MAT.white.r);
    const bodyHi = specular(ox, oy, 1, 1);
    const colors = ["#4A90E2", "#10B981", "#F59E0B", "#EF4444"];
    let drawers = "";
    for (let i = 0; i < 4; i++) {
      const dOffset = i * 12.5;
      const d = g2(0.06, 0.06, ox, oy);
      const dr = B(d[0], d[1] - 52 + dOffset, 0.88, 0.06, 11, "#E0ECF4", MAT.steel.l, MAT.steel.r);
      const dh = g2(0.32, 0.06, ox, oy);
      const handle = B(dh[0], dh[1] - 56 + dOffset, 0.36, 0.04, 4, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
      const tabPos = g2(0.12, 0.06, ox, oy);
      const tab = rect(tabPos[0] + 2, tabPos[1] - 54 + dOffset, 12, 4, 1, colors[i], "none");
      drawers += dr + handle + tab;
    }
    return body + bodyHi + drawers;
  },
  icon:
    '<rect x="10" y="3" width="20" height="34" rx="2" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<rect x="11" y="8" width="18" height="5" rx="1" fill="#E0ECF4" stroke="#9AAAC0" stroke-width="0.5"/>' +
    '<rect x="11" y="16" width="18" height="5" rx="1" fill="#E0ECF4" stroke="#9AAAC0" stroke-width="0.5"/>' +
    '<rect x="11" y="24" width="18" height="5" rx="1" fill="#E0ECF4" stroke="#9AAAC0" stroke-width="0.5"/>' +
    '<rect x="13" y="9" width="6" height="3" rx="1" fill="#4A90E2"/>' +
    '<rect x="13" y="17" width="6" height="3" rx="1" fill="#10B981"/>' +
    '<rect x="13" y="25" width="6" height="3" rx="1" fill="#F59E0B"/>',
};

export const planta: ElementType = {
  key: "planta",
  label: "Planta",
  category: "mobiliario",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const pot = g2(0.28, 0.28, ox, oy);
    const potBase = B(pot[0], pot[1], 0.44, 0.44, 18, "#B85C28", "#7A2A08", "#9A3E14");
    const potTop = B(pot[0] - 2, pot[1] - 16, 0.5, 0.5, 5, "#C87040", "#8A3410", "#AA4E20");
    const soilPos = g2(0.3, 0.3, ox, oy);
    const soil = F(soilPos[0], soilPos[1] - 18, 0.4, 0.4, "#3D1E08");
    const fc = g2(0.5, 0.5, ox, oy);
    const cx = fc[0];
    const cy = fc[1] - 22;
    const leaf1 = ellipse(cx, cy - 20, 22, 14, "#16A34A", "rgba(0,80,30,0.3)", 0.5);
    const leaf2 = ellipse(cx + 8, cy - 28, 15, 10, "#22C55E", "rgba(0,100,40,0.2)", 0.5);
    const leaf3 = ellipse(cx - 8, cy - 26, 13, 9, "#15803D", "rgba(0,60,20,0.3)", 0.5);
    const leaf4 = ellipse(cx + 2, cy - 36, 10, 7, "#166534", "rgba(0,50,20,0.3)", 0.5);
    const vein1 = isoLine(cx, cy - 20, cx, cy - 34, "rgba(0,100,40,0.25)", 0.6);
    return potBase + potTop + soil + leaf1 + leaf2 + leaf3 + leaf4 + vein1;
  },
  icon:
    '<ellipse cx="20" cy="18" rx="13" ry="9" fill="#16A34A"/>' +
    '<ellipse cx="20" cy="13" rx="9" ry="7" fill="#22C55E"/>' +
    '<ellipse cx="24" cy="11" rx="7" ry="5" fill="#15803D"/>' +
    '<rect x="15" y="26" width="10" height="10" rx="2" fill="#B85C28"/>' +
    '<rect x="16" y="24" width="8" height="4" rx="1" fill="#C87040"/>',
};

export const tv: ElementType = {
  key: "tv",
  label: "Televisión",
  category: "mobiliario",
  w: 2,
  h: 1,
  draw: (ox, oy) => {
    const stPos = g2(0.85, 0, ox, oy);
    const stand = B(stPos[0], stPos[1], 0.3, 0.1, 14, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const tvB = B(ox - 3, oy - 14, 2.06, 0.14, 38, "#181820", "#060610", "#101018");
    const scrPos = g2(0.06, 0.02, ox, oy);
    const screen = B(scrPos[0], scrPos[1] - 14, 1.88, 0.1, 30, "rgba(40,80,160,0.88)", "#0A1030", "rgba(20,50,130,0.9)");
    const sp = g2(0.1, 0.03, ox, oy);
    const content = `<rect x="${sp[0]}" y="${sp[1] - 44}" width="36" height="24" rx="1" fill="rgba(74,144,226,0.25)"/>`;
    const content2 = `<rect x="${sp[0] + 2}" y="${sp[1] - 38}" width="14" height="3" rx="1" fill="rgba(255,255,255,0.15)"/>`;
    const content3 = `<rect x="${sp[0] + 2}" y="${sp[1] - 34}" width="22" height="2" rx="1" fill="rgba(255,255,255,0.10)"/>`;
    const led = g2(0.06, 0.13, ox, oy);
    const ledDot = circle(led[0] + 2, led[1] - 14, 2, "#10B981", "#0A7050");
    const refl = `<line x1="${sp[0] + 4}" y1="${sp[1] - 44}" x2="${sp[0] + 10}" y2="${sp[1] - 20}" stroke="rgba(255,255,255,0.07)" stroke-width="3"/>`;
    return stand + tvB + screen + content + content2 + content3 + refl + ledDot;
  },
  icon:
    '<rect x="3" y="9" width="34" height="20" rx="2" fill="#181820" stroke="#060610" stroke-width="0.8"/>' +
    '<rect x="5" y="11" width="30" height="16" rx="1" fill="rgba(40,80,160,0.9)"/>' +
    '<rect x="7" y="13" width="14" height="2" rx="1" fill="rgba(255,255,255,0.2)"/>' +
    '<rect x="7" y="17" width="20" height="2" rx="1" fill="rgba(255,255,255,0.12)"/>' +
    '<rect x="17" y="28" width="6" height="5" rx="1" fill="#282830"/>' +
    '<rect x="12" y="33" width="16" height="2" rx="1" fill="#181820"/>' +
    '<circle cx="6" cy="26" r="1.5" fill="#10B981"/>',
};

// ═══════════════════════════════════════════════════════
// BAÑO
// ═══════════════════════════════════════════════════════
export const inodoro: ElementType = {
  key: "inodoro",
  label: "Inodoro",
  category: "bano",
  w: 1,
  h: 2,
  draw: (ox, oy) => {
    const cis = g2(0.04, 0.04, ox, oy);
    const cistern = B(cis[0], cis[1], 0.88, 0.78, 26, MAT.white.t, MAT.white.l, MAT.white.r);
    const lid = B(cis[0] - 1, cis[1] - 25, 0.9, 0.8, 4, "#F8FAFC", "#C0D0E0", "#D4E0EE");
    const fb = g2(0.44, 0.42, ox, oy);
    const flush = B(fb[0], fb[1] - 28, 0.12, 0.12, 4, "#D0E0EE", "#8098B0", "#A0B8C8");
    const bowl = g2(0.02, 0.75, ox, oy);
    const bowlUnit = B(bowl[0], bowl[1], 0.96, 1.22, 20, MAT.white.t, MAT.white.l, MAT.white.r);
    const seat = g2(0.06, 0.78, ox, oy);
    const seatTop = F(seat[0], seat[1] - 20, 0.88, 1.14, "rgba(230,240,250,0.9)");
    const seatInner = g2(0.16, 0.88, ox, oy);
    const inner = F(seatInner[0], seatInner[1] - 20, 0.68, 0.94, "rgba(185,215,240,0.7)");
    const sh1 = g2(0.06, 0.76, ox, oy);
    const shine1 = isoLine(sh1[0] + 2, sh1[1] - 20, sh1[0] + 8, sh1[1] - 34, "rgba(255,255,255,0.5)", 1.5);
    const sh2 = g2(0.04, 0.06, ox, oy);
    const shine2 = isoLine(sh2[0] + 2, sh2[1] - 2, sh2[0] + 5, sh2[1] - 20, "rgba(255,255,255,0.4)", 1);
    return cistern + lid + flush + bowlUnit + seatTop + inner + shine1 + shine2;
  },
  icon:
    '<rect x="9" y="5" width="22" height="12" rx="2" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<rect x="9" y="5" width="22" height="4" rx="1" fill="#F8FAFC"/>' +
    '<ellipse cx="20" cy="26" rx="12" ry="9" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<ellipse cx="20" cy="26" rx="8" ry="6" fill="rgba(185,215,240,0.8)"/>' +
    '<rect x="18" y="16" width="4" height="4" rx="1" fill="#D0E0EE"/>',
};

export const lavabo_bano: ElementType = {
  key: "lavabo_bano",
  label: "Lavabo Baño",
  category: "bano",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const ped = g2(0.36, 0.36, ox, oy);
    const pedestal = B(ped[0], ped[1], 0.28, 0.28, 20, MAT.white.t, MAT.white.l, MAT.white.r);
    const ct = B(ox - 2, oy - 20, 1.04, 1.04, 5, "#F0F5FA", "#B0C4D4", "#C8D8E8");
    const bs = g2(0.12, 0.12, ox, oy);
    const basin = F(bs[0], bs[1] - 20, 0.76, 0.76, "#DCF0FA");
    const inner = g2(0.22, 0.22, ox, oy);
    const basinIn = F(inner[0], inner[1] - 20, 0.56, 0.56, "rgba(180,215,240,0.7)");
    const dn = g2(0.5, 0.5, ox, oy);
    const drain = circle(dn[0], dn[1] - 20, 3, "#9AAAC0", "#7080A0");
    const fp = g2(0.44, 0.14, ox, oy);
    const fBase = B(fp[0], fp[1] - 24, 0.12, 0.1, 8, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const fNeck = B(fp[0] + 1, fp[1] - 32, 0.08, 0.06, 16, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const fSpout = B(fp[0] - 4, fp[1] - 42, 0.28, 0.06, 4, MAT.chrome.t, MAT.chrome.l, MAT.chrome.r);
    const sh = g2(0.12, 0.12, ox, oy);
    const shine = isoLine(sh[0] + 2, sh[1] - 22, sh[0] + 6, sh[1] - 32, "rgba(255,255,255,0.45)", 1.2);
    return pedestal + ct + basin + basinIn + drain + fBase + fNeck + fSpout + shine;
  },
  icon:
    '<rect x="7" y="14" width="26" height="18" rx="3" fill="#EEF3F8" stroke="#A8B8CC" stroke-width="0.8"/>' +
    '<ellipse cx="20" cy="20" rx="9" ry="6" fill="#DCF0FA" stroke="#A0C8E0" stroke-width="0.8"/>' +
    '<ellipse cx="20" cy="20" rx="5" ry="3.5" fill="rgba(180,215,240,0.7)"/>' +
    '<rect x="18" y="8" width="3" height="9" rx="1.5" fill="#C8D8E4"/>' +
    '<rect x="14" y="30" width="3" height="5" rx="1" fill="#C0CCD8"/>' +
    '<rect x="23" y="30" width="3" height="5" rx="1" fill="#C0CCD8"/>',
};

export const puerta_bano: ElementType = {
  key: "puerta_bano",
  label: "Puerta Baño",
  category: "bano",
  w: 2,
  h: 1,
  draw: (ox, oy, opts) => {
    const isOpen = opts?.isOpen === true;
    const frame = B(ox, oy, 2, 0.18, 64, "#E8F0E0", "#7A9060", "#90A870");
    const p = g2(0, 0, ox, oy);
    if (isOpen) {
      const opW = 28;
      const opH = 52;
      const dx = p[0] + 6;
      const dy = p[1] - 56;
      const panelOpen = `<polygon points="${dx},${dy + opH} ${dx + opW * 0.3},${dy} ${dx + opW},${dy} ${dx + opW * 0.7},${dy + opH}" fill="rgba(210,240,200,0.5)" stroke="#7A9060" stroke-width="0.8"/>`;
      const handleOpen = circle(dx + opW * 0.55, dy + opH * 0.52, 2.5, "#C0B060", "#907030", 0.7);
      return frame + panelOpen + handleOpen;
    }
    const dX = p[0] + 6;
    const dY = p[1] - 56;
    const panel = rect(dX, dY, 34, 52, 1, "rgba(210,240,200,0.35)", "#7A9060", 0.8);
    const mp1 = rect(dX + 4, dY + 5, 26, 17, 1, "rgba(255,255,255,0.1)", "rgba(100,140,80,0.35)", 0.6);
    const mp2 = rect(dX + 4, dY + 26, 26, 22, 1, "rgba(255,255,255,0.1)", "rgba(100,140,80,0.35)", 0.6);
    const handle = rect(dX + 26, dY + 22, 4, 9, 2, "#C0B060", "#907030", 0.8);
    const knob = circle(dX + 28, dY + 27, 2.5, "#D0C070", "#907030", 0.8);
    return frame + panel + mp1 + mp2 + handle + knob;
  },
  icon:
    '<rect x="8" y="4" width="20" height="30" rx="1" fill="#A8C880" stroke="#7A9060" stroke-width="1.2"/>' +
    '<rect x="10" y="6" width="16" height="10" rx="1" fill="rgba(210,240,200,0.6)" stroke="rgba(100,140,80,0.4)" stroke-width="0.7"/>' +
    '<rect x="10" y="18" width="16" height="12" rx="1" fill="rgba(210,240,200,0.6)" stroke="rgba(100,140,80,0.4)" stroke-width="0.7"/>' +
    '<circle cx="24" cy="24" r="2.5" fill="#C0B060"/>',
};

/** Catálogo completo DENTAL (incluye estructura/recepción/mobiliario/baño universales). */
export const DENTAL_ELEMENT_TYPES: ElementType[] = [
  // estructura
  wall_h, wall_v, puerta, ventana,
  // dental
  sillon, rayosx, esterilizador, lavabo, gabinete, taburete,
  // recepcion
  mostrador, silla_espera, banca, mesa_centro,
  // mobiliario
  escritorio, silla_oficina, archivero, planta, tv,
  // baño
  inodoro, lavabo_bano, puerta_bano,
];
