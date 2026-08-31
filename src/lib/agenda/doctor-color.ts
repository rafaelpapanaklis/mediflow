export const DOCTOR_PALETTE = [
  "#7c3aed", "#2563eb", "#ea580c", "#0891b2",
  "#059669", "#db2777", "#9333ea", "#0284c7",
] as const;

export function doctorColorFor(id: string, fallback?: string | null): string {
  if (fallback) return fallback;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return DOCTOR_PALETTE[hash % DOCTOR_PALETTE.length];
}

export function doctorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const v = parseInt(m[1]!, 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  }
  const s = /^#?([0-9a-f]{3})$/i.exec(color.trim());
  if (s) {
    const [r, g, b] = s[1]!.split("");
    return [parseInt(r! + r, 16), parseInt(g! + g, 16), parseInt(b! + b, 16)];
  }
  return null;
}

/** Luminancia relativa WCAG 2.x de un color sRGB `#rrggbb` / `#rgb`. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG entre dos hex (1..21); null si alguno no parsea. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Tinta legible sobre un color de doctor elegido libremente por la clínica
 * (`users.color`): negro o blanco, el que dé más contraste. Es la salida al
 * "color que contra texto oscuro no se lee": con negro y blanco disponibles,
 * el mejor de los dos alcanza ≥4.5:1 para CUALQUIER color (el peor caso
 * teórico, L≈0.18, da ~4.58:1 — lo fija el test de slot-metrics). Tiene que
 * ser negro PURO: con un casi-negro como #14101F el peor caso cae a ~4.35 y
 * pierde AA. Son hex planos a propósito: el chip tiene el mismo fondo (el
 * color del doctor) en tema claro y oscuro, así que su tinta correcta
 * tampoco depende del tema.
 */
export function readableTextOn(color: string): "#000000" | "#FFFFFF" {
  const l = relativeLuminance(color);
  if (l === null) return "#FFFFFF"; // no-hex (p.ej. var(--brand), violeta oscuro)
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return contrastBlack >= contrastWhite ? "#000000" : "#FFFFFF";
}
