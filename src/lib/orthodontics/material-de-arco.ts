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

// ws1-t12 (revisión en panel.108, fallo 4): todo lugar que muestra un arco dice de qué arcada es. Tras cambiar solo el
// superior quedaban dos filas «actual» («NiTi 014», «NiTi 016») sin decir cuál iba arriba y cuál abajo.

export type Arcada = "Superior" | "Inferior" | "Ambas";

/** Sin dato de arcada (o las dos en `false`, que la pantalla no permite) cuenta como las dos, igual que `secuencia-de-arcos`. */
export function arcadaDeArco(arco: { archUpper?: boolean | null; archLower?: boolean | null }): Arcada {
  const sup = arco.archUpper ?? true;
  const inf = arco.archLower ?? true;
  if (sup && !inf) return "Superior";
  if (inf && !sup) return "Inferior";
  return "Ambas";
}

/** «NiTi 016 · Superior». */
export function textoDeArcoConArcada(arco: {
  material: string;
  gauge: string;
  archUpper?: boolean | null;
  archLower?: boolean | null;
}): string {
  return `${textoDeArco(arco)} · ${arcadaDeArco(arco)}`;
}

type ArcoConId = { id: string; material: string; gauge: string };

/**
 * Lo que lleva puesto el paciente, una línea por arco: «NiTi 014 · Ambas» si es el mismo arriba y abajo, o
 * «NiTi 016 · Superior» y «NiTi 014 · Inferior» si son distintos. Vacío = sin arco registrado.
 */
export function lineasDeArcosActuales(arcos: { superior: ArcoConId | null; inferior: ArcoConId | null }): string[] {
  const { superior, inferior } = arcos;
  if (superior && inferior && superior.id === inferior.id) return [`${textoDeArco(superior)} · Ambas`];
  const lineas: string[] = [];
  if (superior) lineas.push(`${textoDeArco(superior)} · Superior`);
  if (inferior) lineas.push(`${textoDeArco(inferior)} · Inferior`);
  return lineas;
}

// Con `strict: false` TypeScript no estrecha por `ok`: las dos formas declaran los dos campos.
export type MaterialParaGuardar =
  | { ok: true; material: MaterialDeArco; error?: undefined; aviso?: string }
  | { ok: false; material?: undefined; error: string; aviso?: undefined };

/**
 * El valor que se guarda para lo que eligió el doctor. Acepta la clave del selector (`NITI_SUPER`…) o el valor guardado
 * (`SS`, `CR_CO`…). `enLaBase` dice si la base ya tiene los valores nuevos (`null` = no se sabe todavía: se trata como «no»).
 * Sin ellos:
 *   - un NiTi superelástico o termoactivado se guarda como «NiTi» (el material es ese; solo se pierde la variante) y
 *     `aviso` lo dice: la pantalla lo enseña (revisión en panel.108, fallo 5: antes se perdía sin decir nada). No se
 *     rechaza como Cr-Co porque NiTi superelástico es el material de entrada de los dos formularios y guardarlo como
 *     NiTi no es falso; la elección queda en la bitácora y el bloque 2 del SQL la recupera;
 *   - Multi-stranded y Cr-Co NO se guardan: guardarlos como acero era justo el error. Se avisa y se elige otro.
 */
export function materialParaGuardar(elegido: string, enLaBase: boolean | null): MaterialParaGuardar {
  const material =
    DE_LA_PANTALLA[elegido] ?? ((MATERIALES_DE_ARCO as readonly string[]).includes(elegido) ? (elegido as MaterialDeArco) : null);
  if (!material) return { ok: false, error: `Material no soportado: ${elegido}` };
  if (!MATERIALES_NUEVOS.has(material) || enLaBase) return { ok: true, material };
  if (material === "NITI_SUPERELASTIC" || material === "NITI_THERMAL") {
    return {
      ok: true,
      material: "NITI",
      aviso: `«${ETIQUETA_DE_MATERIAL[material]}» aún no está disponible: se guardó como «NiTi». Pide a soporte que lo active.`,
    };
  }
  return {
    ok: false,
    error: `«${ETIQUETA_DE_MATERIAL[material]}» aún no está disponible. Elige otro material o pide a soporte que lo active.`,
  };
}
