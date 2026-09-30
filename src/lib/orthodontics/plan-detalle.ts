// Ortodoncia — «Plan de tratamiento» COMPLETO del caso (ws1-t12, como Dentalink) y todo lo que se
// conecta con él. PURO: sin Prisma, sin React y sin `Date.now()` implícito; lo prueban los tests en node.
//
// DÓNDE VIVE. Lo que el caso ya tenía sigue en sus columnas (técnica, duración, anclaje general,
// extracciones indicadas, IPR/TADs sí-no). Lo nuevo va en UNA columna JSONB,
// `orthodontic_treatment_plans."planDetalle"` (sql/ortodoncia-plan-de-tratamiento.sql), NUNCA declarada en
// schema.prisma: con una columna de menos, cualquier lectura del plan (decenas de sitios) tiraría P2022.
// Se lee y se escribe por SQL crudo con sonda (plan-detalle-db.ts). Sin la columna, el caso se ve como
// siempre y «Editar plan» dice que falta pegar el SQL.
//
// LISTAS POR CLÍNICA. Brackets, alineadores, placas, aditamentos, prescripciones y tipos de cementación
// son editables por clínica (orthodontics_clinic_settings."planOptions"). El plan guarda el TEXTO elegido,
// no un id: «quitar» una opción solo deja de ofrecerla en planes nuevos; los casos viejos conservan su texto.

// ─── Enumeraciones fijas ────────────────────────────────────────────────

export const ANCLAJES = [
  { key: "ABSOLUTO", label: "Absoluto" },
  { key: "MAXIMO", label: "Máximo" },
  { key: "MEDIO", label: "Medio" },
  { key: "MINIMO", label: "Mínimo" },
  { key: "MINIMO_ABSOLUTO", label: "Mínimo absoluto" },
] as const;
export type AnclajeArcada = (typeof ANCLAJES)[number]["key"];
const CLAVES_ANCLAJE = new Set<string>(ANCLAJES.map((a) => a.key));
export const etiquetaDeAnclaje = (k: AnclajeArcada | null | undefined): string =>
  ANCLAJES.find((a) => a.key === k)?.label ?? "";

export const RADIOGRAFIAS = [
  { key: "PANORAMICA", label: "Panorámica" },
  { key: "TELE", label: "Tele" },
  { key: "MANO", label: "Mano" },
  { key: "ATM_POST_DEPROGRAMACION", label: "Scanner ATM post deprogramación" },
] as const;
export type TipoRadiografia = (typeof RADIOGRAFIAS)[number]["key"];
const CLAVES_RADIOGRAFIA = new Set<string>(RADIOGRAFIAS.map((r) => r.key));
export const etiquetaDeRadiografia = (k: TipoRadiografia): string => RADIOGRAFIAS.find((r) => r.key === k)?.label ?? k;

/**
 * Qué categoría de archivo del paciente (`PatientFile.category`) es cada radiografía TIPIFICADA. Solo la
 * panorámica y la tele (lateral de cráneo) lo están; «Mano» y «Scanner ATM» no tienen categoría propia:
 * su periodicidad se cuenta desde el inicio del caso.
 */
export const CATEGORIA_DE_ARCHIVO: Partial<Record<TipoRadiografia, string>> = {
  PANORAMICA: "XRAY_PANORAMIC",
  TELE: "XRAY_CEPHALOMETRIC",
};

export const CONTROLES_MAXIMOS = 120;
export const ALINEADORES_MAXIMOS = 200;
export const PERIODICIDAD_MAXIMA_MESES = 60;
export const TEXTO_MAXIMO = 80;
export const INTERCONSULTAS_MAXIMO = 1000;
export const ELEGIDOS_MAXIMOS = 30;

// ─── Listas editables por clínica ───────────────────────────────────────

export const LISTAS_DEL_PLAN = ["aditamentos", "brackets", "alineadores", "placas", "prescripciones", "cementaciones"] as const;
export type ListaDelPlan = (typeof LISTAS_DEL_PLAN)[number];

export const ROTULO_DE_LISTA: Record<ListaDelPlan, string> = {
  aditamentos: "Aditamentos",
  brackets: "Brackets",
  alineadores: "Alineadores",
  placas: "Placas",
  prescripciones: "Prescripciones (tubos y bandas)",
  cementaciones: "Tipos de cementación",
};

export const AYUDA_DE_LISTA: Record<ListaDelPlan, string> = {
  aditamentos: "Microtornillos, miniplacas, barra palatina…",
  brackets: "Marcas y prescripciones de brackets.",
  alineadores: "Sistemas de alineadores y sus variantes.",
  placas: "Placas, planos y disyuntores.",
  prescripciones: "Lo que se elige en tubos y bandas: Roth, MBT…",
  cementaciones: "Cómo se cementa cada zona: corona clínica…",
};

export interface OpcionDelPlan {
  /** Estable: las de ejemplo usan «d-…»; las propias, «c-…». Solo sirve de llave en pantalla. */
  id: string;
  nombre: string;
  /** false = «quitada»: no se ofrece en planes nuevos, los casos que ya la usan conservan su texto. */
  activa: boolean;
}
export type OpcionesDelPlan = Record<ListaDelPlan, OpcionDelPlan[]>;

export const OPCIONES_MAXIMAS_POR_LISTA = 60;

/** Las listas de ejemplo: las de Dentalink. La clínica las edita en Configuración. */
export const OPCIONES_DE_EJEMPLO: Record<ListaDelPlan, readonly string[]> = {
  aditamentos: ["Microtornillos", "Miniplacas", "IZG", "Bucal Shelf", "Barra Palatina", "SPP inferior", "Topes"],
  brackets: [
    "Inovation Roth",
    "Inovation CCO",
    "Ovation Roth",
    "Ovation C Roth",
    "Ovation Supertorque",
    "Innovation C CCO",
    "Innovation C Roth",
    "MBT",
    "Face",
    "Damon",
    "Mini implante",
  ],
  alineadores: [
    "Invisalign express single",
    "Invisalign express dual",
    "Invisalign lite single",
    "Invisalign lite dual",
    "Invisalign comprehensive",
    "Invisalign first",
    "Invisalign Fase 2",
    "Invisalign Vivera",
  ],
  placas: [
    "Plano superior",
    "Plano inferior deprogramación",
    "Placa simple superior",
    "Placa simple inferior",
    "Placa superior con planos laterales y resorte de protrusión",
    "Asa continua superior",
    "Disyuntor cementado con planos laterales",
    "Disyuntor Moon",
  ],
  prescripciones: ["Roth", "MBT", "Damon"],
  cementaciones: ["Corona clínica"],
};

/** Nombre de una opción: una línea, sin espacios de más, recortado. "" si no queda nada. */
export function limpiarTexto(raw: unknown, max: number = TEXTO_MAXIMO): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

const clave = (t: string): string => sinAcentos(t).toLowerCase();

/** Sin acentos ni mayúsculas, solo letras y números separados por un espacio: para comparar textos. */
export function sinAcentos(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function slug(t: string): string {
  return clave(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "x";
}

export function opcionesDeEjemplo(): OpcionesDelPlan {
  const out = {} as OpcionesDelPlan;
  for (const l of LISTAS_DEL_PLAN) {
    out[l] = OPCIONES_DE_EJEMPLO[l].map((nombre) => ({ id: `d-${slug(nombre)}`, nombre, activa: true }));
  }
  return out;
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;

function normalizarLista(raw: unknown): OpcionDelPlan[] | null {
  if (!Array.isArray(raw)) return null;
  const vistos = new Set<string>();
  const ids = new Set<string>();
  const out: OpcionDelPlan[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const nombre = limpiarTexto(o.nombre);
    if (!nombre) continue;
    const k = clave(nombre);
    if (vistos.has(k)) continue;
    let id = typeof o.id === "string" ? o.id.trim() : "";
    if (!ID_VALIDO.test(id) || ids.has(id)) id = `c-${slug(nombre)}-${out.length}`;
    vistos.add(k);
    ids.add(id);
    out.push({ id, nombre, activa: o.activa !== false });
    if (out.length >= OPCIONES_MAXIMAS_POR_LISTA) break;
  }
  return out;
}

/**
 * Lo que llega de la base o del cliente → las seis listas. Una lista que falta o no es lista se siembra con
 * las de ejemplo (la clínica nunca editó esa); una lista guardada vacía SÍ se respeta (la clínica quitó todo).
 */
export function normalizarOpciones(raw: unknown): OpcionesDelPlan {
  const base = opcionesDeEjemplo();
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as OpcionesDelPlan;
  for (const l of LISTAS_DEL_PLAN) out[l] = normalizarLista(o[l]) ?? base[l];
  return out;
}

/** ¿La clínica ya guardó alguna lista propia? (false = se ven las de ejemplo). */
export function opcionesEditadas(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return LISTAS_DEL_PLAN.some((l) => Array.isArray((raw as Record<string, unknown>)[l]));
}

export function nombresActivos(lista: readonly OpcionDelPlan[]): string[] {
  return lista.filter((o) => o.activa).map((o) => o.nombre);
}

/** Id nuevo para una opción propia; `azar` (0..1) viene del cliente. */
export function idNuevoDeOpcion(existentes: readonly OpcionDelPlan[], azar: number = Math.random()): string {
  const usados = new Set(existentes.map((o) => o.id));
  let n = Math.floor(azar * 36 ** 6);
  for (let i = 0; i < 1000; i++, n++) {
    const id = `c-${n.toString(36).padStart(6, "0")}`;
    if (!usados.has(id)) return id;
  }
  return `c-${Date.now().toString(36)}`;
}

/** Mensaje para quien edita las listas, o null si se pueden guardar. */
export function validarOpciones(opciones: Partial<Record<ListaDelPlan, ReadonlyArray<{ nombre: string }>>>): string | null {
  for (const l of LISTAS_DEL_PLAN) {
    const lista = opciones[l] ?? [];
    if (lista.length > OPCIONES_MAXIMAS_POR_LISTA) return `«${ROTULO_DE_LISTA[l]}»: máximo ${OPCIONES_MAXIMAS_POR_LISTA} opciones.`;
    const vistos = new Set<string>();
    for (const o of lista) {
      const nombre = limpiarTexto(o.nombre);
      if (!nombre) return `«${ROTULO_DE_LISTA[l]}»: cada opción necesita un nombre.`;
      const k = clave(nombre);
      if (vistos.has(k)) return `«${ROTULO_DE_LISTA[l]}»: «${nombre}» está repetida.`;
      vistos.add(k);
    }
  }
  return null;
}

/** ¿Falta alguna de las de ejemplo en esta lista (quitada, desactivada o borrada)? → se ofrece «Restaurar». */
export function faltanDeEjemplo(l: ListaDelPlan, lista: readonly OpcionDelPlan[]): boolean {
  return OPCIONES_DE_EJEMPLO[l].some((n) => {
    const x = lista.find((o) => clave(o.nombre) === clave(n));
    return !x || !x.activa;
  });
}

/** Devuelve las de ejemplo (las reactiva o las repone al final); conserva las propias. */
export function restaurarDeEjemplo(l: ListaDelPlan, lista: readonly OpcionDelPlan[]): OpcionDelPlan[] {
  const out = lista.map((o) =>
    OPCIONES_DE_EJEMPLO[l].some((n) => clave(n) === clave(o.nombre)) ? { ...o, activa: true } : { ...o },
  );
  const ids = new Set(out.map((o) => o.id));
  for (const n of OPCIONES_DE_EJEMPLO[l]) {
    if (out.some((o) => clave(o.nombre) === clave(n))) continue;
    let id = `d-${slug(n)}`;
    if (ids.has(id)) id = `${id}-${out.length}`;
    ids.add(id);
    out.push({ id, nombre: n, activa: true });
  }
  return out;
}

/**
 * Lo que se OFRECE al editar un plan: las opciones activas de la clínica y, al final, lo que el caso ya
 * tiene elegido aunque la clínica ya no lo ofrezca (con `quitada`), para no perderlo sin querer.
 */
export function opcionesParaElegir(
  lista: readonly OpcionDelPlan[],
  yaElegidas: readonly string[],
): Array<{ nombre: string; quitada: boolean }> {
  const activas = lista.filter((o) => o.activa).map((o) => ({ nombre: o.nombre, quitada: false }));
  const conocidas = new Set(activas.map((o) => clave(o.nombre)));
  const extra: Array<{ nombre: string; quitada: boolean }> = [];
  for (const n of yaElegidas) {
    const t = limpiarTexto(n);
    if (!t || conocidas.has(clave(t))) continue;
    conocidas.add(clave(t));
    extra.push({ nombre: t, quitada: true });
  }
  return [...activas, ...extra];
}

// ─── El plan ────────────────────────────────────────────────────────────

export const PLAN_DETALLE_VERSION = 1;

/**
 * Datos del plan que la base exige (duración NOT NULL con CHECK, objetivos NOT NULL) y que al abrir el caso pueden
 * quedar SIN CAPTURAR: se guarda un valor neutro (18 meses / «estéticos y funcionales») y se ANOTA aquí que no es un
 * dato real, igual que `sinCapturar` del diagnóstico. Ausente o vacío = capturados (los casos de antes de esta marca
 * se leen como capturados: no se puede saber).
 */
export const DATOS_DEL_PLAN_QUE_PUEDEN_FALTAR = ["duracion", "objetivos"] as const;
export type DatoDelPlanQuePuedeFaltar = (typeof DATOS_DEL_PLAN_QUE_PUEDEN_FALTAR)[number];
/** Los valores neutros que se guardan en las columnas NOT NULL cuando el dato queda sin capturar. */
export const DURACION_NEUTRA_MESES = 18;
export const OBJETIVOS_NEUTROS = "AESTHETIC_AND_FUNCTIONAL";

export interface PlanDetalle {
  v: number;
  /** Cantidad de controles previstos en todo el tratamiento. */
  controlesPrevistos: number | null;
  /**
   * Alineadores totales. Un solo dato: si el caso ya tiene seguimiento de alineadores, manda
   * `orthodontic_aligners.totalTrays` y aquí queda null (ver plan-detalle-guardar.ts).
   */
  alineadoresTotales: number | null;
  anclajeSuperior: AnclajeArcada | null;
  anclajeInferior: AnclajeArcada | null;
  aditamentos: string[];
  /** Piezas (FDI) ya extraídas. Las indicadas siguen en `extractionsTeethFdi`. */
  extraccionesRealizadas: number[];
  controlRadiografico: TipoRadiografia[];
  periodicidadMeses: number | null;
  /** "YYYY-MM-DD" */
  reevaluacion: string | null;
  brackets: string[];
  alineadores: string[];
  placas: string[];
  tubosSuperiores: string | null;
  tubosInferiores: string | null;
  bandasSuperiores: string | null;
  bandasInferiores: string | null;
  cementacionSuperiorAnterior: string | null;
  cementacionSuperiorPosterior: string | null;
  cementacionInferiorAnterior: string | null;
  cementacionInferiorPosterior: string | null;
  interconsultas: string | null;
  /** Datos guardados como relleno neutro: no son un dato real. Ausente = todos capturados. No cuenta como «dato del plan». */
  sinCapturar?: DatoDelPlanQuePuedeFaltar[];
  /**
   * El anclaje GENERAL («Moderado» incluido) lo eligió quien abrió el caso a propósito (el asistente viejo, que lo pide).
   * Sin esta marca, un «Moderado» sin detalle por arcada es el relleno de arranque y no se dice como dato.
   */
  anclajeGeneralElegido?: true;
}

export function planDetalleVacio(): PlanDetalle {
  return {
    v: PLAN_DETALLE_VERSION,
    controlesPrevistos: null,
    alineadoresTotales: null,
    anclajeSuperior: null,
    anclajeInferior: null,
    aditamentos: [],
    extraccionesRealizadas: [],
    controlRadiografico: [],
    periodicidadMeses: null,
    reevaluacion: null,
    brackets: [],
    alineadores: [],
    placas: [],
    tubosSuperiores: null,
    tubosInferiores: null,
    bandasSuperiores: null,
    bandasInferiores: null,
    cementacionSuperiorAnterior: null,
    cementacionSuperiorPosterior: null,
    cementacionInferiorAnterior: null,
    cementacionInferiorPosterior: null,
    interconsultas: null,
  };
}

/** Las columnas de una sola opción (select) del plan. */
export const CAMPOS_DE_UNA_OPCION = [
  { campo: "tubosSuperiores", lista: "prescripciones", etiqueta: "Tubos superiores" },
  { campo: "tubosInferiores", lista: "prescripciones", etiqueta: "Tubos inferiores" },
  { campo: "bandasSuperiores", lista: "prescripciones", etiqueta: "Bandas superiores" },
  { campo: "bandasInferiores", lista: "prescripciones", etiqueta: "Bandas inferiores" },
  { campo: "cementacionSuperiorAnterior", lista: "cementaciones", etiqueta: "Cementación superior anterior" },
  { campo: "cementacionSuperiorPosterior", lista: "cementaciones", etiqueta: "Cementación superior posterior" },
  { campo: "cementacionInferiorAnterior", lista: "cementaciones", etiqueta: "Cementación inferior anterior" },
  { campo: "cementacionInferiorPosterior", lista: "cementaciones", etiqueta: "Cementación inferior posterior" },
] as const;
export type CampoDeUnaOpcion = (typeof CAMPOS_DE_UNA_OPCION)[number]["campo"];

/** Las de varias opciones (casillas). */
export const CAMPOS_DE_VARIAS = [
  { campo: "aditamentos", lista: "aditamentos", etiqueta: "Aditamentos" },
  { campo: "brackets", lista: "brackets", etiqueta: "Brackets" },
  { campo: "alineadores", lista: "alineadores", etiqueta: "Alineadores" },
  { campo: "placas", lista: "placas", etiqueta: "Placas" },
] as const;
export type CampoDeVarias = (typeof CAMPOS_DE_VARIAS)[number]["campo"];

// ─── FDI ────────────────────────────────────────────────────────────────

/** Permanentes 11-18, 21-28, 31-38, 41-48 y temporales 51-55, 61-65, 71-75, 81-85. */
export function esFdiValido(n: unknown): n is number {
  if (typeof n !== "number" || !Number.isInteger(n)) return false;
  const cuadrante = Math.floor(n / 10);
  const pieza = n % 10;
  if (cuadrante >= 1 && cuadrante <= 4) return pieza >= 1 && pieza <= 8;
  if (cuadrante >= 5 && cuadrante <= 8) return pieza >= 1 && pieza <= 5;
  return false;
}

/** «14, 24;34 44» → piezas válidas, sin repetir y en orden de FDI; lo que no sirve se devuelve aparte. */
export function leerFdi(texto: string): { validos: number[]; invalidos: string[] } {
  const partes = texto.split(/[\s,;.\/-]+/).map((p) => p.trim()).filter(Boolean);
  const validos = new Set<number>();
  const invalidos: string[] = [];
  for (const p of partes) {
    const n = /^\d{2}$/.test(p) ? Number(p) : NaN;
    if (esFdiValido(n)) validos.add(n);
    else if (!invalidos.includes(p)) invalidos.push(p);
  }
  return { validos: ordenarFdi(Array.from(validos)), invalidos };
}

export function ordenarFdi(piezas: readonly number[]): number[] {
  return Array.from(new Set(piezas)).sort((a, b) => a - b);
}

export const textoFdi = (piezas: readonly number[]): string => ordenarFdi(piezas).join(", ");

// ─── Lectura leniente (lo que viene de la base) y estricta (lo que llega del cliente) ────────────

function entero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** "YYYY-MM-DD" real (no 2026-02-31), o null. */
export function fechaIsoValida(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1990 || y > 2100) return null;
  const f = new Date(Date.UTC(y, mo - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d ? v.trim() : null;
}

function textos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const t = limpiarTexto(x);
    if (!t || vistos.has(clave(t))) continue;
    vistos.add(clave(t));
    out.push(t);
    if (out.length >= ELEGIDOS_MAXIMOS) break;
  }
  return out;
}

function unTexto(v: unknown): string | null {
  return limpiarTexto(v) || null;
}

/** Lo que llega de la base → un plan limpio. NUNCA lanza: descarta lo que no sirve. */
export function normalizarPlanDetalle(raw: unknown): PlanDetalle {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const plan = planDetalleVacio();
  plan.controlesPrevistos = entero(o.controlesPrevistos, 1, CONTROLES_MAXIMOS);
  plan.alineadoresTotales = entero(o.alineadoresTotales, 1, ALINEADORES_MAXIMOS);
  plan.anclajeSuperior = typeof o.anclajeSuperior === "string" && CLAVES_ANCLAJE.has(o.anclajeSuperior) ? (o.anclajeSuperior as AnclajeArcada) : null;
  plan.anclajeInferior = typeof o.anclajeInferior === "string" && CLAVES_ANCLAJE.has(o.anclajeInferior) ? (o.anclajeInferior as AnclajeArcada) : null;
  plan.aditamentos = textos(o.aditamentos);
  plan.extraccionesRealizadas = Array.isArray(o.extraccionesRealizadas) ? ordenarFdi(o.extraccionesRealizadas.filter(esFdiValido)) : [];
  plan.controlRadiografico = Array.isArray(o.controlRadiografico)
    ? RADIOGRAFIAS.map((r) => r.key).filter((k) => (o.controlRadiografico as unknown[]).includes(k))
    : [];
  plan.periodicidadMeses = entero(o.periodicidadMeses, 1, PERIODICIDAD_MAXIMA_MESES);
  plan.reevaluacion = fechaIsoValida(o.reevaluacion);
  plan.brackets = textos(o.brackets);
  plan.alineadores = textos(o.alineadores);
  plan.placas = textos(o.placas);
  for (const c of CAMPOS_DE_UNA_OPCION) plan[c.campo] = unTexto(o[c.campo]);
  plan.interconsultas = typeof o.interconsultas === "string" && o.interconsultas.trim() ? o.interconsultas.trim().slice(0, INTERCONSULTAS_MAXIMO) : null;
  const faltan = Array.isArray(o.sinCapturar)
    ? DATOS_DEL_PLAN_QUE_PUEDEN_FALTAR.filter((k) => (o.sinCapturar as unknown[]).includes(k))
    : [];
  if (faltan.length > 0) plan.sinCapturar = [...faltan];
  if (o.anclajeGeneralElegido === true) plan.anclajeGeneralElegido = true;
  return plan;
}

/** ¿Este dato del plan está guardado como relleno («sin capturar») y no como un dato real? */
export function datoDelPlanSinCapturar(detalle: Pick<PlanDetalle, "sinCapturar"> | null | undefined, dato: DatoDelPlanQuePuedeFaltar): boolean {
  return Boolean(detalle?.sinCapturar?.includes(dato));
}

/** Las marcas no son datos del plan: un plan con solo marcas sigue «vacío». */
function sinMarcas(p: PlanDetalle): PlanDetalle {
  const { sinCapturar: _a, anclajeGeneralElegido: _b, ...resto } = p;
  void _a;
  void _b;
  return resto as PlanDetalle;
}

/** ¿Lleva alguna marca («sin capturar», anclaje general elegido)? Un plan sin datos pero con marcas SÍ se guarda. */
export function tieneMarcasDelPlan(p: PlanDetalle | null | undefined): boolean {
  return Boolean(p && ((p.sinCapturar?.length ?? 0) > 0 || p.anclajeGeneralElegido));
}

/** El mismo plan sin la marca de un dato: ese dato acaba de capturarse. */
export function conDatoCapturado(p: PlanDetalle, dato: DatoDelPlanQuePuedeFaltar): PlanDetalle {
  if (!datoDelPlanSinCapturar(p, dato)) return p;
  const resto = (p.sinCapturar ?? []).filter((k) => k !== dato);
  const { sinCapturar: _s, ...sin } = p;
  void _s;
  return resto.length > 0 ? { ...sin, sinCapturar: resto } : (sin as PlanDetalle);
}

export function esPlanDetalleVacio(p: PlanDetalle | null | undefined): boolean {
  if (!p) return true;
  return JSON.stringify({ ...sinMarcas(p), v: 0 }) === JSON.stringify({ ...planDetalleVacio(), v: 0 });
}

export type ResultadoDeValidar = { ok: true; plan: PlanDetalle } | { ok: false; error: string };

/**
 * Lo que llega del CLIENTE. Estricto: cada dato fuera de rango o de forma se rechaza con su mensaje (la
 * lectura de la base, en cambio, descarta en silencio). Los campos ausentes quedan vacíos: el cliente manda
 * el plan completo.
 */
export function validarPlanDetalle(raw: unknown): ResultadoDeValidar {
  if (raw === null || raw === undefined) return { ok: true, plan: planDetalleVacio() };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "El plan de tratamiento llegó en un formato que no se entiende." };
  const o = raw as Record<string, unknown>;

  const vacio = (v: unknown) => v === null || v === undefined || v === "";
  const numero = (campo: string, rotulo: string, max: number): string | null =>
    vacio(o[campo]) || entero(o[campo], 1, max) !== null ? null : `${rotulo}: escribe un número entero de 1 a ${max}.`;
  const e =
    numero("controlesPrevistos", "Controles previstos", CONTROLES_MAXIMOS) ??
    numero("alineadoresTotales", "Alineadores totales", ALINEADORES_MAXIMOS) ??
    numero("periodicidadMeses", "Periodicidad", PERIODICIDAD_MAXIMA_MESES);
  if (e) return { ok: false, error: e };

  for (const campo of ["anclajeSuperior", "anclajeInferior"] as const) {
    if (!vacio(o[campo]) && !(typeof o[campo] === "string" && CLAVES_ANCLAJE.has(o[campo] as string))) {
      return { ok: false, error: `${campo === "anclajeSuperior" ? "Anclaje superior" : "Anclaje inferior"}: elige una de las opciones.` };
    }
  }
  if (!vacio(o.reevaluacion) && fechaIsoValida(o.reevaluacion) === null) {
    return { ok: false, error: "La fecha de reevaluación no es una fecha válida." };
  }
  if (o.sinCapturar !== undefined && o.sinCapturar !== null) {
    if (!Array.isArray(o.sinCapturar) || o.sinCapturar.some((x) => !(DATOS_DEL_PLAN_QUE_PUEDEN_FALTAR as readonly unknown[]).includes(x))) {
      return { ok: false, error: "Plan: datos sin capturar no válidos." };
    }
  }
  if (o.anclajeGeneralElegido !== undefined && o.anclajeGeneralElegido !== null && o.anclajeGeneralElegido !== true && o.anclajeGeneralElegido !== false) {
    return { ok: false, error: "Plan: anclaje general no válido." };
  }
  if (o.controlRadiografico !== undefined && o.controlRadiografico !== null) {
    if (!Array.isArray(o.controlRadiografico) || o.controlRadiografico.some((x) => typeof x !== "string" || !CLAVES_RADIOGRAFIA.has(x))) {
      return { ok: false, error: "Control radiográfico: elige entre panorámica, tele, mano o scanner ATM." };
    }
  }
  if (o.extraccionesRealizadas !== undefined && o.extraccionesRealizadas !== null) {
    if (!Array.isArray(o.extraccionesRealizadas) || o.extraccionesRealizadas.some((x) => !esFdiValido(x))) {
      return { ok: false, error: "Extracciones realizadas: usa piezas válidas en notación FDI (por ejemplo 14, 24)." };
    }
  }
  for (const c of CAMPOS_DE_VARIAS) {
    const v = o[c.campo];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { ok: false, error: `${c.etiqueta}: formato no válido.` };
    if (v.length > ELEGIDOS_MAXIMOS) return { ok: false, error: `${c.etiqueta}: máximo ${ELEGIDOS_MAXIMOS} elegidos.` };
    if (v.some((x) => (x as string).trim().length > TEXTO_MAXIMO)) return { ok: false, error: `${c.etiqueta}: una opción es demasiado larga.` };
  }
  for (const c of CAMPOS_DE_UNA_OPCION) {
    const v = o[c.campo];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || v.trim().length > TEXTO_MAXIMO) return { ok: false, error: `${c.etiqueta}: formato no válido.` };
  }
  if (typeof o.interconsultas === "string" && o.interconsultas.trim().length > INTERCONSULTAS_MAXIMO) {
    return { ok: false, error: `Interconsultas: máximo ${INTERCONSULTAS_MAXIMO} caracteres.` };
  }
  if (o.interconsultas !== undefined && o.interconsultas !== null && typeof o.interconsultas !== "string") {
    return { ok: false, error: "Interconsultas: formato no válido." };
  }
  return { ok: true, plan: normalizarPlanDetalle(o) };
}

/**
 * «Quitar = no se ofrece en planes nuevos, los viejos conservan su texto»: en el servidor, una opción
 * que el plan NO tenía ya solo puede agregarse si la clínica la ofrece (activa). Devuelve el mensaje o null.
 */
export function validarContraOpciones(nuevo: PlanDetalle, anterior: PlanDetalle | null, opciones: OpcionesDelPlan): string | null {
  const previo = anterior ?? planDetalleVacio();
  for (const c of CAMPOS_DE_VARIAS) {
    const activas = new Set(nombresActivos(opciones[c.lista]).map(clave));
    const tenia = new Set(previo[c.campo].map(clave));
    for (const n of nuevo[c.campo]) {
      if (!activas.has(clave(n)) && !tenia.has(clave(n))) return `${c.etiqueta}: «${n}» ya no se ofrece en tu clínica.`;
    }
  }
  for (const c of CAMPOS_DE_UNA_OPCION) {
    const n = nuevo[c.campo];
    if (!n) continue;
    const activas = new Set(nombresActivos(opciones[c.lista]).map(clave));
    if (!activas.has(clave(n)) && clave(previo[c.campo] ?? "") !== clave(n)) return `${c.etiqueta}: «${n}» ya no se ofrece en tu clínica.`;
  }
  return null;
}

// ─── Frecuencia de control de la clínica → controles previstos ──────────

/** Cada cuántos días la clínica cita un control, por omisión: uno al mes. */
export const FRECUENCIA_DE_CONTROL_DIAS_POR_OMISION = 30;

/** Las frecuencias que se ofrecen en Configuración (el campo admite cualquier número de 7 a 120 días). */
export const FRECUENCIAS_DE_CONTROL = [
  { dias: 14, texto: "Cada 2 semanas" },
  { dias: 21, texto: "Cada 3 semanas" },
  { dias: 28, texto: "Cada 4 semanas" },
  { dias: 30, texto: "Cada mes" },
  { dias: 42, texto: "Cada 6 semanas" },
  { dias: 56, texto: "Cada 8 semanas" },
  { dias: 60, texto: "Cada 2 meses" },
] as const;

export function normalizarFrecuenciaDeControl(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= 7 && n <= 120 ? n : FRECUENCIA_DE_CONTROL_DIAS_POR_OMISION;
}

/**
 * Los controles que se proponen para un tratamiento: la duración entre la frecuencia de control de la
 * clínica (18 meses, cada mes → 18). Solo una propuesta: el campo sigue editable. null si no hay duración.
 */
export function controlesSugeridos(duracionMeses: number | null | undefined, frecuenciaDias: number = FRECUENCIA_DE_CONTROL_DIAS_POR_OMISION): number | null {
  const m = Number(duracionMeses);
  if (!Number.isFinite(m) || m <= 0) return null;
  const n = Math.round((m * 30.4375) / normalizarFrecuenciaDeControl(frecuenciaDias));
  return Math.min(CONTROLES_MAXIMOS, Math.max(1, n));
}

// ─── Técnica ↔ aparatología ─────────────────────────────────────────────

/** Los tipos base de técnica (enum `OrthoTechnique`). */
export type TipoBaseDeTecnica =
  | "METAL_BRACKETS"
  | "CERAMIC_BRACKETS"
  | "SELF_LIGATING_METAL"
  | "SELF_LIGATING_CERAMIC"
  | "LINGUAL_BRACKETS"
  | "CLEAR_ALIGNERS"
  | "HYBRID";

/**
 * Qué aparatología tiene sentido ofrecer según la técnica elegida, para que no se contradigan: alineadores
 * solo con alineadores o mixta; brackets con cualquier técnica de brackets o mixta. Las placas (planos,
 * disyuntores, asas) y los aditamentos van con cualquiera.
 */
export function aparatologiaPermitida(tecnica: string | null | undefined): { brackets: boolean; alineadores: boolean } {
  switch (tecnica) {
    case "CLEAR_ALIGNERS":
      return { brackets: false, alineadores: true };
    case "HYBRID":
      return { brackets: true, alineadores: true };
    case undefined:
    case null:
    case "":
      return { brackets: true, alineadores: true };
    default:
      return { brackets: true, alineadores: false };
  }
}

/** Quita lo que la técnica no admite (al cambiar de técnica en el formulario). Devuelve qué quitó. */
export function sinAparatologiaIncompatible<T extends { brackets: string[]; alineadores: string[] }>(
  plan: T,
  tecnica: string | null | undefined,
): { plan: T; quitados: string[] } {
  const ok = aparatologiaPermitida(tecnica);
  const quitados = [...(ok.brackets ? [] : plan.brackets), ...(ok.alineadores ? [] : plan.alineadores)];
  return {
    plan: { ...plan, brackets: ok.brackets ? plan.brackets : [], alineadores: ok.alineadores ? plan.alineadores : [] },
    quitados,
  };
}

/** Mensaje si el plan lleva aparatología que la técnica no admite; null si cuadra. Lo exige el servidor. */
export function validarContraTecnica(plan: Pick<PlanDetalle, "brackets" | "alineadores">, tecnica: string | null | undefined, nombreDeLaTecnica?: string): string | null {
  const ok = aparatologiaPermitida(tecnica);
  const como = nombreDeLaTecnica ? `«${nombreDeLaTecnica}»` : "la técnica elegida";
  if (!ok.alineadores && plan.alineadores.length > 0) return `Alineadores: no aplican con ${como}. Cambia la técnica (alineadores o mixta) o quita los alineadores.`;
  if (!ok.brackets && plan.brackets.length > 0) return `Brackets: no aplican con ${como}. Cambia la técnica (brackets o mixta) o quita los brackets.`;
  return null;
}

// ─── Lo que se DERIVA del plan (no se pide dos veces) ───────────────────

/**
 * `tadsRequired` (la columna de siempre) sale de «Aditamentos → microtornillos / miniplacas» y de los TAD
 * que el caso ya tiene registrados: no es una casilla aparte.
 */
export function tadsRequeridos(aditamentos: readonly string[], tadsRegistrados: number = 0): boolean {
  return planPideTads(aditamentos) || tadsRegistrados > 0;
}

/**
 * La prescripción general del caso (`prescriptionSlot`) y el cementado (`bondingType`), derivados de lo que se
 * eligió en tubos, bandas y cementación: Roth → Roth 0.022, MBT → MBT 0.022, Damon → Damon Q2; una cementación
 * «indirecta» / «directa» → el cementado. `null` = no se puede deducir: la columna no se toca. (0.022 es el
 * calibre más común; el doctor lo afina en la hoja de control.)
 */
export function prescripcionDerivada(d: Pick<PlanDetalle, "brackets" | "tubosSuperiores" | "tubosInferiores" | "bandasSuperiores" | "bandasInferiores" | "cementacionSuperiorAnterior" | "cementacionSuperiorPosterior" | "cementacionInferiorAnterior" | "cementacionInferiorPosterior">): {
  prescriptionSlot: "ROTH_022" | "MBT_022" | "DAMON_Q2" | null;
  bondingType: "DIRECTO" | "INDIRECTO" | null;
} {
  // Brackets, tubos y bandas cuentan igual: «Brackets MBT» con «Tubos Roth» son dos prescripciones, no una.
  const marcas = [...d.brackets, d.tubosSuperiores, d.tubosInferiores, d.bandasSuperiores, d.bandasInferiores]
    .filter((x): x is string => Boolean(x))
    .map((x) => clave(x));
  const tiene = (re: RegExp) => marcas.some((m) => re.test(m));
  // Si mezclan sistemas distintos no hay una sola prescripción que decir.
  const roth = tiene(/\broth\b/);
  const mbt = tiene(/\bmbt\b/);
  const damon = tiene(/\bdamon\b/);
  const cuantas = [roth, mbt, damon].filter(Boolean).length;
  const prescriptionSlot = cuantas === 1 ? (roth ? "ROTH_022" : mbt ? "MBT_022" : "DAMON_Q2") : null;

  const cem = [d.cementacionSuperiorAnterior, d.cementacionSuperiorPosterior, d.cementacionInferiorAnterior, d.cementacionInferiorPosterior]
    .filter((x): x is string => Boolean(x))
    .map((x) => clave(x));
  const indirecto = cem.some((m) => /indirect/.test(m));
  const directo = cem.some((m) => /\bdirect/.test(m));
  const bondingType = indirecto && !directo ? "INDIRECTO" : directo && !indirecto ? "DIRECTO" : null;
  return { prescriptionSlot, bondingType };
}

/**
 * La prescripción del caso TAL COMO LA DICE EL PLAN (su única fuente): «Brackets MBT · Tubos y bandas Roth». No se
 * deduce ni se inventa un calibre; si el plan no eligió brackets, tubos ni bandas, `null` (la tarjeta de
 * aparatología no dice nada). Lo lee la tarjeta de «Aparatología y arcos» y el resumen de arriba.
 */
export function prescripcionDelPlan(d: Pick<PlanDetalle, "brackets" | "tubosSuperiores" | "tubosInferiores" | "bandasSuperiores" | "bandasInferiores">): string | null {
  const unicos = (...v: Array<string | null>) => [...new Set(v.filter((x): x is string => Boolean(x)))];
  const tubos = unicos(d.tubosSuperiores, d.tubosInferiores);
  const bandas = unicos(d.bandasSuperiores, d.bandasInferiores);
  const partes: string[] = [];
  if (d.brackets.length > 0) partes.push(`Brackets ${lista(d.brackets)}`);
  if (tubos.length > 0 && tubos.join("|") === bandas.join("|")) partes.push(`Tubos y bandas ${lista(tubos)}`);
  else {
    if (tubos.length > 0) partes.push(`Tubos ${lista(tubos)}`);
    if (bandas.length > 0) partes.push(`Bandas ${lista(bandas)}`);
  }
  return partes.length > 0 ? partes.join(" · ") : null;
}

// ─── Anclaje general derivado ───────────────────────────────────────────

export type AnclajeGeneral = "MAXIMUM" | "MODERATE" | "MINIMUM" | "COMPOUND";

const GENERAL_DE: Record<AnclajeArcada, Exclude<AnclajeGeneral, "COMPOUND">> = {
  ABSOLUTO: "MAXIMUM",
  MAXIMO: "MAXIMUM",
  MEDIO: "MODERATE",
  MINIMO: "MINIMUM",
  MINIMO_ABSOLUTO: "MINIMUM",
};

/**
 * El anclaje general (`AnchorageType`, el de siempre) que corresponde a los dos por arcada: el mismo si
 * coinciden en su grupo, «compuesto» (= «ver por arcada») si no, `null` si no se eligió ninguno.
 */
export function anclajeGeneralDerivado(sup: AnclajeArcada | null, inf: AnclajeArcada | null): AnclajeGeneral | null {
  if (sup && inf) return GENERAL_DE[sup] === GENERAL_DE[inf] ? GENERAL_DE[sup] : "COMPOUND";
  const uno = sup ?? inf;
  return uno ? GENERAL_DE[uno] : null;
}

export const ETIQUETA_ANCLAJE_GENERAL: Record<string, string> = {
  MAXIMUM: "Máximo",
  MODERATE: "Moderado",
  MINIMUM: "Mínimo",
  COMPOUND: "Compuesto (ver por arcada)",
};

/**
 * El anclaje general (`AnchorageType`) es NOT NULL y arranca en «Moderado» al abrir el caso, al migrar de Dentalink y
 * cuando no se elige ninguno por arcada: «Moderado» solo, sin detalle por arcada, es el valor de relleno y NO se dice
 * como dato. Cualquier otro (máximo, mínimo, compuesto) sí se eligió. `null` = sin capturar.
 */
export function anclajeGeneralComoDato(
  anchorageType: string | null | undefined,
  detalle?: Pick<PlanDetalle, "anclajeGeneralElegido"> | null,
): string | null {
  if (!anchorageType) return null;
  if (anchorageType === "MODERATE" && !detalle?.anclajeGeneralElegido) return null;
  return ETIQUETA_ANCLAJE_GENERAL[anchorageType] ?? null;
}

// ─── TADs ↔ aditamentos ─────────────────────────────────────────────────

const ES_MICROTORNILLO = /microtornill|mini ?implante|\btads?\b/;
const ES_MINIPLACA = /miniplaca/;

/** ¿Este aditamento se conecta con los TADs del caso (microtornillos o miniplacas)? */
export function esAditamentoConTads(nombre: string): boolean {
  const k = clave(nombre);
  return ES_MICROTORNILLO.test(k) || ES_MINIPLACA.test(k);
}

/** El plan pide TADs si eligió microtornillos o miniplacas. Alimenta `tadsRequired`, la columna de siempre. */
export function planPideTads(aditamentos: readonly string[]): boolean {
  return aditamentos.some(esAditamentoConTads);
}

// ─── Resumen legible ────────────────────────────────────────────────────

export interface BaseDelPlan {
  estimatedDurationMonths: number | null;
  /** `AnchorageType` del caso (el general de siempre). */
  anchorageType: string | null;
  extractionsRequired: boolean;
  extractionsTeethFdi: readonly number[];
}

export interface LineaDelPlan {
  clave: string;
  etiqueta: string;
  valor: string;
}

/** "YYYY-MM-DD" (o ISO completo) → "dd/mm/aaaa". */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const lista = (v: readonly string[]): string => v.join(", ");
const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/**
 * El plan en renglones legibles, sin los vacíos. Lo usan la ficha, el PDF del plan, el expediente y Sabina:
 * una sola redacción, así ninguna cuenta otra cosa. `tads` = cuántos TAD tiene registrados el caso.
 */
export function lineasDelPlan(base: BaseDelPlan, detalle: PlanDetalle | null, tads: number = 0): LineaDelPlan[] {
  const d = detalle ?? planDetalleVacio();
  const out: LineaDelPlan[] = [];
  const poner = (clave: string, etiqueta: string, valor: string) => {
    if (valor.trim()) out.push({ clave, etiqueta, valor });
  };

  if (base.estimatedDurationMonths && base.estimatedDurationMonths > 0 && !datoDelPlanSinCapturar(d, "duracion")) {
    poner("duracion", "Duración estimada", plural(base.estimatedDurationMonths, "mes", "meses"));
  }
  if (d.controlesPrevistos) poner("controles", "Controles previstos", String(d.controlesPrevistos));
  if (d.alineadoresTotales) poner("alineadoresTotales", "Alineadores totales", String(d.alineadoresTotales));

  if (d.anclajeSuperior || d.anclajeInferior) {
    poner(
      "anclaje",
      "Anclaje",
      [d.anclajeSuperior ? `superior ${etiquetaDeAnclaje(d.anclajeSuperior).toLowerCase()}` : "", d.anclajeInferior ? `inferior ${etiquetaDeAnclaje(d.anclajeInferior).toLowerCase()}` : ""]
        .filter(Boolean)
        .join(" · ")
        .replace(/^./, (c) => c.toUpperCase()),
    );
  } else {
    const general = anclajeGeneralComoDato(base.anchorageType, d);
    if (general) poner("anclaje", "Anclaje", general);
  }

  const adit = [...d.aditamentos];
  if (tads > 0 && !adit.some(esAditamentoConTads)) adit.push("Microtornillos (TAD)");
  if (adit.length > 0) poner("aditamentos", "Aditamentos", lista(adit));
  if (tads > 0) poner("tads", "TAD registrados", String(tads));

  if (base.extractionsTeethFdi.length > 0) poner("extraccionesIndicadas", "Extracciones indicadas", textoFdi(base.extractionsTeethFdi));
  else if (base.extractionsRequired) poner("extraccionesIndicadas", "Extracciones indicadas", "Sí (sin piezas anotadas)");
  if (d.extraccionesRealizadas.length > 0) poner("extraccionesRealizadas", "Extracciones realizadas", textoFdi(d.extraccionesRealizadas));

  if (d.controlRadiografico.length > 0 || d.periodicidadMeses || d.reevaluacion) {
    const partes: string[] = [];
    if (d.controlRadiografico.length > 0) partes.push(lista(d.controlRadiografico.map(etiquetaDeRadiografia)));
    if (d.periodicidadMeses) partes.push(`cada ${plural(d.periodicidadMeses, "mes", "meses")}`);
    if (d.reevaluacion) partes.push(`reevaluación ${fechaCorta(d.reevaluacion)}`);
    poner("radiografico", "Control radiográfico", partes.join(" · "));
  }

  poner("brackets", "Brackets", lista(d.brackets));
  poner("alineadores", "Alineadores", lista(d.alineadores));
  poner("placas", "Placas", lista(d.placas));

  const par = (a: string | null, ra: string, b: string | null, rb: string) =>
    [a ? `${ra}: ${a}` : "", b ? `${rb}: ${b}` : ""].filter(Boolean).join(" · ");
  poner("tubos", "Tubos", par(d.tubosSuperiores, "superiores", d.tubosInferiores, "inferiores"));
  poner("bandas", "Bandas", par(d.bandasSuperiores, "superiores", d.bandasInferiores, "inferiores"));
  poner(
    "cementacion",
    "Cementación",
    [
      d.cementacionSuperiorAnterior ? `superior anterior: ${d.cementacionSuperiorAnterior}` : "",
      d.cementacionSuperiorPosterior ? `superior posterior: ${d.cementacionSuperiorPosterior}` : "",
      d.cementacionInferiorAnterior ? `inferior anterior: ${d.cementacionInferiorAnterior}` : "",
      d.cementacionInferiorPosterior ? `inferior posterior: ${d.cementacionInferiorPosterior}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );
  if (d.interconsultas) poner("interconsultas", "Interconsultas", d.interconsultas);
  return out;
}

/** La aparatología elegida en una frase corta («Inovation Roth»): el concepto de la colocación la lleva. */
export function aparatologiaElegida(d: Pick<PlanDetalle, "brackets" | "alineadores" | "placas"> | null): string | null {
  if (!d) return null;
  const todo = [...d.brackets, ...d.alineadores, ...d.placas];
  return todo.length > 0 ? lista(todo) : null;
}

// ─── Casos con diagnóstico o plan incompleto ────────────────────────────

export type PasoDelCaso = "diagnostico" | "plan";

export interface PiezaFaltante {
  paso: PasoDelCaso;
  clave: string;
  /** «doctor tratante», «controles previstos»… */
  texto: string;
}

/**
 * Lo que falta de un caso para darlo por completo. Para ABRIR un caso solo se exigen técnica y doctor; lo demás
 * puede quedar a medias, y los casos migrados de Dentalink entran casi vacíos. «Incompleto» dice SOLO lo esencial
 * (ws1-t12, revisión final: con todo lo demás, 21 de 25 casos salían y la alerta no servía):
 *  · DIAGNÓSTICO — los valores neutros de migración, o la clase de Angle / el overjet y overbite sin capturar.
 *  · PLAN — doctor tratante, controles previstos y cobro (plan de pago o factura de colocación). La técnica no
 *    entra: siempre existe (sin ella no se abre el caso).
 * NO cuentan: el resumen clínico (es opcional), el anclaje, la aparatología, la retención, los aditamentos, las
 * extracciones, las radiografías ni las interconsultas: pueden no aplicar o llenarse más tarde.
 */
export function piezasQueFaltan(c: {
  /** El diagnóstico lleva la marca de migración (valores neutros, no mediciones). */
  diagnosticoMigrado: boolean;
  /** `sinCapturar` del detalle del diagnóstico: lo que se guardó como relleno y no es un dato real. */
  sinCapturar?: readonly string[];
  doctorId: string | null | undefined;
  detalle: PlanDetalle | null | undefined;
  billingMode: "PRECIO_TOTAL" | "PAGO_POR_CONTROL";
  tieneFactura: boolean;
}): PiezaFaltante[] {
  const out: PiezaFaltante[] = [];
  const d = c.detalle ?? planDetalleVacio();
  const sin = c.sinCapturar ?? [];
  if (c.diagnosticoMigrado) out.push({ paso: "diagnostico", clave: "diagnostico-migrado", texto: "diagnóstico (valores de migración)" });
  else {
    if (sin.includes("angleClassRight") || sin.includes("angleClassLeft")) out.push({ paso: "diagnostico", clave: "angle", texto: "clase de Angle" });
    if (sin.includes("overjetMm") || sin.includes("overbiteMm")) out.push({ paso: "diagnostico", clave: "overjet-overbite", texto: "overjet y overbite" });
  }
  if (!c.doctorId) out.push({ paso: "plan", clave: "doctor", texto: "doctor tratante" });
  if (datoDelPlanSinCapturar(d, "duracion")) out.push({ paso: "plan", clave: "duracion", texto: "tiempo de tratamiento" });
  if (datoDelPlanSinCapturar(d, "objetivos")) out.push({ paso: "plan", clave: "objetivos", texto: "objetivos del tratamiento" });
  if (!d.controlesPrevistos) out.push({ paso: "plan", clave: "controles", texto: "controles previstos" });
  if (!c.tieneFactura) out.push({ paso: "plan", clave: "cobro", texto: c.billingMode === "PAGO_POR_CONTROL" ? "factura de colocación" : "plan de pago" });
  return out;
}

/** El primer paso que falta (a dónde lleva el acceso directo): el diagnóstico va antes que el plan. */
export function pasoQueFalta(piezas: readonly PiezaFaltante[]): PasoDelCaso | null {
  if (piezas.some((p) => p.paso === "diagnostico")) return "diagnostico";
  if (piezas.some((p) => p.paso === "plan")) return "plan";
  return null;
}

// ─── Lo que la ficha recibe del plan ────────────────────────────────────

/** El plan de UN caso tal como lo pintan la sección «Plan de tratamiento» y su popup. */
export interface PlanDeTratamientoVista {
  treatmentPlanId: string;
  /** Vacío si el caso aún no lo completó. Con `alineadoresTotales` ya fusionado con el seguimiento de alineadores. */
  detalle: PlanDetalle;
  /** false = falta pegar sql/ortodoncia-plan-de-tratamiento.sql: no se puede guardar. */
  columna: boolean;
  duracionMeses: number | null;
  /** `AnchorageType` del caso (el general de siempre). */
  anchorageType: string | null;
  extraccionesRequired: boolean;
  extraccionesIndicadas: number[];
  /** Cuántos TAD tiene registrados el caso. */
  tads: number;
  /** Controles a los que el paciente ya vino (lo mismo que cuentan Tablero y Controles). */
  controlesHechos: number;
  /** Hay seguimiento de alineadores: el total se cambia aquí o allá, es el mismo dato. */
  conSeguimientoDeAlineadores: boolean;
  /** Reevaluaciones radiográficas que tocan hoy (las mismas que Alertas). Vacío = ninguna. */
  reevaluaciones: ReevaluacionPendiente[];
  /** El resto del caso que la ventana «Plan de tratamiento» edita junto con el plan (técnica, doctor, cobro…). */
  caso: CasoParaLaVentana;
}

/**
 * Lo que la ventana del caso (un solo formulario para abrir y para editar) necesita del caso YA abierto, además del
 * plan completo: técnica, doctor, retención, cobro. Todo sale de las columnas de siempre; nada se duplica.
 */
export interface CasoParaLaVentana {
  /** Tipo base (enum `OrthoTechnique`). */
  tecnica: string;
  /** Nombre propio guardado en el caso (null = el de su tipo base). */
  tecnicaNombrePropio: string | null;
  /** Cómo se muestra hoy la técnica del caso. */
  tecnicaVisible: string;
  objetivos: string;
  retencion: string;
  doctorId: string | null;
  responsableId: string | null;
  /** ISO de la colocación, o null. */
  colocadoEl: string | null;
  /** Costo de referencia guardado en el caso (con factura, el que cuenta es el de la factura). */
  costoReferencia: number;
  iprRequerido: boolean;
  billingMode: "PRECIO_TOTAL" | "PAGO_POR_CONTROL";
  /** La factura del tratamiento (en «Pago por control», la de colocación), si ya existe. */
  factura: { id: string; total: number; pagado: number } | null;
}

// ─── Qué cambió (Movimientos) ───────────────────────────────────────────

export type SeccionDelPlan =
  | "controles"
  | "alineadores"
  | "anclaje"
  | "aditamentos"
  | "extracciones"
  | "radiografico"
  | "aparatologia"
  | "tubos-bandas-cementacion"
  | "interconsultas";

const SECCIONES: Array<{ seccion: SeccionDelPlan; texto: string; campos: readonly string[] }> = [
  { seccion: "controles", texto: "controles previstos", campos: ["controlesPrevistos", "duracion"] },
  { seccion: "alineadores", texto: "alineadores totales", campos: ["alineadoresTotales"] },
  { seccion: "anclaje", texto: "anclaje", campos: ["anclajeSuperior", "anclajeInferior"] },
  { seccion: "aditamentos", texto: "aditamentos", campos: ["aditamentos"] },
  { seccion: "extracciones", texto: "extracciones", campos: ["extraccionesRealizadas", "extraccionesIndicadas"] },
  { seccion: "radiografico", texto: "control radiográfico", campos: ["controlRadiografico", "periodicidadMeses", "reevaluacion"] },
  { seccion: "aparatologia", texto: "aparatología", campos: ["brackets", "alineadores", "placas"] },
  {
    seccion: "tubos-bandas-cementacion",
    texto: "tubos, bandas y cementación",
    campos: CAMPOS_DE_UNA_OPCION.map((c) => c.campo),
  },
  { seccion: "interconsultas", texto: "interconsultas", campos: ["interconsultas"] },
];

export interface CambiosDelPlan {
  /** Nombres de los campos que cambiaron (para la bitácora; nunca sus valores en el texto). */
  campos: string[];
  /** Antes/después de cada campo, para el rastro legal (no se muestra). */
  cambios: Record<string, { before: unknown; after: unknown }>;
  secciones: SeccionDelPlan[];
}

const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Compara el plan de antes con el de después (incluidas las columnas de siempre que el editor también toca). */
export function cambiosDelPlan(
  antes: { detalle: PlanDetalle | null; duracionMeses?: number | null; extraccionesIndicadas?: readonly number[] },
  despues: { detalle: PlanDetalle; duracionMeses?: number | null; extraccionesIndicadas?: readonly number[] },
): CambiosDelPlan {
  const a = antes.detalle ?? planDetalleVacio();
  const b = despues.detalle;
  const cambios: CambiosDelPlan["cambios"] = {};
  const claves = Object.keys(planDetalleVacio()).filter((k) => k !== "v") as Array<keyof PlanDetalle>;
  for (const k of claves) {
    if (!igual(a[k], b[k])) cambios[k] = { before: a[k], after: b[k] };
  }
  if (antes.extraccionesIndicadas && despues.extraccionesIndicadas && !igual(ordenarFdi(antes.extraccionesIndicadas), ordenarFdi(despues.extraccionesIndicadas))) {
    cambios.extraccionesIndicadas = { before: ordenarFdi(antes.extraccionesIndicadas), after: ordenarFdi(despues.extraccionesIndicadas) };
  }
  if (antes.duracionMeses !== undefined && despues.duracionMeses !== undefined && antes.duracionMeses !== despues.duracionMeses) {
    cambios.duracion = { before: antes.duracionMeses, after: despues.duracionMeses };
  }
  const campos = Object.keys(cambios);
  const secciones = SECCIONES.filter((s) => s.campos.some((c) => campos.includes(c))).map((s) => s.seccion);
  return { campos, cambios, secciones };
}

/**
 * La frase de Movimientos: qué se hizo, no qué contenía (sin datos clínicos). «Actualizó el plan de
 * tratamiento de ortodoncia: controles previstos, aditamentos y extracciones».
 */
export function textoDeMovimientoDelPlan(secciones: readonly SeccionDelPlan[], creado: boolean = false): string {
  const base = creado ? "Completó el plan de tratamiento de ortodoncia" : "Actualizó el plan de tratamiento de ortodoncia";
  const nombres = SECCIONES.filter((s) => secciones.includes(s.seccion)).map((s) => s.texto);
  if (nombres.length === 0) return base;
  const lista3 = nombres.length <= 3 ? nombres : [...nombres.slice(0, 3), `${nombres.length - 3} más`];
  const dicho = lista3.length === 1 ? lista3[0]! : `${lista3.slice(0, -1).join(", ")} y ${lista3[lista3.length - 1]}`;
  return `${base}: ${dicho}`;
}

// ─── Progreso «Control X de N» ──────────────────────────────────────────

export interface ProgresoDeControles {
  /** Controles a los que el paciente ya vino. */
  hechos: number;
  /** Los previstos en el plan; null = el plan no los dice. */
  previstos: number | null;
  /** El número del control que sigue (hechos + 1). */
  siguiente: number;
  /** Faltan (nunca negativo); null sin previstos. */
  restantes: number | null;
  /** 0-100 (tope 100); null sin previstos. */
  pct: number | null;
  /** Ya pasó de los previstos. */
  excedido: boolean;
  completo: boolean;
}

export function progresoDeControles(hechos: number, previstos: number | null | undefined): ProgresoDeControles {
  const h = Math.max(0, Math.floor(Number.isFinite(hechos) ? hechos : 0));
  const n = previstos && previstos > 0 ? Math.floor(previstos) : null;
  return {
    hechos: h,
    previstos: n,
    siguiente: h + 1,
    restantes: n === null ? null : Math.max(0, n - h),
    pct: n === null ? null : Math.min(100, Math.round((h / n) * 100)),
    excedido: n !== null && h > n,
    completo: n !== null && h >= n,
  };
}

/** «Control 6 de 18» — el que sigue. Sin previstos: «Control 6». Pasado de los previstos: «Control 20 (previstos: 18)». */
export function textoControlQueSigue(p: ProgresoDeControles): string {
  if (p.previstos === null) return `Control ${p.siguiente}`;
  if (p.siguiente > p.previstos) return `Control ${p.siguiente} (previstos: ${p.previstos})`;
  return `Control ${p.siguiente} de ${p.previstos}`;
}

/** «5 de 18 controles» — los que ya vino. Sin previstos: «5 controles». */
export function textoControlesHechos(p: ProgresoDeControles): string {
  if (p.previstos === null) return plural(p.hechos, "control", "controles");
  return `${p.hechos} de ${p.previstos} controles`;
}

// ─── Cobro: pago por control ────────────────────────────────────────────

export interface EstimadoPorControles {
  previstos: number;
  precioPorControl: number;
  /** previstos × precio, en pesos con centavos exactos. */
  total: number;
}

/** Controles previstos × precio del control = total ESTIMADO. null si falta alguno de los dos. Nada se cobra solo. */
export function estimadoPorControles(previstos: number | null | undefined, precio: number | null | undefined): EstimadoPorControles | null {
  if (!previstos || previstos <= 0) return null;
  const p = Number(precio);
  if (!Number.isFinite(p) || p <= 0) return null;
  const centavos = Math.round(p * 100) * Math.floor(previstos);
  return { previstos: Math.floor(previstos), precioPorControl: p, total: centavos / 100 };
}

const pesos = (n: number): string => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(n);

/** «18 controles × $800 = $14,400 (estimado; cada control se cobra al atenderlo)». */
export function textoDelEstimado(e: EstimadoPorControles): string {
  return `${e.previstos} controles × ${pesos(e.precioPorControl)} = ${pesos(e.total)} (estimado; cada control se cobra al atenderlo)`;
}

// ─── Reevaluación radiográfica (Alertas) ────────────────────────────────

export interface RadiografiaDelPaciente {
  tipo: TipoRadiografia;
  /** "YYYY-MM-DD" */
  fecha: string;
}

export interface ReevaluacionPendiente {
  /** null = la fecha de reevaluación del plan (sin un tipo en particular). */
  tipo: TipoRadiografia | null;
  motivo: "fecha" | "periodicidad";
  /** Desde cuándo se cuenta: la última radiografía de ese tipo o el inicio del caso. null en «fecha». */
  desde: string | null;
  /** Cuándo tocaba. "YYYY-MM-DD" */
  vence: string;
  diasVencida: number;
  /** No hay radiografía tipificada de ese tipo: se cuenta desde el inicio del caso. */
  desdeInicio: boolean;
}

function aUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function diasEntreFechas(desdeIso: string, hastaIso: string): number {
  return Math.round((aUtc(hastaIso) - aUtc(desdeIso)) / 86_400_000);
}

/** Suma meses a "YYYY-MM-DD" sin pasarse del fin de mes (31-ene + 1 mes = 28/29-feb). */
export function sumarMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = (m - 1) + meses;
  const anio = y + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${String(anio).padStart(4, "0")}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Casos en los que la reevaluación radiográfica se vigila. En pausa o cerrado, no. */
const ESTADOS_CON_FECHA = new Set(["PLANNED", "IN_PROGRESS", "RETENTION"]);
const ESTADOS_CON_PERIODICIDAD = new Set(["IN_PROGRESS"]);

/**
 * Qué reevaluaciones radiográficas tocan hoy:
 *  · la FECHA de reevaluación del plan, al llegar (deja de tocar si ya hay una radiografía tipificada de las
 *    elegidas con fecha igual o posterior);
 *  · la PERIODICIDAD, por cada tipo elegido: desde la última radiografía de ese tipo si está tipificada
 *    (panorámica y tele), y si no —o si no hay ninguna— desde el inicio del caso.
 * Sin fecha ni periodicidad no hay nada que vigilar. La más vencida primero.
 */
export function reevaluacionesPendientes(args: {
  plan: Pick<PlanDetalle, "controlRadiografico" | "periodicidadMeses" | "reevaluacion">;
  status: string;
  /** Inicio del caso: colocación o, si no hay, inicio planeado. "YYYY-MM-DD" o null. */
  inicio: string | null;
  radiografias: readonly RadiografiaDelPaciente[];
  /** Hoy en la zona de la clínica. "YYYY-MM-DD" */
  hoy: string;
}): ReevaluacionPendiente[] {
  const { plan, status, inicio, radiografias, hoy } = args;
  const out: ReevaluacionPendiente[] = [];

  const ultima = (tipo: TipoRadiografia): string | null => {
    let mejor: string | null = null;
    for (const r of radiografias) if (r.tipo === tipo && (mejor === null || r.fecha > mejor)) mejor = r.fecha;
    return mejor;
  };

  if (plan.reevaluacion && ESTADOS_CON_FECHA.has(status) && plan.reevaluacion <= hoy) {
    const hecha = plan.controlRadiografico.some((t) => {
      const u = CATEGORIA_DE_ARCHIVO[t] ? ultima(t) : null;
      return u !== null && u >= plan.reevaluacion!;
    });
    if (!hecha) {
      out.push({ tipo: null, motivo: "fecha", desde: null, vence: plan.reevaluacion, diasVencida: diasEntreFechas(plan.reevaluacion, hoy), desdeInicio: false });
    }
  }

  if (plan.periodicidadMeses && ESTADOS_CON_PERIODICIDAD.has(status)) {
    for (const tipo of plan.controlRadiografico) {
      const tipificada = Boolean(CATEGORIA_DE_ARCHIVO[tipo]);
      const ult = tipificada ? ultima(tipo) : null;
      const desde = ult ?? inicio;
      if (!desde) continue;
      const vence = sumarMeses(desde, plan.periodicidadMeses);
      if (vence > hoy) continue;
      out.push({ tipo, motivo: "periodicidad", desde, vence, diasVencida: diasEntreFechas(vence, hoy), desdeInicio: ult === null });
    }
  }
  return out.sort((x, y) => y.diasVencida - x.diasVencida);
}

/** «Panorámica (tocaba el 12/03/2026, desde el inicio del caso)». */
export function textoDeReevaluacion(r: ReevaluacionPendiente): string {
  if (r.motivo === "fecha") return `Fecha de reevaluación (${fechaCorta(r.vence)})`;
  const nombre = r.tipo ? etiquetaDeRadiografia(r.tipo) : "Radiografía";
  return `${nombre} (tocaba el ${fechaCorta(r.vence)}${r.desdeInicio ? ", contada desde el inicio del caso" : `, última el ${fechaCorta(r.desde)}`})`;
}

// ─── Procedimientos del catálogo que el plan propone ────────────────────

/**
 * Comparar textos: sin acentos ni mayúsculas y con guiones, barras y signos hechos espacio («Mini-implante (TAD)» →
 * «mini implante tad»), para que el emparejamiento no dependa de cómo escribió el nombre cada clínica.
 */
const claveDeBusqueda = (t: string): string => clave(t).replace(/[^a-z0-9]+/g, " ").trim();

/** Grupos de palabras clave: un aditamento/aparatología y un procedimiento del catálogo son «lo mismo» si comparten grupo. */
const GRUPOS_DE_PROCEDIMIENTO: ReadonlyArray<readonly RegExp[]> = [
  [/micro ?tornill/, /mini ?tornill/, /micro ?implant/, /mini ?implant/, /\btads?\b/, /tornillos? de anclaje/, /anclaje esqueletico/],
  [/mini ?placa/],
  [/\bizg\b/],
  [/bucal shelf/, /buccal shelf/],
  [/barra palatina/],
  [/\bspp\b/],
  [/\btopes?\b/],
  [/disyuntor/, /expansor/],
  [/\bplacas?\b/, /\bplano\b/, /\basa continua/],
  [/alineador/, /invisalign/],
];

export interface ProcedimientoDelCatalogo {
  id: string;
  name: string;
}

export interface ProcedimientoSugerido {
  procedureId: string;
  /** «Del plan: Microtornillos». */
  motivo: string;
}

/**
 * Los procedimientos del catálogo que corresponden a lo que el plan eligió (aditamentos, placas,
 * alineadores…). Solo PROPONE: quien atiende decide si se hizo y si se cobra. Los brackets del plan no
 * proponen nada (la colocación ya los lleva en su concepto).
 */
export function procedimientosSugeridos(
  plan: Pick<PlanDetalle, "aditamentos" | "placas" | "alineadores"> | null,
  catalogo: readonly ProcedimientoDelCatalogo[],
): ProcedimientoSugerido[] {
  if (!plan) return [];
  const elegidos = [...plan.aditamentos, ...plan.placas, ...plan.alineadores];
  if (elegidos.length === 0) return [];
  const out: ProcedimientoSugerido[] = [];
  const vistos = new Set<string>();
  for (const item of elegidos) {
    const k = claveDeBusqueda(item);
    for (const grupo of GRUPOS_DE_PROCEDIMIENTO) {
      if (!grupo.some((re) => re.test(k))) continue;
      for (const proc of catalogo) {
        if (vistos.has(proc.id)) continue;
        const kp = claveDeBusqueda(proc.name);
        if (grupo.some((re) => re.test(kp))) {
          vistos.add(proc.id);
          out.push({ procedureId: proc.id, motivo: `Del plan: ${item}` });
        }
      }
    }
  }
  return out;
}

/**
 * Lo que el plan eligió y es un procedimiento que se cobra (microtornillo, miniplaca, barra palatina…) pero el
 * catálogo de la clínica NO tiene: sin él, «Cobrar extra» no tiene qué proponer. Se dice, para que lo agreguen en
 * Configuración → Procedimientos. `catalogo` = TODOS los procedimientos activos (también los «incluidos en el
 * tratamiento»: si el catálogo ya lo trae como incluido, no falta nada).
 */
export function procedimientosQueFaltanEnElCatalogo(
  plan: Pick<PlanDetalle, "aditamentos" | "placas" | "alineadores"> | null,
  catalogo: readonly ProcedimientoDelCatalogo[],
): string[] {
  if (!plan) return [];
  const faltan: string[] = [];
  const grupos = new Set<number>();
  for (const item of [...plan.aditamentos, ...plan.placas]) {
    const k = claveDeBusqueda(item);
    const g = GRUPOS_DE_PROCEDIMIENTO.findIndex((grupo) => grupo.some((re) => re.test(k)));
    if (g < 0 || grupos.has(g)) continue;
    grupos.add(g);
    const grupo = GRUPOS_DE_PROCEDIMIENTO[g]!;
    if (!catalogo.some((proc) => grupo.some((re) => re.test(claveDeBusqueda(proc.name))))) faltan.push(item);
  }
  return faltan;
}

/** «Tu plan incluye Microtornillos: agrega su procedimiento en Configuración → Procedimientos para cobrarlo.» */
export function avisoDeProcedimientoFaltante(item: string): string {
  return `Tu plan incluye ${item}: agrega su procedimiento en Configuración → Procedimientos para cobrarlo.`;
}

/** Los sugeridos primero (en el orden del plan) y el resto como venía. */
export function ordenarConSugeridosPrimero<T extends { id: string }>(filas: readonly T[], sugeridos: readonly ProcedimientoSugerido[]): T[] {
  const orden = new Map(sugeridos.map((s, i) => [s.procedureId, i]));
  const con = filas.filter((f) => orden.has(f.id)).sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0));
  const sin = filas.filter((f) => !orden.has(f.id));
  return [...con, ...sin];
}

// ─── Extracciones ───────────────────────────────────────────────────────

/** Las indicadas que aún no se han realizado. */
export function extraccionesPendientes(indicadas: readonly number[], realizadas: readonly number[]): number[] {
  const hechas = new Set(realizadas);
  return ordenarFdi(indicadas).filter((p) => !hechas.has(p));
}

/** Marca como realizadas estas piezas (unión, sin repetir). */
export function marcarExtraccionesRealizadas(actuales: readonly number[], nuevas: readonly number[]): number[] {
  return ordenarFdi([...actuales, ...nuevas.filter(esFdiValido)]);
}
