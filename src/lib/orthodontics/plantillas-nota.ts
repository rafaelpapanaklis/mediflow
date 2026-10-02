// Ortodoncia — plantillas de nota de la hoja de control, editables desde
// Administración → Plantillas (ws1-t5 · 10b, ticket 3 de BEVADENT). PURO: sin
// React ni Prisma, para que lo prueben los tests en node.
//
// No es un módulo nuevo: son las filas de `ClinicalEvolutionTemplate`
// (module = orthodontics) que ya lee el selector de la hoja de control
// (EvolutionTemplatePicker). Lo único nuevo es poder verlas, crearlas,
// editarlas y apagarlas desde Plantillas. Las seis de fábrica
// (seed-orthodontics.ts) NO se editan: se copian, y la copia es la que se
// edita, así la original nunca se pierde.

export const MAX_NOMBRE_NOTA = 80;
export const MAX_TEXTO_SECCION = 4000;

export const SECCIONES_SOAP = ["S", "O", "A", "P"] as const;
export type SeccionSoap = (typeof SECCIONES_SOAP)[number];
export type CuerpoSoap = Record<SeccionSoap, string>;

// ── Marcadores ───────────────────────────────────────────────────────────

export interface MarcadorNota {
  /** Lo que se escribe en el texto, con llaves dobles. */
  token: string;
  /** Clave i18n bajo `pages.plantillas.orto.marcadores`. */
  labelKey: string;
}

/**
 * Los marcadores que la hoja de control SABE rellenar (mes, duración, fase,
 * arco actual y arco nuevo). El test comprueba que cada uno de aquí lo
 * sustituye de verdad `rellenarMarcadores` (consulta-ortodoncia.ts), para que
 * esta lista no prometa uno que no funciona. Se declara aquí y no se importa
 * de allá a propósito: ese archivo es de la hoja de control.
 */
export const MARCADORES_NOTA: readonly MarcadorNota[] = [
  { token: "{{monthInTreatment}}", labelKey: "mes" },
  { token: "{{estimatedDurationMonths}}", labelKey: "duracion" },
  { token: "{{currentPhase}}", labelKey: "fase" },
  { token: "{{archWire}}", labelKey: "arcoActual" },
  { token: "{{newArchWire}}", labelKey: "arcoNuevo" },
];

const CLAVES_CONOCIDAS = new Set(MARCADORES_NOTA.map((m) => m.token.slice(2, -2)));

/** Los marcadores `{{así}}` del texto que la hoja NO conoce (quedarán como hueco ____). Sin repetidos. */
export function marcadoresDesconocidos(soap: Partial<CuerpoSoap>): string[] {
  const vistos = new Set<string>();
  for (const s of SECCIONES_SOAP) {
    for (const m of (soap[s] ?? "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
      if (!CLAVES_CONOCIDAS.has(m[1])) vistos.add(m[1]);
    }
  }
  return [...vistos];
}

// ── Nombre, de fábrica y copia ───────────────────────────────────────────

/** El nombre tal como se guarda y se compara: sin espacios de sobra. */
export function normalizarNombreNota(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

const comparable = (n: string) => normalizarNombreNota(n).toLocaleLowerCase("es");

/** ¿Es una de las plantillas de fábrica? Se reconoce por el nombre con que se siembran. */
export function esDeFabrica(nombre: string, nombresDeFabrica: readonly string[]): boolean {
  const q = comparable(nombre);
  return nombresDeFabrica.some((n) => comparable(n) === q);
}

/**
 * El nombre de una copia: «X (copia)», y «X (copia 2)»… si ya existe. `ocupados`
 * son TODOS los nombres de la clínica en este módulo (también los apagados: el
 * único de la base no distingue). Respeta el largo máximo recortando el
 * original, no el sufijo.
 */
export function nombreDeCopia(original: string, ocupados: readonly string[], sufijo = "copia"): string {
  const usados = new Set(ocupados.map(comparable));
  const base = normalizarNombreNota(original);
  for (let n = 1; n < 1000; n++) {
    const cola = ` (${sufijo}${n === 1 ? "" : ` ${n}`})`;
    const nombre = `${base.slice(0, MAX_NOMBRE_NOTA - cola.length).trimEnd()}${cola}`;
    if (!usados.has(comparable(nombre))) return nombre;
  }
  return `${base.slice(0, MAX_NOMBRE_NOTA - 12).trimEnd()} (${Date.now()})`.slice(0, MAX_NOMBRE_NOTA);
}

// ── Validación ───────────────────────────────────────────────────────────

export type CodigoErrorNota =
  | "NAME_REQUIRED"
  | "NAME_TOO_LONG"
  | "SOAP_INVALID"
  | "SOAP_EMPTY"
  | "SOAP_TOO_LONG"
  | "NAME_TAKEN"
  | "FACTORY_READONLY"
  | "NOT_FOUND"
  | "MODULE_REQUIRED";

export const ESTADO_DE_ERROR_NOTA: Record<CodigoErrorNota, number> = {
  NAME_REQUIRED: 400,
  NAME_TOO_LONG: 400,
  SOAP_INVALID: 400,
  SOAP_EMPTY: 400,
  SOAP_TOO_LONG: 400,
  NAME_TAKEN: 409,
  FACTORY_READONLY: 409,
  NOT_FOUND: 404,
  MODULE_REQUIRED: 403,
};

export function validarNombreNota(v: unknown): { nombre: string } | { codigo: CodigoErrorNota } {
  const nombre = normalizarNombreNota(v);
  if (!nombre) return { codigo: "NAME_REQUIRED" };
  if (nombre.length > MAX_NOMBRE_NOTA) return { codigo: "NAME_TOO_LONG" };
  return { nombre };
}

/**
 * El cuerpo SOAP que llega del cliente. Las cuatro secciones tienen que ser
 * texto; basta con que UNA tenga algo (la hoja exige el Plan al firmar, no la
 * plantilla). Los saltos de línea se conservan; los extremos se recortan.
 */
export function validarCuerpoNota(v: unknown): { soap: CuerpoSoap } | { codigo: CodigoErrorNota } {
  if (!v || typeof v !== "object") return { codigo: "SOAP_INVALID" };
  const o = v as Record<string, unknown>;
  const soap = {} as CuerpoSoap;
  for (const s of SECCIONES_SOAP) {
    const t = o[s];
    if (typeof t !== "string") return { codigo: "SOAP_INVALID" };
    if (t.length > MAX_TEXTO_SECCION) return { codigo: "SOAP_TOO_LONG" };
    soap[s] = t.replace(/\r\n/g, "\n").trim();
  }
  if (SECCIONES_SOAP.every((s) => soap[s] === "")) return { codigo: "SOAP_EMPTY" };
  return { soap };
}
