/**
 * Del hallazgo del odontograma al procedimiento del tarifario (ws1-t5, pieza P3 de la
 * investigación del plan nuevo). PURO: sin base, sin React, sin `server-only` — lo usan
 * la ventana del plan (cliente), `snapshot.ts` (servidor) y `aplicar-hecho.ts`.
 *
 * Aquí vive LA lista de las condiciones del odontograma (`odontogram-v2/data.ts`, 47 ids):
 * para cada una, si es un hallazgo por tratar y en qué fase, qué procedimiento se sugiere,
 * y qué cobra hoy «Completar consulta» cuando la marca aparece. Antes eran dos listas que se
 * contradecían con «Ausente» (`HALLAZGO_FASE` del plan y `CONDITION_TREATMENT_CODE` del
 * snapshot); ahora las dos se derivan de `CONDICIONES_CLINICAS`.
 *
 * El procedimiento se busca en el tarifario de ESA clínica: por la variante que el nombre
 * dice (resina «2 caras», endodoncia «birradicular»), por su llave `ODO_*`, o por nombre.
 * Si la clínica no lo tiene, la sugerencia sale sin precio y con `elegir: true`.
 */
import type { Fase, Hallazgo, Renglon } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { normalizar, type ProcedimientoDelTarifario } from "@/components/dashboard/plan-tratamiento-rediseno/buscar-tarifario";
import { classify } from "@/components/dashboard/odontogram-v2/data";
import { CLAVE_DE_MARCA } from "@/lib/odontogram/estado-marca";

/* ─────── Procedimientos que se sugieren o se reconocen ─────── */

export type ClaveProcedimiento =
  | "resina" | "incrustacion" | "endodoncia" | "retratamiento" | "pulpotomia" | "pulpectomia"
  | "corona" | "corona_acero" | "carilla" | "perno" | "extraccion" | "extraccion_quirurgica"
  | "implante" | "apicectomia" | "limpieza" | "raspado" | "sellante" | "fluor"
  | "ferulizacion" | "injerto_gingival" | "mantenedor";

/** Una fila por diente, una por cuadrante (raspado) o una para toda la boca (limpieza, flúor). */
export type Alcance = "diente" | "cuadrante" | "boca";

interface Procedimiento {
  /** Llave del odontograma en el tarifario (`DENTAL_CATALOG_SEED` de snapshot.ts), si la hay. */
  codigo: string | null;
  /** Nombre que se enseña cuando la clínica no lo tiene en su tarifario. */
  nombre: { es: string; en: string };
  /** Nombres del tarifario que SON este procedimiento (sobre el nombre normalizado). */
  incluye: RegExp;
  excluye?: RegExp;
  /** Nombres que se reconocen como este procedimiento al marcarlo hecho, pero que no se sugieren. */
  reconoce?: RegExp;
  alcance: Alcance;
  /** El tarifario suele tener variantes por número de caras o por raíces del diente. */
  variantes?: "caras" | "raices";
}

export const PROCEDIMIENTOS: Record<ClaveProcedimiento, Procedimiento> = {
  resina: {
    codigo: "ODO_RESINA", nombre: { es: "Restauración con resina", en: "Composite restoration" },
    incluye: /resina|restauracion|obturacion/, excluye: /provisional|temporal|ionomero|incrustacion|corona|carilla|implante/,
    reconoce: /amalgama/, alcance: "diente", variantes: "caras",
  },
  incrustacion: {
    codigo: null, nombre: { es: "Incrustación", en: "Inlay / onlay" },
    incluye: /incrustacion|inlay|onlay/, alcance: "diente",
  },
  endodoncia: {
    codigo: "ODO_ENDODONCIA", nombre: { es: "Endodoncia", en: "Root canal" },
    incluye: /endodoncia|conductos?\b/, excluye: /retrat|re-?endodoncia|reendodoncia|pulpotomia|pulpectomia|perno|poste/,
    alcance: "diente", variantes: "raices",
  },
  retratamiento: {
    codigo: null, nombre: { es: "Retratamiento de conductos", en: "Root canal retreatment" },
    incluye: /retratamiento|re-?tratamiento|re-?endodoncia|reendodoncia/, alcance: "diente", variantes: "raices",
  },
  pulpotomia: {
    codigo: null, nombre: { es: "Pulpotomía", en: "Pulpotomy" },
    incluye: /pulpotomia/, alcance: "diente",
  },
  pulpectomia: {
    codigo: null, nombre: { es: "Pulpectomía", en: "Pulpectomy" },
    incluye: /pulpectomia/, alcance: "diente",
  },
  corona: {
    codigo: "ODO_CORONA", nombre: { es: "Corona", en: "Crown" },
    incluye: /corona/, excluye: /acero|provisional|temporal|retiro|recementado|recementacion|alargamiento/,
    alcance: "diente",
  },
  corona_acero: {
    codigo: null, nombre: { es: "Corona de acero", en: "Stainless steel crown" },
    incluye: /corona.*acero|acero.*corona/, alcance: "diente",
  },
  carilla: {
    codigo: null, nombre: { es: "Carilla", en: "Veneer" },
    incluye: /carilla/, alcance: "diente",
  },
  perno: {
    codigo: null, nombre: { es: "Perno / muñón", en: "Post & core" },
    incluye: /perno|poste|munon/, alcance: "diente",
  },
  extraccion: {
    codigo: "ODO_EXTRACCION", nombre: { es: "Extracción", en: "Extraction" },
    incluye: /extraccion|exodoncia/, excluye: /quirurg|impactad|incluid|tercer|cordal|indicada/,
    alcance: "diente",
  },
  extraccion_quirurgica: {
    codigo: null, nombre: { es: "Extracción quirúrgica", en: "Surgical extraction" },
    incluye: /extraccion.*(quirurg|impactad|incluid|tercer|cordal)|odontectomia|cirugia.*(tercer|cordal|impactad|incluid)/,
    alcance: "diente",
  },
  implante: {
    codigo: "ODO_IMPLANTE", nombre: { es: "Implante dental", en: "Dental implant" },
    incluye: /implante/, excluye: /corona|aditamento|pilar|retiro|protesis/, alcance: "diente",
  },
  apicectomia: {
    codigo: null, nombre: { es: "Apicectomía", en: "Apicoectomy" },
    incluye: /apicectomia|apicoectomia/, alcance: "diente",
  },
  limpieza: {
    codigo: "ODO_LIMPIEZA", nombre: { es: "Limpieza dental", en: "Dental cleaning" },
    incluye: /limpieza|profilaxis|tartrectomia|detartraje/, excluye: /profunda|raspado|alisado|curetaje/,
    alcance: "boca",
  },
  raspado: {
    codigo: null, nombre: { es: "Raspado y alisado radicular", en: "Scaling and root planing" },
    incluye: /raspado|alisado|curetaje|limpieza profunda/, alcance: "cuadrante",
  },
  sellante: {
    codigo: null, nombre: { es: "Sellador de fosetas y fisuras", en: "Pit and fissure sealant" },
    incluye: /sellador|sellante/, alcance: "diente",
  },
  fluor: {
    codigo: null, nombre: { es: "Aplicación de flúor", en: "Fluoride application" },
    incluye: /fluor/, alcance: "boca",
  },
  ferulizacion: {
    codigo: null, nombre: { es: "Ferulización", en: "Splinting" },
    incluye: /ferulizacion|ferulizar/, alcance: "diente",
  },
  injerto_gingival: {
    codigo: null, nombre: { es: "Injerto gingival", en: "Gingival graft" },
    incluye: /injerto.*(gingival|encia|tejido|conectivo)/, excluye: /oseo/, alcance: "diente",
  },
  mantenedor: {
    codigo: null, nombre: { es: "Mantenedor de espacio", en: "Space maintainer" },
    incluye: /mantenedor/, alcance: "diente",
  },
};

/* ─────── LA lista: cada condición del odontograma ─────── */

/** Por qué una condición no lleva procedimiento sugerido. */
export type MotivoSinTratamiento =
  | "trabajo_hecho"   // restauración, corona, conducto, implante…: ya es tratamiento
  | "dato_clinico"    // se anota, no se trata por sí solo (pigmentación, rotado…)
  | "ortodoncia"      // aparatología o hallazgo que se lleva en el módulo de ortodoncia
  | "desconocida";    // un id que no está en el catálogo del odontograma

export interface CondicionClinica {
  /** Fase en la que se atiende como hallazgo POR TRATAR; null = no es un problema por tratar. */
  fase: Fase | null;
  /** Lo que se sugiere poner en el plan; null cuando `sinTratamiento` dice por qué. */
  sugiere: ClaveProcedimiento | null;
  /** Lo que se sugiere DESPUÉS (pulpitis → endodoncia → corona). */
  encadena?: ClaveProcedimiento[];
  /** La sugerencia es una de varias razonables: la pantalla la deja marcada para revisar. */
  revisar?: boolean;
  sinTratamiento?: MotivoSinTratamiento;
  /**
   * Lo que «Completar consulta» propone COBRAR cuando la marca aparece en el odontograma
   * (`changesToTreatments` de snapshot.ts). «Ausente» no lleva: ver `CONDICIONES_CLINICAS`.
   */
  cobroAlMarcar?: string;
}

const porTratar = (fase: Fase, sugiere: ClaveProcedimiento, extra: Partial<CondicionClinica> = {}): CondicionClinica =>
  ({ fase, sugiere, ...extra });
const sinTratar = (sinTratamiento: MotivoSinTratamiento, cobroAlMarcar?: string): CondicionClinica =>
  ({ fase: null, sugiere: null, sinTratamiento, ...(cobroAlMarcar ? { cobroAlMarcar } : {}) });

/**
 * Las 47 condiciones de `odontogram-v2/data.ts`. Las fases son las de siempre del plan
 * (`HALLAZGO_FASE`) y los cobros los del snapshot (`CONDITION_TREATMENT_CODE`).
 *
 * «Ausente» (`missing`) es un hueco por reponer para el plan (fase restauradora, se sugiere
 * implante para revisar) y, desde el 21-oct (decisión 6 de Rafael), YA NO se cobra al aparecer
 * en una consulta: un diente que ya faltaba no es una extracción de hoy. La extracción se cobra
 * con «Extracción realizada» (`ext_done`) o con la fila de extracción del plan.
 */
export const CONDICIONES_CLINICAS: Record<string, CondicionClinica> = {
  // ---- Diagnóstico ----
  caries:         porTratar("higienica", "resina"),
  caries_inc:     porTratar("higienica", "fluor"),
  pigmentation:   sinTratar("dato_clinico"),
  pulpitis:       porTratar("urgencia", "endodoncia", { encadena: ["corona"] }),
  necrosis:       porTratar("higienica", "endodoncia", { encadena: ["corona"] }),
  fracture:       porTratar("urgencia", "resina", { revisar: true }),
  missing:        porTratar("restauradora", "implante", { revisar: true }),
  periapical1:    porTratar("higienica", "endodoncia", { encadena: ["corona"] }),
  periapical2:    porTratar("higienica", "endodoncia", { encadena: ["corona"] }),
  periapical3:    porTratar("higienica", "endodoncia", { encadena: ["corona"] }),
  rotated:        sinTratar("dato_clinico"),
  displaced:      sinTratar("dato_clinico"),
  unerupted:      sinTratar("dato_clinico"),
  mobility:       porTratar("correctiva", "ferulizacion", { revisar: true }),

  // ---- Restauradora: trabajo hecho ----
  restoration:    sinTratar("trabajo_hecho", "ODO_RESINA"),
  temp_rest:      porTratar("higienica", "resina"),
  inlay:          sinTratar("trabajo_hecho"),
  crown:          sinTratar("trabajo_hecho", "ODO_CORONA"),
  veneer:         sinTratar("trabajo_hecho"),
  post_core:      sinTratar("trabajo_hecho"),
  bridge_pontic:  sinTratar("trabajo_hecho"),

  // ---- Endodoncia: trabajo hecho ----
  rct:            sinTratar("trabajo_hecho", "ODO_ENDODONCIA"),
  pulpotomy:      sinTratar("trabajo_hecho"),
  apexification:  sinTratar("trabajo_hecho"),
  retreatment:    sinTratar("trabajo_hecho"),

  // ---- Cirugía ----
  ext_indicated:  porTratar("higienica", "extraccion"),
  ext_done:       sinTratar("trabajo_hecho", "ODO_EXTRACCION"),
  implant:        sinTratar("trabajo_hecho", "ODO_IMPLANTE"),
  impacted:       porTratar("correctiva", "extraccion_quirurgica"),
  root_remnant:   porTratar("higienica", "extraccion"),
  apicoectomy:    sinTratar("trabajo_hecho"),

  // ---- Ortodoncia ----
  bracket:        sinTratar("ortodoncia"),
  band:           sinTratar("ortodoncia"),
  diastema:       sinTratar("ortodoncia"),
  migration:      sinTratar("ortodoncia"),

  // ---- Preventiva: trabajo hecho ----
  sealant:        sinTratar("trabajo_hecho"),
  fluoride:       sinTratar("trabajo_hecho"),
  prophylaxis:    sinTratar("trabajo_hecho"),

  // ---- Periodoncia ----
  calculus:       porTratar("higienica", "limpieza"),
  recession:      porTratar("correctiva", "injerto_gingival", { revisar: true }),
  pocket:         porTratar("higienica", "raspado"),
  bleeding:       porTratar("higienica", "limpieza"),
  furcation:      porTratar("correctiva", "raspado", { revisar: true }),
  perio_mobility: porTratar("correctiva", "ferulizacion", { revisar: true }),

  // ---- Odontopediatría: trabajo hecho ----
  steel_crown:    sinTratar("trabajo_hecho"),
  space_maint:    sinTratar("trabajo_hecho"),
  pulpotomy_ped:  sinTratar("trabajo_hecho"),
};

/** Hallazgo por tratar → fase (lo que usa `hallazgosPorTratar` del plan). */
export function fasesDeHallazgos(): Record<string, Fase> {
  const out: Record<string, Fase> = {};
  for (const [id, c] of Object.entries(CONDICIONES_CLINICAS)) if (c.fase) out[id] = c.fase;
  return out;
}

/** Condición que aparece en una consulta → código que se propone cobrar (lo que usa snapshot.ts). */
export function cobrosAlMarcar(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, c] of Object.entries(CONDICIONES_CLINICAS)) if (c.cobroAlMarcar) out[id] = c.cobroAlMarcar;
  return out;
}

/**
 * La fase de un procedimiento que el doctor marcó EN ROJO en el odontograma (ws1-t6): la misma en
 * la que el plan lo pone cuando lo sugiere un hallazgo (caries → resina, higiénica; la corona tras
 * la endodoncia, restauradora; ausente → implante, restauradora). DECISIÓN PARA RAFAEL (reporte
 * ws1-t6): el doctor la cambia en el renglón si no es esa.
 */
export const FASE_DE_PROCEDIMIENTO: Record<ClaveProcedimiento, Fase> = {
  resina: "higienica", incrustacion: "restauradora", endodoncia: "higienica", retratamiento: "higienica",
  pulpotomia: "urgencia", pulpectomia: "higienica", corona: "restauradora", corona_acero: "restauradora",
  carilla: "restauradora", perno: "restauradora", extraccion: "higienica", extraccion_quirurgica: "correctiva",
  implante: "restauradora", apicectomia: "correctiva", limpieza: "higienica", raspado: "higienica",
  sellante: "higienica", fluor: "higienica", ferulizacion: "correctiva", injerto_gingival: "correctiva",
  mantenedor: "correctiva",
};

/* ─────── Orden de fases (el de `FASES` del plan; la prueba lo vigila) ─────── */

export const ORDEN_FASE: Record<Fase, number> = {
  urgencia: 0, sistemica: 1, higienica: 2, correctiva: 3, restauradora: 4, mantenimiento: 5,
};

/* ─────── El tarifario ─────── */

/** Lo que trae `GET /api/procedures` y hace falta aquí. */
export interface ProcedimientoTarifario extends ProcedimientoDelTarifario {
  code?: string | null;
  category?: string | null;
  isActive?: boolean;
}

/** Cuántas caras dice el nombre: «resina 2 caras», «dos caras», «simple», «compuesta». */
export function carasDelNombre(nombre: string): number | null {
  const n = normalizar(nombre);
  const num = n.match(/\b(\d)\s*caras?\b/);
  if (num) return Number(num[1]);
  const palabras: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
  const pal = n.match(/\b(una|un|dos|tres|cuatro|cinco)\s+caras?\b/);
  if (pal) return palabras[pal[1]];
  if (/\bsimple\b/.test(n)) return 1;
  if (/\bcompuesta\b/.test(n)) return 2;
  if (/\bcompleja\b/.test(n)) return 3;
  return null;
}

type Raices = "uni" | "bi" | "multi";

/** Qué tipo de endodoncia dice el nombre: «unirradicular», «premolar», «molar», «3 conductos». */
export function raicesDelNombre(nombre: string): Raices | null {
  const n = normalizar(nombre);
  if (/birradicular|biradicular|\bpremolar|\b2 conductos|dos conductos/.test(n)) return "bi";
  if (/multirradicular|multiradicular|\bmolar|\b[34] conductos|tres conductos|cuatro conductos/.test(n)) return "multi";
  if (/unirradicular|uniradicular|anterior|incisivo|canino|\b1 conducto|un conducto/.test(n)) return "uni";
  return null;
}

/** La endodoncia que pide un diente: molar = multi; dos raíces = bi; el resto = uni. */
export function raicesDelDiente(fdi: number): Raices {
  const t = classify(fdi);
  if (t.type === "molar") return "multi";
  return t.roots >= 2 ? "bi" : "uni";
}

export interface EleccionTarifario {
  item: ProcedimientoTarifario | null;
  /** Hay más de un candidato razonable o la variante no es exacta. */
  revisar: boolean;
  /** Los otros candidatos (ids), por si la pantalla quiere ofrecerlos. */
  alternativas: string[];
}

const mejorPrimero = (a: ProcedimientoTarifario, b: ProcedimientoTarifario) =>
  Number(b.category === "dental") - Number(a.category === "dental")
  || normalizar(a.name).length - normalizar(b.name).length
  || normalizar(a.name).localeCompare(normalizar(b.name));

function candidatos(clave: ClaveProcedimiento, tarifario: ProcedimientoTarifario[]): ProcedimientoTarifario[] {
  const p = PROCEDIMIENTOS[clave];
  return tarifario
    .filter((t) => t.isActive !== false && t.name)
    .filter((t) => {
      const n = normalizar(t.name);
      return p.incluye.test(n) && !(p.excluye && p.excluye.test(n));
    })
    .sort(mejorPrimero);
}

/**
 * El procedimiento de ESA clínica para una clave: primero la variante que el nombre dice
 * (caras o raíces), luego la llave `ODO_*`, luego el mejor por nombre. Sin nada: `item: null`.
 */
export function elegirDelTarifario(
  clave: ClaveProcedimiento,
  tarifario: ProcedimientoTarifario[],
  donde: { diente?: number | null; caras?: number } = {},
): EleccionTarifario {
  const p = PROCEDIMIENTOS[clave];
  const cands = candidatos(clave, tarifario);
  const resto = (item: ProcedimientoTarifario) => cands.filter((c) => c.id !== item.id).map((c) => c.id);

  if (p.variantes === "caras") {
    const conCaras = cands.map((c) => ({ c, n: carasDelNombre(c.name) })).filter((x) => x.n != null) as { c: ProcedimientoTarifario; n: number }[];
    if (conCaras.length > 0) {
      const pide = Math.max(1, donde.caras ?? 1);
      const exactas = conCaras.filter((x) => x.n === pide);
      if (exactas.length > 0) return { item: exactas[0].c, revisar: exactas.length > 1, alternativas: resto(exactas[0].c) };
      // La más grande que no se pase; si todas se pasan, la más chica.
      const debajo = conCaras.filter((x) => x.n < pide).sort((a, b) => b.n - a.n);
      const elegida = debajo[0] ?? [...conCaras].sort((a, b) => a.n - b.n)[0];
      return { item: elegida.c, revisar: true, alternativas: resto(elegida.c) };
    }
  }
  if (p.variantes === "raices" && donde.diente != null) {
    const pide = raicesDelDiente(donde.diente);
    const conRaices = cands.filter((c) => raicesDelNombre(c.name) != null);
    if (conRaices.length > 0) {
      const exactas = conRaices.filter((c) => raicesDelNombre(c.name) === pide);
      if (exactas.length > 0) return { item: exactas[0], revisar: exactas.length > 1, alternativas: resto(exactas[0]) };
      return { item: conRaices[0], revisar: true, alternativas: resto(conRaices[0]) };
    }
  }
  if (p.codigo) {
    const porCodigo = tarifario.find((t) => t.isActive !== false && t.code === p.codigo);
    if (porCodigo) return { item: porCodigo, revisar: false, alternativas: cands.filter((c) => c.id !== porCodigo.id).map((c) => c.id) };
  }
  if (cands.length > 0) return { item: cands[0], revisar: cands.length > 1, alternativas: resto(cands[0]) };
  return { item: null, revisar: false, alternativas: [] };
}

/* ─────── Sugerencias ─────── */

/** Lo que entra: un hallazgo (como los de `hallazgosPorTratar`); `porHacer` = una marca ROJA. */
export type HallazgoParaSugerir = Pick<Hallazgo, "diente" | "caras" | "conditionId"> & Partial<Pick<Hallazgo, "porHacer">>;

/** Una fila propuesta para el plan. */
export interface Sugerencia {
  clave: ClaveProcedimiento;
  fase: Fase;
  /** Un diente, o los de un cuadrante / de la boca si el procedimiento es de ese alcance. */
  dientes: number[];
  /** Caras (letras de la base: M O D V L). */
  caras: string[];
  /** Los hallazgos que la piden: `"16:caries"`. */
  origen: string[];
  /** La sugerencia de la que sale (pulpitis → endodoncia → corona): null si la pide el hallazgo. */
  encadenadaDe: ClaveProcedimiento | null;
  /** Del tarifario de la clínica; null = no lo tiene. */
  procedimientoId: string | null;
  /** El nombre del tarifario, o el sugerido si no está. */
  nombre: string;
  nombreSugerido: { es: string; en: string };
  precio: number | null;
  minutos: number | null;
  cantidad: number;
  /** La clínica no lo tiene en su tarifario: la pantalla pide elegir. */
  elegir: boolean;
  /** Varias opciones razonables (variante no exacta, varios candidatos, o hallazgo ambiguo). */
  revisar: boolean;
  alternativas: string[];
}

export interface ResultadoHallazgo {
  sinTratamiento: MotivoSinTratamiento | null;
  sugerencias: Sugerencia[];
}

/** Un paso antes de ir al tarifario. */
interface Paso {
  clave: ClaveProcedimiento;
  fase: Fase;
  diente: number;
  caras: string[];
  origen: string;
  encadenadaDe: ClaveProcedimiento | null;
  revisar: boolean;
}

const ENDODONTICOS = new Set(["pulpitis", "necrosis", "periapical1", "periapical2", "periapical3"]);
const CARAS_BASE = ["M", "O", "D", "V", "L"];
const carasDeBase = (caras: string[]) =>
  CARAS_BASE.filter((c) => caras.some((x) => (x === "I" ? "O" : x.toUpperCase()) === c));

/**
 * Lo que pide un hallazgo, ajustado al diente:
 *  · diente temporal: pulpitis → pulpotomía, necrosis/periapical → pulpectomía; la corona
 *    encadenada es de acero;
 *  · lesión periapical o necrosis en un diente que YA tiene conducto → retratamiento;
 *  · no se encadena corona si el diente ya la tiene.
 */
function pasosDeHallazgo(h: HallazgoParaSugerir, condicionesDelDiente: string[]): Paso[] {
  if (h.porHacer) {
    // Marca roja (ws1-t6): el procedimiento ya lo decidió el doctor; sin encadenados.
    const clave = CLAVE_DE_MARCA[h.conditionId];
    if (!clave) return [];
    const caras = PROCEDIMIENTOS[clave].variantes === "caras" ? carasDeBase(h.caras) : [];
    return [{ clave, fase: FASE_DE_PROCEDIMIENTO[clave], diente: h.diente, caras, origen: `${h.diente}:${h.conditionId}`, encadenadaDe: null, revisar: false }];
  }
  const c = CONDICIONES_CLINICAS[h.conditionId];
  if (!c || !c.fase || !c.sugiere) return [];
  const temporal = classify(h.diente).primary;
  const origen = `${h.diente}:${h.conditionId}`;
  let clave = c.sugiere;
  let encadena = c.encadena ?? [];

  if (ENDODONTICOS.has(h.conditionId)) {
    if (temporal) {
      clave = h.conditionId === "pulpitis" ? "pulpotomia" : "pulpectomia";
      encadena = ["corona_acero"];
    } else if (h.conditionId !== "pulpitis" && condicionesDelDiente.includes("rct")) {
      clave = "retratamiento";
    }
    if (condicionesDelDiente.some((x) => x === "crown" || x === "steel_crown")) encadena = [];
  }

  const caras = PROCEDIMIENTOS[clave].variantes === "caras" ? carasDeBase(h.caras) : [];
  const pasos: Paso[] = [{ clave, fase: c.fase, diente: h.diente, caras, origen, encadenadaDe: null, revisar: !!c.revisar }];
  for (const sig of encadena) {
    pasos.push({ clave: sig, fase: "restauradora", diente: h.diente, caras: [], origen, encadenadaDe: clave, revisar: false });
  }
  return pasos;
}

function resolver(
  p: { clave: ClaveProcedimiento; fase: Fase; dientes: number[]; caras: string[]; origen: string[]; encadenadaDe: ClaveProcedimiento | null; revisar: boolean },
  tarifario: ProcedimientoTarifario[],
): Sugerencia {
  // Sin el procedimiento en el tarifario NO se cae a otro parecido (retratamiento → endodoncia,
  // quirúrgica → simple): saldría más barato de lo que es. Se pide elegir.
  const donde = { diente: p.dientes.length === 1 ? p.dientes[0] : null, caras: p.caras.length };
  const eleccion = elegirDelTarifario(p.clave, tarifario, donde);
  const item = eleccion.item;
  const sugerido = PROCEDIMIENTOS[p.clave].nombre;
  return {
    clave: p.clave,
    fase: p.fase,
    dientes: p.dientes,
    caras: p.caras,
    origen: p.origen,
    encadenadaDe: p.encadenadaDe,
    procedimientoId: item?.id ?? null,
    nombre: item?.name ?? sugerido.es,
    nombreSugerido: sugerido,
    precio: item ? item.basePrice : null,
    minutos: item ? item.duration ?? null : null,
    cantidad: 1,
    elegir: !item,
    revisar: p.revisar || eleccion.revisar,
    alternativas: eleccion.alternativas,
  };
}

/**
 * Condiciones del diente (de las entradas del odontograma), para ajustar la sugerencia. Lo marcado
 * EN ROJO todavía no está hecho (ws1-t6): un conducto rojo no hace «retratamiento», ni una corona roja
 * quita la corona encadenada.
 */
function condicionesPorDiente(entradas: { toothNumber: number; conditionId: string; estado?: string | null }[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const e of entradas) {
    if (e.estado === "por_hacer") continue;
    const l = m.get(e.toothNumber) ?? [];
    if (!l.includes(e.conditionId)) l.push(e.conditionId);
    m.set(e.toothNumber, l);
  }
  return m;
}

/**
 * La sugerencia de UN hallazgo (el toque en un chip): el procedimiento y los encadenados,
 * cada uno con precio y minutos del tarifario de la clínica. `entradas` es el odontograma del
 * paciente (para saber si el diente ya tiene conducto o corona); puede ir vacío.
 */
export function sugerirProcedimiento(
  h: HallazgoParaSugerir,
  tarifario: ProcedimientoTarifario[],
  entradas: { toothNumber: number; conditionId: string; estado?: string | null }[] = [],
): ResultadoHallazgo {
  const c = CONDICIONES_CLINICAS[h.conditionId];
  if (!c) return { sinTratamiento: "desconocida", sugerencias: [] };
  if (!c.sugiere && !(h.porHacer && CLAVE_DE_MARCA[h.conditionId])) return { sinTratamiento: c.sinTratamiento ?? "dato_clinico", sugerencias: [] };
  const delDiente = condicionesPorDiente(entradas).get(h.diente) ?? [];
  const sugerencias = pasosDeHallazgo(h, delDiente).map((p) => resolver({ ...p, dientes: [p.diente], origen: [p.origen] }, tarifario));
  return { sinTratamiento: null, sugerencias };
}

/**
 * El plan propuesto de TODOS los hallazgos, sin repetir: un procedimiento por diente (dos
 * hallazgos del mismo diente que piden endodoncia dan una; caries y restauración temporal del
 * mismo diente dan una resina con las caras juntas), uno por cuadrante para el raspado y uno
 * para toda la boca para limpieza y flúor. Ordenado por fase y diente.
 */
export function sugerirPlan(
  hallazgos: HallazgoParaSugerir[],
  tarifario: ProcedimientoTarifario[],
  entradas: { toothNumber: number; conditionId: string; estado?: string | null }[] = [],
): Sugerencia[] {
  const porDiente = condicionesPorDiente(entradas);
  type Grupo = { clave: ClaveProcedimiento; fase: Fase; dientes: number[]; caras: string[]; origen: string[]; encadenadaDe: ClaveProcedimiento | null; revisar: boolean };
  const grupos = new Map<string, Grupo>();
  for (const h of hallazgos) {
    for (const p of pasosDeHallazgo(h, porDiente.get(h.diente) ?? [])) {
      const alcance = PROCEDIMIENTOS[p.clave].alcance;
      const llave = alcance === "boca" ? p.clave
        : alcance === "cuadrante" ? `${p.clave}:q${Math.floor(p.diente / 10)}`
        : `${p.clave}:${p.diente}`;
      const g = grupos.get(llave);
      if (!g) {
        grupos.set(llave, { clave: p.clave, fase: p.fase, dientes: [p.diente], caras: [...p.caras], origen: [p.origen], encadenadaDe: p.encadenadaDe, revisar: p.revisar });
        continue;
      }
      if (!g.dientes.includes(p.diente)) g.dientes.push(p.diente);
      if (alcance === "diente") g.caras = carasDeBase([...g.caras, ...p.caras]);
      if (!g.origen.includes(p.origen)) g.origen.push(p.origen);
      if (ORDEN_FASE[p.fase] < ORDEN_FASE[g.fase]) g.fase = p.fase;
      if (p.encadenadaDe === null) g.encadenadaDe = null;
      g.revisar = g.revisar || p.revisar;
    }
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, dientes: [...g.dientes].sort((a, b) => a - b) }))
    .sort((a, b) => ORDEN_FASE[a.fase] - ORDEN_FASE[b.fase] || a.dientes[0] - b.dientes[0] || Number(a.encadenadaDe !== null) - Number(b.encadenadaDe !== null))
    .map((g) => resolver(g, tarifario));
}

/**
 * La sugerencia como renglón de la ventana de hoy («Nuevo plan»). Sin procedimiento en el
 * tarifario, el renglón lleva el nombre sugerido sin precio: la ventana ya avisa «no está en
 * tu tarifario» y deja elegir.
 */
export function sugerenciaARenglon(s: Sugerencia, opciones: { id: string; motivo: string; idioma?: "es" | "en" }): Renglon {
  return {
    id: opciones.id,
    fase: s.fase,
    procedimiento: s.procedimientoId ? s.nombre : s.nombreSugerido[opciones.idioma ?? "es"],
    procedimientoId: s.procedimientoId,
    dientes: s.dientes.join(", "),
    caras: s.caras,
    motivo: opciones.motivo,
    cantidad: String(s.cantidad),
    precio: s.precio != null ? String(s.precio) : "",
    precioDelTarifario: s.precio != null,
    minutos: s.minutos ?? 0,
    origen: [...s.origen],
    clave: s.clave,
    revisar: s.revisar,
  };
}

/* ─────── Del procedimiento hecho a su clave (lo usa aplicar-hecho.ts) ─────── */

const CLAVE_POR_CODIGO: Record<string, ClaveProcedimiento> = Object.fromEntries(
  (Object.entries(PROCEDIMIENTOS) as [ClaveProcedimiento, Procedimiento][])
    .filter(([, p]) => p.codigo)
    .map(([clave, p]) => [p.codigo as string, clave]),
);

/** Del más específico al más general: «corona de acero» antes que «corona». */
const ORDEN_RECONOCER: ClaveProcedimiento[] = [
  "corona_acero", "retratamiento", "pulpotomia", "pulpectomia", "apicectomia",
  "extraccion_quirurgica", "extraccion", "implante", "injerto_gingival", "ferulizacion",
  "raspado", "limpieza", "sellante", "fluor", "incrustacion", "carilla", "perno",
  "corona", "endodoncia", "mantenedor", "resina",
];

/**
 * Qué procedimiento es, por su llave `ODO_*` o por su nombre del tarifario / del renglón.
 * null = no se reconoce (blanqueamiento, consulta, radiografía…): no cambia el odontograma.
 */
export function claveDeProcedimiento(p: { codigo?: string | null; nombre?: string | null }): ClaveProcedimiento | null {
  if (p.codigo && CLAVE_POR_CODIGO[p.codigo]) return CLAVE_POR_CODIGO[p.codigo];
  const n = normalizar(p.nombre ?? "");
  if (!n) return null;
  for (const clave of ORDEN_RECONOCER) {
    const proc = PROCEDIMIENTOS[clave];
    const entra = proc.incluye.test(n) || !!proc.reconoce?.test(n);
    if (entra && !(proc.excluye && proc.excluye.test(n))) return clave;
  }
  return null;
}
