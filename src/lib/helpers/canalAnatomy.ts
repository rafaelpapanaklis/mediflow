// Endodontics — anatomía canalicular: defaults, categoría, mapeo SVG, colores. Spec §7

import type { CanalSvgArchetype, ToothCategory } from "@/lib/types/endodontics";

/**
 * Anatomía esperada por defecto según FDI. Vertucci 1984 simplificado.
 * El doctor puede ajustar manualmente desde el wizard si la anatomía
 * real difiere. Spec §7.6.
 */
export function defaultCanalsForFdi(fdi: number): string[] {
  // Centrales y laterales (incisivos): 1 conducto.
  if ([11, 12, 21, 22, 31, 32, 41, 42].includes(fdi)) return ["CONDUCTO_UNICO"];

  // Caninos: 1 conducto.
  if ([13, 23, 33, 43].includes(fdi)) return ["CONDUCTO_UNICO"];

  // Primeros premolares superiores (14, 24): frecuentemente 2 conductos (V + P).
  if ([14, 24].includes(fdi)) return ["V", "P"];

  // Segundos premolares superiores (15, 25): frecuentemente 1 conducto.
  if ([15, 25].includes(fdi)) return ["CONDUCTO_UNICO"];

  // Premolares inferiores: 1 conducto (alta variabilidad anatómica real).
  if ([34, 35, 44, 45].includes(fdi)) return ["CONDUCTO_UNICO"];

  // Primeros y segundos molares superiores: MB, MB2, DB, P (~60% tienen MB2).
  if ([16, 26, 17, 27].includes(fdi)) return ["MB", "MB2", "DB", "P"];

  // Tercer molar superior: anatomía variable, default 3 conductos.
  if ([18, 28].includes(fdi)) return ["MB", "DB", "P"];

  // Molares inferiores: MV, ML, D.
  if ([36, 46, 37, 47].includes(fdi)) return ["MV", "ML", "D"];

  // Tercer molar inferior: variable, default 3.
  if ([38, 48].includes(fdi)) return ["MV", "ML", "D"];

  return ["CONDUCTO_UNICO"];
}

/**
 * Categoriza el diente por familia. Útil para reportes (% éxito por
 * categoría de diente) y para elegir el SVG anatómico apropiado.
 * Spec §7.6.
 */
export function categorizeTooth(fdi: number): ToothCategory {
  const last = fdi % 10;
  if ([1, 2].includes(last)) return "incisor";
  if (last === 3) return "canine";
  if ([4, 5].includes(last)) {
    return fdi >= 30 ? "premolar_lower" : "premolar_upper";
  }
  return fdi >= 30 ? "molar_lower" : "molar_upper";
}

/**
 * Selecciona el archivo SVG anatómico que `<CanalMap />` debe cargar
 * para un FDI dado. Toma en cuenta variantes (premolar superior con 1 o
 * 2 conductos, molar inferior C-shape, etc.). El segundo parámetro
 * `actualCanals` ayuda a refinar: si el doctor registró 4 canales en un
 * molar superior, claramente es la variante con MB2.
 */
export function selectCanalSvg(args: {
  fdi: number;
  actualCanals?: string[];
}): CanalSvgArchetype {
  const { fdi, actualCanals } = args;
  const category = categorizeTooth(fdi);

  if (category === "incisor") return "incisor";
  if (category === "canine") return "canine";

  if (category === "premolar_upper") {
    // Si el doctor registró 2 canales, usa la variante de 2; si no,
    // usa el default por FDI (14/24 son 2-canal típicos).
    const canalsCount = actualCanals?.length ?? 0;
    if (canalsCount >= 2) return "premolar-upper-2canal";
    if (canalsCount === 1) return "premolar-upper-1canal";
    return [14, 24].includes(fdi) ? "premolar-upper-2canal" : "premolar-upper-1canal";
  }

  if (category === "premolar_lower") return "premolar-lower";

  if (category === "molar_upper") return "molar-upper-mb2";

  // Molar inferior: detecta C-shape si el doctor registró conductos con
  // los nombres especiales (sufijo "C_BUCCAL" / "C_LINGUAL"). Default
  // standard.
  const isCShape = actualCanals?.some(
    (c) => c.toUpperCase().includes("BUCCAL") || c.toUpperCase().includes("LINGUAL"),
  );
  return isCShape ? "molar-lower-cshape" : "molar-lower";
}

/**
 * Color hex por calidad de obturación. Aplicado al `fill` o `stroke` del
 * `<g id="canal-X">` correspondiente en el SVG cargado por `<CanalMap />`.
 * Spec §7.4.
 *
 * NOTA: estos hex son legales aquí (no son tokens de marca; son colores
 * clínicos estándar de un libro de texto). El SPEC los define explícitos.
 */
export const QUALITY_COLORS = {
  none:          "#3F3F46", // gris zinc-700 — sin obturar todavía
  HOMOGENEA:     "#22C55E", // verde-500 — ideal
  ADECUADA:      "#84CC16", // lima-500 — bien pero no perfecto
  CON_HUECOS:    "#EAB308", // ámbar-500 — aceptable, monitorear
  SOBREOBTURADA: "#EF4444", // rojo-500 — fuera del ápice
  SUBOBTURADA:   "#F97316", // naranja-500 — corto del ápice
} as const;

export type QualityColorKey = keyof typeof QUALITY_COLORS;

/**
 * Etiqueta visible (es-MX) para una calidad de obturación.
 */
export function labelQuality(q: string | null | undefined): string {
  if (!q) return "Sin obturar";
  const map: Record<string, string> = {
    HOMOGENEA: "Homogénea",
    ADECUADA: "Adecuada",
    CON_HUECOS: "Con huecos",
    SOBREOBTURADA: "Sobreobturada",
    SUBOBTURADA: "Subobturada",
  };
  return map[q] ?? q;
}

/**
 * Etiqueta humana (es-MX) para un nombre canónico de conducto.
 */
export function labelCanalCanonicalName(name: string): string {
  const map: Record<string, string> = {
    MB: "Mesiovestibular",
    MB2: "MB2",
    DB: "Distovestibular",
    MV: "Mesiovestibular",
    DV: "Distovestibular",
    MP: "Mesiopalatino",
    P: "Palatino",
    D: "Distal",
    M: "Mesial",
    L: "Lingual",
    V: "Vestibular",
    ML: "Mesiolingual",
    DL: "Distolingual",
    CONDUCTO_UNICO: "Conducto único",
    OTRO: "Otro",
  };
  return map[name] ?? name;
}

/**
 * Convierte un `canonicalName` del enum (`MB2`) al id correspondiente del
 * `<g>` en el SVG (`canal-mb2`). El SVG usa lowercase con guiones.
 */
export function canonicalNameToSvgId(name: string): string {
  return `canal-${name.toLowerCase().replace(/_/g, "-")}`;
}
