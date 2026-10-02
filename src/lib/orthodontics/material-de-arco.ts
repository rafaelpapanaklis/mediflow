// Ortodoncia — el material de un arco, de lo que elige el doctor a lo que se guarda y se pinta (ws1-t12, ticket BEVADENT
// punto 4d). PURO: lo usan la acción `addWireStep`, la ficha, la hoja de control y Sabina.
//
// Antes `MATERIAL_MAP` guardaba «Multi-stranded» y «Cr-Co (Elgiloy)» como «SS» (acero) y los tres NiTi como «NITI»: quien
// elegía Cr-Co veía después «SS». Ahora cada opción del selector tiene su valor en `OrthoWireMaterial`. Los cuatro valores
// nuevos los agrega `sql/ws1-t12-material-de-arco.sql`; mientras no estén en la base, `materialParaGuardar` decide qué hacer.

/** Los valores de `OrthoWireMaterial` (prisma/schema.prisma). */
export const MATERIALES_DE_ARCO = [
  "NITI",
  "NITI_SUPERELASTIC",
  "NITI_THERMAL",
  "SS",
  "TMA",
  "BETA_TITANIUM",
  "MULTISTRANDED",
  "CR_CO",
] as const;
export type MaterialDeArco = (typeof MATERIALES_DE_ARCO)[number];

/** Los que agrega el SQL de ws1-t12: una base sin pegarlo no los acepta. */
export const MATERIALES_NUEVOS: ReadonlySet<MaterialDeArco> = new Set(["NITI_SUPERELASTIC", "NITI_THERMAL", "MULTISTRANDED", "CR_CO"]);

/** Opción del selector (`WIRE_MATERIAL_OPTIONS`) → valor guardado. */
const DE_LA_PANTALLA: Record<string, MaterialDeArco> = {
  NITI_SUPER: "NITI_SUPERELASTIC",
  NITI_THERMO: "NITI_THERMAL",
  // «Convencional» es NiTi sin más: el valor de siempre.
  NITI_CONV: "NITI",
  SS: "SS",
  TMA: "TMA",
  MULTI: "MULTISTRANDED",
  CRCO: "CR_CO",
};

/** Cómo se dice cada material en la ficha, la hoja, el historial y Sabina («NiTi .014», «Cr-Co .016»). */
export const ETIQUETA_DE_MATERIAL: Record<MaterialDeArco, string> = {
  NITI: "NiTi",
  NITI_SUPERELASTIC: "NiTi superelástico",
  NITI_THERMAL: "NiTi termoactivado",
  SS: "SS",
  TMA: "TMA",
  BETA_TITANIUM: "β-Ti",
  MULTISTRANDED: "Multi-stranded",
  CR_CO: "Cr-Co",
};

export function etiquetaDeMaterial(material: string): string {
  return (ETIQUETA_DE_MATERIAL as Record<string, string>)[material] ?? material;
}

/** «NiTi 014»: el material y el calibre como los pinta la ficha. */
export function textoDeArco(arco: { material: string; gauge: string }): string {
  return `${etiquetaDeMaterial(arco.material)} ${arco.gauge}`;
}

// Con `strict: false` TypeScript no estrecha por `ok`: las dos formas declaran los dos campos.
export type MaterialParaGuardar =
  | { ok: true; material: MaterialDeArco; error?: undefined }
  | { ok: false; material?: undefined; error: string };

/**
 * El valor que se guarda para lo que eligió el doctor. Acepta la clave del selector (`NITI_SUPER`…) o el valor guardado
 * (`SS`, `CR_CO`…). `enLaBase` dice si la base ya tiene los valores nuevos (`null` = no se sabe todavía: se trata como «no»).
 * Sin ellos:
 *   - un NiTi superelástico o termoactivado se guarda como «NiTi» (el material es ese; solo se pierde la variante);
 *   - Multi-stranded y Cr-Co NO se guardan: guardarlos como acero era justo el error. Se avisa y se elige otro.
 */
export function materialParaGuardar(elegido: string, enLaBase: boolean | null): MaterialParaGuardar {
  const material =
    DE_LA_PANTALLA[elegido] ?? ((MATERIALES_DE_ARCO as readonly string[]).includes(elegido) ? (elegido as MaterialDeArco) : null);
  if (!material) return { ok: false, error: `Material no soportado: ${elegido}` };
  if (!MATERIALES_NUEVOS.has(material) || enLaBase) return { ok: true, material };
  if (material === "NITI_SUPERELASTIC" || material === "NITI_THERMAL") return { ok: true, material: "NITI" };
  return {
    ok: false,
    error: `«${ETIQUETA_DE_MATERIAL[material]}» aún no está disponible. Elige otro material o pide a soporte que lo active.`,
  };
}
