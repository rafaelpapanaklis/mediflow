// Ortodoncia — precio por TÉCNICA (ws1-t10, decisión 2 de Rafael). Puro: sin Prisma ni React.
// La clínica define una tabla { técnica → precio del tratamiento } y el alta del caso
// propone el precio de la técnica elegida (el usuario lo puede cambiar por paciente).

export const TECNICAS_ORTO = [
  { key: "METAL_BRACKETS", label: "Brackets metálicos" },
  { key: "CERAMIC_BRACKETS", label: "Brackets estéticos (cerámicos)" },
  { key: "SELF_LIGATING_METAL", label: "Autoligado metálico" },
  { key: "SELF_LIGATING_CERAMIC", label: "Autoligado estético" },
  { key: "LINGUAL_BRACKETS", label: "Brackets linguales" },
  { key: "CLEAR_ALIGNERS", label: "Alineadores transparentes" },
  { key: "HYBRID", label: "Mixto (brackets + alineadores)" },
] as const;

export type TecnicaOrto = (typeof TECNICAS_ORTO)[number]["key"];
export type PreciosPorTecnica = Partial<Record<TecnicaOrto, number>>;

const CLAVES = new Set<string>(TECNICAS_ORTO.map((t) => t.key));
export const PRECIO_MAXIMO = 10_000_000;

/** Solo técnicas conocidas con un precio finito y positivo, a centavos. Todo lo demás se ignora. */
export function normalizarPrecios(raw: unknown): PreciosPorTecnica {
  const out: PreciosPorTecnica = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!CLAVES.has(k)) continue;
    const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > PRECIO_MAXIMO) continue;
    out[k as TecnicaOrto] = Math.round(n * 100) / 100;
  }
  return out;
}

/** El precio de la técnica, o null si la clínica no lo definió. */
export function precioDeTecnica(precios: PreciosPorTecnica | null | undefined, tecnica: string): number | null {
  const p = precios?.[tecnica as TecnicaOrto];
  return typeof p === "number" && p > 0 ? p : null;
}

/**
 * Qué poner en «Costo total» al elegir/cambiar la técnica en el alta. Solo toca el
 * campo si está vacío o si todavía trae LO QUE ESTA TABLA propuso antes (una cifra que
 * el usuario tecleó, o la del presupuesto aceptado, no se pisa). `null` = no cambiar.
 */
export function costoAProponer(args: {
  actual: string;
  ultimoSugerido: string | null;
  precio: number | null;
  hayPresupuesto: boolean;
}): string | null {
  if (args.hayPresupuesto) return null;
  const vacio = args.actual.trim() === "";
  const eraSugerido = args.ultimoSugerido !== null && args.actual === args.ultimoSugerido;
  if (!vacio && !eraSugerido) return null;
  if (args.precio === null) return eraSugerido ? "" : null;
  const nuevo = String(args.precio);
  return nuevo === args.actual ? null : nuevo;
}
