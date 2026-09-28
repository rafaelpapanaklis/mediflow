// H60: «Nueva consulta» pide clase molar, sobremordida, overjet y mordida, y el
// alta del caso pedía lo mismo otra vez. Aquí se lee lo que el doctor ya
// capturó en su última consulta (`specialtyData.occlusal`) para proponerlo en
// el diagnóstico del caso. PURO; todo es una propuesta editable.

export interface OclusionDeConsulta {
  angleClass: "CLASS_I" | "CLASS_II_DIV_1" | "CLASS_II_DIV_2" | "CLASS_III" | null;
  overbiteMm: number | null;
  overjetMm: number | null;
  crossbite: boolean;
  openBite: boolean;
}

const CLASE: Record<string, OclusionDeConsulta["angleClass"]> = {
  "Clase I": "CLASS_I",
  "Clase II div 1": "CLASS_II_DIV_1",
  "Clase II div 2": "CLASS_II_DIV_2",
  "Clase III": "CLASS_III",
};

function mm(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= -20 && n <= 30 ? n : null;
}

/** `null` si la consulta no trae nada útil de oclusión. */
export function oclusionDeLaConsulta(specialtyData: unknown): OclusionDeConsulta | null {
  if (!specialtyData || typeof specialtyData !== "object") return null;
  const o = (specialtyData as { occlusal?: unknown }).occlusal;
  if (!o || typeof o !== "object") return null;
  const { molarClass, bite, overbite, overjet } = o as Record<string, unknown>;
  const mordida = Array.isArray(bite) ? bite.filter((b): b is string => typeof b === "string") : [];
  const r: OclusionDeConsulta = {
    angleClass: typeof molarClass === "string" ? (CLASE[molarClass] ?? null) : null,
    overbiteMm: mm(overbite),
    overjetMm: mm(overjet),
    crossbite: mordida.some((b) => b.startsWith("Cruzada")),
    openBite: mordida.includes("Abierta anterior"),
  };
  const traeAlgo = r.angleClass || r.overbiteMm !== null || r.overjetMm !== null || r.crossbite || r.openBite;
  return traeAlgo ? r : null;
}
