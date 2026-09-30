// Ortodoncia — qué plantillas de nota se ofrecen en la hoja según la técnica del caso (ws1-t10). PURO.
// Las seis plantillas de ortodoncia se ofrecían todas siempre: en un caso de brackets salía «Cambio de alineador», y en
// uno de alineadores «Cementado de brackets». Solo se apartan las que son de una sola familia; «Control mensual
// general», «Entrega de retenedor» y las plantillas propias de la clínica se ofrecen siempre.

type Familia = "alineadores" | "fija";

/** Las plantillas de fábrica que son de una sola familia de aparatología (por su procedimiento, o su nombre si no lo trae). */
const PROCEDIMIENTO_DE: Record<string, Familia> = {
  entrega_alineadores: "alineadores",
  cementado_brackets: "fija",
  activacion_arco: "fija",
  retiro_brackets: "fija",
};
const NOMBRE_DE: Record<string, Familia> = {
  "cambio de alineador": "alineadores",
  "cementado de brackets": "fija",
  "activación de arco": "fija",
  "retiro de brackets": "fija",
};

function familiaDeLaPlantilla(p: { name: string; proceduresPrefilled?: readonly string[] | null }): Familia | null {
  for (const proc of p.proceduresPrefilled ?? []) {
    const f = PROCEDIMIENTO_DE[proc];
    if (f) return f;
  }
  return NOMBRE_DE[p.name.trim().toLowerCase()] ?? null;
}

/**
 * ¿Se ofrece esta plantilla en un caso de esta técnica (`OrthoTechnique`)? Sin técnica conocida y en la mixta
 * (HYBRID) se ofrecen todas.
 */
export function plantillaAplicaALaTecnica(
  plantilla: { name: string; proceduresPrefilled?: readonly string[] | null },
  tecnica: string | null | undefined,
): boolean {
  if (!tecnica || tecnica === "HYBRID") return true;
  const familia = familiaDeLaPlantilla(plantilla);
  if (!familia) return true;
  return tecnica === "CLEAR_ALIGNERS" ? familia === "alineadores" : familia === "fija";
}
