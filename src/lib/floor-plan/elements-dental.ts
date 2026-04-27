/**
 * Catálogo de elementos para clínicas DENTAL.
 *
 * Migrado desde mockups/clinica-visual/.../mc-types.js.
 * Cada tipo tiene `draw(ox, oy)` que devuelve un fragmento SVG embebible y
 * `icon` para el sidebar (40×40).
 *
 * Otras categorías (AESTHETIC_MEDICINE, HAIR_SALON, etc.) se agregarán en
 * iteraciones posteriores; esta primera entrega cubre solo DENTAL más los
 * grupos universales (estructura, recepción, mobiliario, baño) que aplican
 * a casi cualquier clínica.
 */

import { box, flat, toScreen } from "./iso";
import type { ElementType } from "./element-types";

// Helpers internos para mantener parecida la API original (B/F/g2).
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
): string {
  return box(ox, oy, cw, rh, ph, { top: t, left: l, right: r, stroke: s });
}
function F(ox: number, oy: number, cw: number, rh: number, fill: string): string {
  return flat(ox, oy, cw, rh, fill, "rgba(0,0,0,0.05)");
}
function g2(col: number, row: number, ox: number, oy: number): [number, number] {
  return toScreen(col, row, ox, oy);
}

// ── ESTRUCTURA ───────────────────────────────────────
export const wall_h: ElementType = {
  key: "wall_h",
  label: "Pared Horiz.",
  category: "estructura",
  w: 4,
  h: 1,
  draw: (ox, oy) => B(ox, oy, 4, 0.22, 62, "#E2E8F5", "#8494C2", "#96A6D0"),
  icon:
    '<rect x="3" y="15" width="34" height="10" rx="2" fill="#96A6D0"/>' +
    '<rect x="3" y="10" width="34" height="6" rx="1" fill="#E2E8F5" opacity="0.9"/>',
};

export const wall_v: ElementType = {
  key: "wall_v",
  label: "Pared Vert.",
  category: "estructura",
  w: 1,
  h: 4,
  draw: (ox, oy) => B(ox, oy, 0.22, 4, 62, "#E2E8F5", "#8494C2", "#96A6D0"),
  icon:
    '<rect x="15" y="3" width="10" height="34" rx="2" fill="#96A6D0"/>' +
    '<rect x="9" y="3" width="7" height="34" rx="1" fill="#E2E8F5" opacity="0.9"/>',
};

export const puerta: ElementType = {
  key: "puerta",
  label: "Puerta",
  category: "estructura",
  w: 2,
  h: 1,
  draw: (ox, oy) => {
    const s = g2(0, 0, ox, oy);
    const frame = B(ox, oy, 2, 0.2, 64, "#F5EDD8", "#9B7730", "#B89040");
    const px = s[0] + 8;
    const py = s[1] - 54;
    const door = `<rect x="${px}" y="${py}" width="34" height="54" rx="1" fill="rgba(200,225,248,0.35)" stroke="#B89040" stroke-width="0.8"/>`;
    return frame + door;
  },
  icon:
    '<rect x="10" y="5" width="18" height="28" rx="1" fill="#C8B078" stroke="#9B7730" stroke-width="1.5"/>' +
    '<path d="M10 5 a18 18 0 0 1 18 18" fill="rgba(200,225,248,0.6)" stroke="#9B7730" stroke-width="1"/>' +
    '<circle cx="25" cy="19" r="2" fill="#9B7730"/>',
};

export const ventana: ElementType = {
  key: "ventana",
  label: "Ventana",
  category: "estructura",
  w: 2,
  h: 1,
  draw: (ox, oy) => {
    const wall = B(ox, oy, 2, 0.15, 64, "#D6DDF0", "#8494C2", "#96A6D0");
    const wx = g2(0.3, 0, ox, oy);
    const glass = B(
      wx[0],
      wx[1] - 20,
      1.4,
      0.1,
      35,
      "rgba(175,215,255,0.75)",
      "rgba(100,170,230,0.5)",
      "rgba(140,195,245,0.65)",
    );
    return wall + glass;
  },
  icon:
    '<rect x="4" y="11" width="32" height="18" rx="2" fill="#96A6D0"/>' +
    '<rect x="7" y="14" width="11" height="12" rx="1" fill="rgba(175,215,255,0.9)"/>' +
    '<rect x="22" y="14" width="11" height="12" rx="1" fill="rgba(175,215,255,0.9)"/>',
};

// ── EQUIPO DENTAL ─────────────────────────────────────
export const sillon: ElementType = {
  key: "sillon",
  label: "Sillón Dental",
  category: "dental",
  w: 2,
  h: 3,
  isChair: true,
  draw: (ox, oy) => {
    const base = B(ox, oy, 2, 3, 14, "#BCCFE6", "#6888B8", "#7A9CCE");
    const sc = g2(0.18, 0.3, ox, oy);
    const seat = B(sc[0], sc[1] - 14, 1.55, 1.5, 16, "#EEF5FC", "#A8C4DC", "#BDD4EA");
    const br = g2(1.55, 0.3, ox, oy);
    const back = B(br[0], br[1] - 14, 0.28, 1.5, 36, "#EEF5FC", "#A8C4DC", "#BDD4EA");
    const fr = g2(0.18, 1.65, ox, oy);
    const foot = B(fr[0], fr[1] - 14, 0.8, 0.8, 12, "#DCECf8", "#98BCDA", "#AECCE8");
    const lp = g2(1.72, 0.38, ox, oy);
    const pole = B(lp[0], lp[1] - 48, 0.13, 0.13, 42, "#F0C040", "#C08800", "#E0A800");
    const lh = g2(1.25, 0.36, ox, oy);
    const lamp = B(lh[0], lh[1] - 56, 0.7, 0.32, 13, "#FBBF24", "#C08800", "#EAA000");
    return base + seat + back + foot + pole + lamp;
  },
  icon:
    '<ellipse cx="20" cy="26" rx="14" ry="9" fill="#BCCFE6"/>' +
    '<rect x="8" y="14" width="22" height="14" rx="3" fill="#EEF5FC" stroke="#A8C4DC" stroke-width="1"/>' +
    '<rect x="28" y="8" width="4" height="20" rx="2" fill="#F0C040"/>' +
    '<ellipse cx="25" cy="8" rx="6" ry="3.5" fill="#FBBF24"/>',
};

export const rayosx: ElementType = {
  key: "rayosx",
  label: "Rayos X",
  category: "dental",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const unit = B(ox, oy, 2, 2, 22, "#C4D4E6", "#6080A8", "#7090BE");
    const arm = g2(0.9, 0.4, ox, oy);
    const pole = B(arm[0], arm[1] - 22, 0.18, 0.1, 48, "#3A80D2", "#1850A8", "#2870C0");
    const head = g2(0.5, 0.3, ox, oy);
    const hd = B(head[0], head[1] - 58, 0.9, 0.65, 18, "#1E5BAA", "#0C3A80", "#1A4E98");
    return unit + pole + hd;
  },
  icon:
    '<rect x="7" y="18" width="26" height="16" rx="3" fill="#6080A8"/>' +
    '<rect x="18" y="5" width="4" height="17" rx="2" fill="#3A80D2"/>' +
    '<rect x="11" y="3" width="18" height="8" rx="2" fill="#1E5BAA"/>',
};

export const esterilizador: ElementType = {
  key: "esterilizador",
  label: "Esterilizador",
  category: "dental",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 2, 2, 28, "#CED8E8", "#707C92", "#808CA4");
    const door = g2(0.15, 0.1, ox, oy);
    const d = B(door[0], door[1] - 14, 1.7, 0.12, 22, "#B8C8D8", "#60707E", "#70808E");
    const knob = g2(1.6, 0.1, ox, oy);
    const k = B(knob[0], knob[1] - 18, 0.2, 0.08, 10, "#4A90E2", "#1A60B2", "#2A70C8");
    return body + d + k;
  },
  icon:
    '<rect x="6" y="10" width="28" height="22" rx="3" fill="#808CA4"/>' +
    '<rect x="8" y="12" width="24" height="18" rx="2" fill="#CED8E8"/>' +
    '<circle cx="28" cy="22" r="3" fill="#4A90E2"/>' +
    '<rect x="10" y="19" width="14" height="3" rx="1" fill="#707C92"/>',
};

export const lavabo: ElementType = {
  key: "lavabo",
  label: "Lavabo Clínico",
  category: "dental",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const cab = B(ox, oy, 2, 2, 22, "#CCE0EE", "#6890AA", "#7AA0BC");
    const s = g2(0.25, 0.3, ox, oy);
    const bowl = F(s[0], s[1] - 22, 1.5, 1.1, "#E8F5FC");
    const tap = g2(0.9, 0.3, ox, oy);
    const t = B(tap[0], tap[1] - 24, 0.2, 0.1, 10, "#C8D8E4", "#88A8BC", "#A0C0D0");
    return cab + bowl + t;
  },
  icon:
    '<rect x="6" y="14" width="28" height="18" rx="3" fill="#7AA0BC"/>' +
    '<ellipse cx="20" cy="20" rx="11" ry="7" fill="#E8F5FC" stroke="#6890AA" stroke-width="1"/>' +
    '<rect x="18" y="10" width="4" height="8" rx="2" fill="#C8D8E4"/>',
};

export const gabinete: ElementType = {
  key: "gabinete",
  label: "Gabinete",
  category: "dental",
  w: 1,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 1, 2, 38, "#DCE6F0", "#7888A0", "#8898B2");
    const d1 = g2(0.06, 0.12, ox, oy);
    const dr1 = B(d1[0], d1[1] - 14, 0.88, 0.12, 11, "#C8D8E8", "#6878A0", "#7888B0");
    const d2 = g2(0.06, 0.65, ox, oy);
    const dr2 = B(d2[0], d2[1] - 14, 0.88, 0.12, 11, "#C8D8E8", "#6878A0", "#7888B0");
    return body + dr1 + dr2;
  },
  icon:
    '<rect x="10" y="6" width="20" height="30" rx="2" fill="#8898B2"/>' +
    '<rect x="11" y="14" width="18" height="7" rx="1" fill="#C8D8E8" stroke="#7888A0" stroke-width="0.5"/>' +
    '<rect x="11" y="23" width="18" height="7" rx="1" fill="#C8D8E8" stroke="#7888A0" stroke-width="0.5"/>' +
    '<circle cx="21" cy="17" r="1.5" fill="#4A90E2"/>' +
    '<circle cx="21" cy="26" r="1.5" fill="#4A90E2"/>',
};

export const taburete: ElementType = {
  key: "taburete",
  label: "Taburete",
  category: "dental",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const s = g2(0.22, 0.22, ox, oy);
    const seat = B(s[0], s[1] - 22, 0.56, 0.56, 9, "#4A90E2", "#1A60B2", "#2A70C8");
    const leg = g2(0.44, 0.44, ox, oy);
    const l = B(leg[0], leg[1] - 13, 0.14, 0.14, 24, "#8898B8", "#4858A0", "#5868B0");
    return l + seat;
  },
  icon:
    '<circle cx="20" cy="15" r="10" fill="#4A90E2"/>' +
    '<rect x="18" y="25" width="4" height="10" rx="2" fill="#6878B8"/>' +
    '<circle cx="20" cy="35" r="4" fill="#5060A8" opacity="0.7"/>',
};

// ── RECEPCIÓN ─────────────────────────────────────────
export const mostrador: ElementType = {
  key: "mostrador",
  label: "Mostrador",
  category: "recepcion",
  w: 4,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 4, 2, 32, "#EDE4D4", "#9A7A50", "#B09060");
    const top = B(ox, oy - 32, 4, 2, 8, "#FAF6EE", "#C0A070", "#D4B888");
    return body + top;
  },
  icon:
    '<rect x="4" y="18" width="32" height="14" rx="2" fill="#B09060"/>' +
    '<rect x="4" y="13" width="32" height="7" rx="1" fill="#FAF6EE" stroke="#C0A070" stroke-width="0.5"/>',
};

export const silla_espera: ElementType = {
  key: "silla_espera",
  label: "Silla Espera",
  category: "recepcion",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const seat = B(ox, oy, 1, 1, 9, "#4A90E2", "#1A60B2", "#2A70C8");
    const br = g2(0.72, 0.08, ox, oy);
    const back = B(br[0], br[1] - 9, 0.2, 0.84, 28, "#2A70C8", "#0A50A8", "#1860B8");
    return seat + back;
  },
  icon:
    '<rect x="8" y="20" width="22" height="11" rx="2" fill="#4A90E2"/>' +
    '<rect x="27" y="10" width="5" height="21" rx="2" fill="#2A70C8"/>',
};

export const banca: ElementType = {
  key: "banca",
  label: "Banca 3P",
  category: "recepcion",
  w: 3,
  h: 1,
  draw: (ox, oy) => {
    const seat = B(ox, oy, 3, 1, 9, "#4A90E2", "#1A60B2", "#2A70C8");
    const br = g2(2.72, 0.08, ox, oy);
    const back = B(br[0], br[1] - 9, 0.2, 0.84, 28, "#2A70C8", "#0A50A8", "#1860B8");
    return seat + back;
  },
  icon:
    '<rect x="4" y="21" width="32" height="10" rx="2" fill="#4A90E2"/>' +
    '<rect x="33" y="11" width="4" height="20" rx="2" fill="#2A70C8"/>' +
    '<line x1="14" y1="23" x2="14" y2="31" stroke="#1A60B2" stroke-width="1"/>' +
    '<line x1="24" y1="23" x2="24" y2="31" stroke="#1A60B2" stroke-width="1"/>',
};

export const mesa_centro: ElementType = {
  key: "mesa_centro",
  label: "Mesa Centro",
  category: "recepcion",
  w: 2,
  h: 2,
  draw: (ox, oy) => {
    const leg = (cx: number, cy: number) => {
      const p = g2(cx, cy, ox, oy);
      return B(p[0], p[1], 0.2, 0.2, 22, "#A07830", "#704800", "#906020");
    };
    const top = B(ox - 4, oy - 22, 2.08, 2.08, 6, "#DEB887", "#9B7030", "#B08040");
    return leg(0.12, 0.12) + leg(1.68, 0.12) + leg(0.12, 1.68) + leg(1.68, 1.68) + top;
  },
  icon:
    '<rect x="6" y="14" width="28" height="16" rx="2" fill="#DEB887" stroke="#9B7030" stroke-width="1"/>' +
    '<rect x="10" y="28" width="4" height="6" rx="1" fill="#9B7030"/>' +
    '<rect x="26" y="28" width="4" height="6" rx="1" fill="#9B7030"/>',
};

// ── MOBILIARIO ────────────────────────────────────────
export const escritorio: ElementType = {
  key: "escritorio",
  label: "Escritorio",
  category: "mobiliario",
  w: 3,
  h: 2,
  draw: (ox, oy) => {
    const body = B(ox, oy, 3, 2, 28, "#EDE4D4", "#9A7A50", "#B09060");
    const top = B(ox, oy - 28, 3, 2, 6, "#FAF6EE", "#B8987A", "#CAAA8A");
    const drw = g2(0.08, 0.08, ox, oy);
    const dr = B(drw[0], drw[1] - 28, 0.9, 0.1, 13, "#E4DAC8", "#9A7A50", "#B09060");
    return body + top + dr;
  },
  icon:
    '<rect x="4" y="16" width="32" height="16" rx="2" fill="#B09060"/>' +
    '<rect x="4" y="11" width="32" height="7" rx="1" fill="#FAF6EE" stroke="#B8987A" stroke-width="0.5"/>' +
    '<rect x="5" y="25" width="14" height="7" rx="1" fill="#9A7A50"/>',
};

export const silla_oficina: ElementType = {
  key: "silla_oficina",
  label: "Silla Oficina",
  category: "mobiliario",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const seat = B(ox, oy, 1, 1, 9, "#3A3A3A", "#1A1A1A", "#282828");
    const br = g2(0.72, 0.08, ox, oy);
    const back = B(br[0], br[1] - 9, 0.18, 0.84, 32, "#282828", "#121212", "#202020");
    const b = g2(0.5, 0.5, ox, oy);
    const base = `<circle cx="${b[0]}" cy="${b[1] + 10}" r="14" fill="#1A1A1A" opacity="0.5"/>`;
    return base + seat + back;
  },
  icon:
    '<rect x="8" y="20" width="22" height="10" rx="2" fill="#3A3A3A"/>' +
    '<rect x="28" y="10" width="4" height="20" rx="2" fill="#282828"/>' +
    '<circle cx="20" cy="34" r="6" fill="#1A1A1A" opacity="0.8"/>',
};

export const archivero: ElementType = {
  key: "archivero",
  label: "Archivero",
  category: "mobiliario",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const body = B(ox, oy, 1, 1, 48, "#CBD4E0", "#7080A0", "#8090B4");
    const drawer = (yOffset: number) => {
      const p = g2(0.06, 0.06, ox, oy);
      return B(p[0], p[1] - yOffset, 0.88, 0.12, 12, "#B8C8DA", "#6070A0", "#7080B0");
    };
    return body + drawer(16) + drawer(30) + drawer(44);
  },
  icon:
    '<rect x="10" y="5" width="20" height="32" rx="2" fill="#8090B4"/>' +
    '<rect x="11" y="11" width="18" height="5" rx="1" fill="#B8C8DA"/>' +
    '<rect x="11" y="19" width="18" height="5" rx="1" fill="#B8C8DA"/>' +
    '<rect x="11" y="27" width="18" height="5" rx="1" fill="#B8C8DA"/>' +
    '<circle cx="23" cy="13" r="1" fill="#4A90E2"/>' +
    '<circle cx="23" cy="21" r="1" fill="#4A90E2"/>' +
    '<circle cx="23" cy="29" r="1" fill="#4A90E2"/>',
};

export const planta: ElementType = {
  key: "planta",
  label: "Planta",
  category: "mobiliario",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const pot = g2(0.3, 0.3, ox, oy);
    const p = B(pot[0], pot[1], 0.4, 0.4, 20, "#7D5A28", "#4A3010", "#6A4A1A");
    const c = g2(0.5, 0.5, ox, oy);
    const f1 = `<ellipse cx="${c[0]}" cy="${c[1] - 20}" rx="22" ry="16" fill="#22C55E" opacity="0.92"/>`;
    const f2 = `<ellipse cx="${c[0] + 6}" cy="${c[1] - 32}" rx="15" ry="11" fill="#16A34A" opacity="0.95"/>`;
    const f3 = `<ellipse cx="${c[0] - 6}" cy="${c[1] - 30}" rx="12" ry="9" fill="#15803D"/>`;
    return p + f1 + f2 + f3;
  },
  icon:
    '<ellipse cx="20" cy="15" rx="13" ry="10" fill="#22C55E"/>' +
    '<ellipse cx="20" cy="11" rx="9" ry="7" fill="#16A34A"/>' +
    '<rect x="16" y="25" width="8" height="10" rx="2" fill="#7D5A28"/>',
};

export const tv: ElementType = {
  key: "tv",
  label: "Televisión",
  category: "mobiliario",
  w: 2,
  h: 1,
  draw: (ox, oy) => {
    const frame = B(ox, oy - 15, 2, 0.12, 46, "#181818", "#080808", "#121212");
    const scr = B(ox + 4, oy - 18, 1.8, 0.08, 36, "rgba(40,100,210,0.85)", "#080818", "#101828");
    const base = g2(0.8, 0, ox, oy);
    const bs = B(base[0], base[1], 0.4, 0.08, 18, "#282828", "#101010", "#181818");
    return bs + frame + scr;
  },
  icon:
    '<rect x="5" y="8" width="30" height="20" rx="2" fill="#181818"/>' +
    '<rect x="7" y="10" width="26" height="16" rx="1" fill="#4A90E2" opacity="0.9"/>' +
    '<rect x="17" y="28" width="6" height="4" fill="#282828"/>' +
    '<rect x="12" y="32" width="16" height="2" rx="1" fill="#282828"/>',
};

// ── BAÑO ─────────────────────────────────────────────
export const inodoro: ElementType = {
  key: "inodoro",
  label: "Inodoro",
  category: "bano",
  w: 1,
  h: 2,
  draw: (ox, oy) => {
    const cistern = B(ox, oy, 0.9, 0.8, 24, "#DDE8F0", "#8098AE", "#90A8C0");
    const bowlS = g2(0.05, 0.7, ox, oy);
    const bowl = B(bowlS[0], bowlS[1] - 24, 1, 1.3, 22, "#E8F0F8", "#90A8C0", "#A0B8D0");
    const inner = g2(0.15, 0.82, ox, oy);
    const hole = F(inner[0], inner[1] - 22, 0.7, 1.0, "#C8DCF0");
    return cistern + bowl + hole;
  },
  icon:
    '<rect x="9" y="5" width="22" height="12" rx="2" fill="#DDE8F0" stroke="#8098AE" stroke-width="1"/>' +
    '<ellipse cx="20" cy="26" rx="12" ry="10" fill="#E8F0F8" stroke="#8098AE" stroke-width="1"/>' +
    '<ellipse cx="20" cy="26" rx="8" ry="6" fill="#C8DCF0"/>',
};

export const lavabo_bano: ElementType = {
  key: "lavabo_bano",
  label: "Lavabo Baño",
  category: "bano",
  w: 1,
  h: 1,
  draw: (ox, oy) => {
    const cab = B(ox, oy, 1, 1, 22, "#CDE0EE", "#6890AA", "#7AA0BC");
    const s = g2(0.1, 0.1, ox, oy);
    const bowl = F(s[0], s[1] - 22, 0.8, 0.8, "#EAF5FC");
    const tap = g2(0.4, 0.1, ox, oy);
    const t = B(tap[0], tap[1] - 24, 0.18, 0.08, 12, "#D0E0EC", "#7898B0", "#90B0C8");
    return cab + bowl + t;
  },
  icon:
    '<rect x="8" y="14" width="24" height="18" rx="3" fill="#7AA0BC"/>' +
    '<ellipse cx="20" cy="20" rx="9" ry="6" fill="#EAF5FC" stroke="#6890AA" stroke-width="1"/>' +
    '<circle cx="20" cy="20" r="1.5" fill="#6890AA"/>',
};

export const puerta_bano: ElementType = {
  key: "puerta_bano",
  label: "Puerta Baño",
  category: "bano",
  w: 2,
  h: 1,
  draw: (ox, oy) => {
    const frame = B(ox, oy, 2, 0.18, 64, "#F0E8D4", "#9B7730", "#B08940");
    const px = g2(0.12, 0, ox, oy);
    const panel = B(
      px[0],
      px[1] - 10,
      1.76,
      0.14,
      44,
      "rgba(195,225,248,0.35)",
      "rgba(0,80,160,0.08)",
      "rgba(0,100,200,0.12)",
    );
    return frame + panel;
  },
  icon:
    '<rect x="8" y="5" width="18" height="28" rx="1" fill="#C8B078" stroke="#9B7730" stroke-width="1.5"/>' +
    '<path d="M8 5 a18 18 0 0 1 18 18" fill="rgba(195,225,248,0.6)" stroke="#9B7730" stroke-width="1"/>' +
    '<circle cx="23" cy="18" r="2" fill="#9B7730"/>',
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
