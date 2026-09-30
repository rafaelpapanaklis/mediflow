// Ortodoncia — DIAGNÓSTICO completo del caso (ws1-t8, como Dentalink): lo que TIENE el paciente. El «Plan de
// tratamiento» (lo que se le va a hacer) es otra parte y vive en plan-detalle.ts (ws1-t12).
// PURO: sin Prisma, sin React; lo prueban los tests en node (npm run test:orto-diagnostico).
//
// DÓNDE VIVE. Lo que el diagnóstico ya tenía sigue en sus columnas de `orthodontic_diagnoses` (Angle, overbite,
// overjet, apiñamiento en mm, mordidas, etiología, hábitos, fase dental, patrón esquelético, ATM, resumen, doctor
// que refirió). Lo nuevo va en UNA columna JSONB, `orthodontic_diagnoses."diagnosticoDetalle"`
// (sql/ortodoncia-diagnostico-completo.sql), NUNCA declarada en schema.prisma: con una columna de menos,
// cualquier lectura del diagnóstico tiraría P2022. Se lee y escribe por SQL crudo con sonda
// (diagnostico-detalle-db.ts). Sin la columna, el diagnóstico se ve como siempre y al guardar se avisa.
//
// UNA SOLA TABLA (`SECCIONES_DEL_DETALLE`) manda en todo: qué se valida en el servidor, cómo se normaliza lo
// leído, qué cambió (Movimientos), cómo se lee (ficha, PDF, Sabina) y qué pinta el paso del formulario.

// ─── Tabla de campos ────────────────────────────────────────────────────

/** `normal: true` = el valor de referencia (chip verde); sin marca = alterado; `neutro` = describe, no juzga. */
export interface OpcionDx {
  valor: string;
  etiqueta: string;
  normal?: boolean;
  neutro?: boolean;
}

export type CampoDx =
  | { tipo: "opcion"; clave: string; etiqueta: string; opciones: readonly OpcionDx[]; grupo?: string }
  | { tipo: "varias"; clave: string; etiqueta: string; opciones: readonly OpcionDx[]; grupo?: string }
  | { tipo: "numero"; clave: string; etiqueta: string; unidad: string; min: number; max: number; paso: number; grupo?: string }
  | { tipo: "texto"; clave: string; etiqueta: string; max: number; largo?: boolean; grupo?: string; pista?: string };

export const SECCIONES_DEL_DETALLE_CLAVES = ["facial", "oclusal", "dentoalveolar", "funcional", "cefalometria"] as const;
export type SeccionDelDetalle = (typeof SECCIONES_DEL_DETALLE_CLAVES)[number];

const NO_PRESENTA: OpcionDx = { valor: "no-presenta", etiqueta: "No presenta", normal: true };
const NIVEL: readonly OpcionDx[] = [
  { valor: "leve", etiqueta: "Leve" },
  { valor: "moderado", etiqueta: "Moderado" },
  { valor: "severo", etiqueta: "Severo" },
];
const INTENSIDAD: readonly OpcionDx[] = [
  { valor: "ninguno", etiqueta: "No presenta", normal: true },
  ...NIVEL,
];
const LINEA_MEDIA: readonly OpcionDx[] = [
  { valor: "centrada", etiqueta: "Centrada", normal: true },
  { valor: "derecha", etiqueta: "Desviada a la derecha" },
  { valor: "izquierda", etiqueta: "Desviada a la izquierda" },
];
const FORMA_DE_ARCO: readonly OpcionDx[] = [
  { valor: "ovoide", etiqueta: "Ovoide", neutro: true },
  { valor: "cuadrado", etiqueta: "Cuadrado", neutro: true },
  { valor: "triangular", etiqueta: "Triangular", neutro: true },
  { valor: "estrecho", etiqueta: "Estrecho" },
  { valor: "asimetrico", etiqueta: "Asimétrico" },
];
const CLASE: readonly OpcionDx[] = [
  { valor: "I", etiqueta: "Clase I", normal: true },
  { valor: "II", etiqueta: "Clase II" },
  { valor: "III", etiqueta: "Clase III" },
];

export const SECCIONES_DEL_DETALLE: ReadonlyArray<{ clave: SeccionDelDetalle; titulo: string; campos: readonly CampoDx[] }> = [
  {
    clave: "facial",
    titulo: "Características faciales",
    campos: [
      { tipo: "opcion", clave: "asimetriaWilliams", etiqueta: "Asimetría de Williams", opciones: [NO_PRESENTA, { valor: "presenta", etiqueta: "Presenta" }] },
      {
        tipo: "opcion",
        clave: "desviacionMandibular",
        etiqueta: "Desviación mandibular",
        opciones: [{ valor: "no", etiqueta: "No", normal: true }, { valor: "derecha", etiqueta: "Derecha" }, { valor: "izquierda", etiqueta: "Izquierda" }],
      },
      {
        tipo: "opcion",
        clave: "exposicionGingival",
        etiqueta: "Exposición gingival",
        opciones: [{ valor: "normal", etiqueta: "Normal", normal: true }, { valor: "aumentada", etiqueta: "Aumentada" }, { valor: "disminuida", etiqueta: "Disminuida" }],
      },
      {
        tipo: "opcion",
        clave: "cierreLabial",
        etiqueta: "Cierre labial",
        opciones: [{ valor: "competente", etiqueta: "Competente", normal: true }, { valor: "forzado", etiqueta: "Forzado" }, { valor: "incompetente", etiqueta: "Incompetente" }],
      },
      { tipo: "opcion", clave: "claseFacialSagital", etiqueta: "Clase facial sagital", opciones: CLASE },
      {
        tipo: "opcion",
        clave: "tercioInferior",
        etiqueta: "Tercio inferior",
        opciones: [{ valor: "normal", etiqueta: "Normal", normal: true }, { valor: "aumentado", etiqueta: "Aumentado" }, { valor: "disminuido", etiqueta: "Disminuido" }],
      },
      {
        tipo: "opcion",
        clave: "labioSuperior",
        etiqueta: "Labio superior",
        grupo: "Labios y mentón",
        opciones: [
          { valor: "normal", etiqueta: "Normal", normal: true },
          { valor: "protruido", etiqueta: "Protruido" },
          { valor: "retruido", etiqueta: "Retruido" },
          { valor: "corto", etiqueta: "Corto" },
          { valor: "hipotonico", etiqueta: "Hipotónico" },
        ],
      },
      {
        tipo: "opcion",
        clave: "labioInferior",
        etiqueta: "Labio inferior",
        grupo: "Labios y mentón",
        opciones: [
          { valor: "normal", etiqueta: "Normal", normal: true },
          { valor: "protruido", etiqueta: "Protruido" },
          { valor: "retruido", etiqueta: "Retruido" },
          { valor: "evertido", etiqueta: "Evertido" },
          { valor: "interpuesto", etiqueta: "Interpuesto" },
        ],
      },
      {
        tipo: "opcion",
        clave: "menton",
        etiqueta: "Mentón",
        grupo: "Labios y mentón",
        opciones: [
          { valor: "normal", etiqueta: "Normal", normal: true },
          { valor: "prominente", etiqueta: "Prominente" },
          { valor: "retruido", etiqueta: "Retruido" },
          { valor: "hiperactivo", etiqueta: "Hiperactivo" },
          { valor: "desviado", etiqueta: "Desviado" },
        ],
      },
    ],
  },
  {
    clave: "oclusal",
    titulo: "Análisis oclusal y dentario",
    campos: [
      { tipo: "opcion", clave: "lineaMediaSuperior", etiqueta: "Línea media superior", opciones: LINEA_MEDIA, grupo: "Líneas medias" },
      { tipo: "numero", clave: "lineaMediaSuperiorMm", etiqueta: "Desviación superior", unidad: "mm", min: 0, max: 10, paso: 0.5, grupo: "Líneas medias" },
      { tipo: "opcion", clave: "lineaMediaInferior", etiqueta: "Línea media inferior", opciones: LINEA_MEDIA, grupo: "Líneas medias" },
      { tipo: "numero", clave: "lineaMediaInferiorMm", etiqueta: "Desviación inferior", unidad: "mm", min: 0, max: 10, paso: 0.5, grupo: "Líneas medias" },
      {
        tipo: "opcion",
        clave: "curvaDeSpee",
        etiqueta: "Curva de Spee",
        grupo: "Planos y curvas",
        opciones: [
          { valor: "normal", etiqueta: "Normal", normal: true },
          { valor: "plana", etiqueta: "Plana" },
          { valor: "profunda", etiqueta: "Profunda" },
          { valor: "invertida", etiqueta: "Invertida" },
        ],
      },
      {
        tipo: "opcion",
        clave: "planoOclusal",
        etiqueta: "Inclinación del plano oclusal",
        grupo: "Planos y curvas",
        opciones: [
          { valor: "paralelo", etiqueta: "Paralelo", normal: true },
          { valor: "derecha", etiqueta: "Inclinado a la derecha" },
          { valor: "izquierda", etiqueta: "Inclinado a la izquierda" },
        ],
      },
      {
        tipo: "opcion",
        clave: "curvaDeWilson",
        etiqueta: "Curva de Wilson",
        grupo: "Planos y curvas",
        opciones: [
          { valor: "normal", etiqueta: "Normal", normal: true },
          { valor: "plana", etiqueta: "Plana" },
          { valor: "aumentada", etiqueta: "Aumentada" },
          { valor: "invertida", etiqueta: "Invertida" },
        ],
      },
      { tipo: "opcion", clave: "arcoSuperior", etiqueta: "Arco superior", opciones: FORMA_DE_ARCO, grupo: "Forma de arcos" },
      { tipo: "opcion", clave: "arcoInferior", etiqueta: "Arco inferior", opciones: FORMA_DE_ARCO, grupo: "Forma de arcos" },
    ],
  },
  {
    clave: "dentoalveolar",
    titulo: "Dentoalveolar",
    campos: [
      { tipo: "opcion", clave: "espaciamientoSuperior", etiqueta: "Espaciamiento superior", opciones: INTENSIDAD, grupo: "Apiñamiento y espacios" },
      { tipo: "opcion", clave: "espaciamientoInferior", etiqueta: "Espaciamiento inferior", opciones: INTENSIDAD, grupo: "Apiñamiento y espacios" },
      {
        tipo: "opcion",
        clave: "cruzadaAnterior",
        etiqueta: "Mordida cruzada anterior",
        grupo: "Mordidas",
        opciones: [
          { valor: "no", etiqueta: "No presenta", normal: true },
          { valor: "dental", etiqueta: "Dental" },
          { valor: "funcional", etiqueta: "Funcional" },
          { valor: "esqueletica", etiqueta: "Esquelética" },
        ],
      },
      {
        tipo: "opcion",
        clave: "cruzadaPosterior",
        etiqueta: "Mordida cruzada posterior",
        grupo: "Mordidas",
        opciones: [
          { valor: "no", etiqueta: "No presenta", normal: true },
          { valor: "unilateral-derecha", etiqueta: "Unilateral derecha" },
          { valor: "unilateral-izquierda", etiqueta: "Unilateral izquierda" },
          { valor: "bilateral", etiqueta: "Bilateral" },
          { valor: "tijera", etiqueta: "En tijera" },
        ],
      },
      {
        tipo: "opcion",
        clave: "mordidaAbierta",
        etiqueta: "Mordida abierta",
        grupo: "Mordidas",
        opciones: [
          { valor: "no", etiqueta: "No presenta", normal: true },
          { valor: "anterior", etiqueta: "Anterior" },
          { valor: "posterior", etiqueta: "Posterior" },
          { valor: "completa", etiqueta: "Anterior y posterior" },
        ],
      },
      { tipo: "texto", clave: "ausentes", etiqueta: "Piezas ausentes", max: 200, grupo: "Piezas", pista: "FDI, p. ej. 15, 25" },
      { tipo: "texto", clave: "retenidas", etiqueta: "Piezas retenidas o incluidas", max: 200, grupo: "Piezas", pista: "FDI, p. ej. 13, 23" },
      { tipo: "texto", clave: "supernumerarios", etiqueta: "Supernumerarios / agenesias", max: 200, grupo: "Piezas" },
    ],
  },
  {
    clave: "funcional",
    titulo: "Funcional y respiratorio",
    campos: [
      {
        tipo: "opcion",
        clave: "respiracion",
        etiqueta: "Tipo de respiración",
        opciones: [{ valor: "nasal", etiqueta: "Nasal", normal: true }, { valor: "oral", etiqueta: "Oral" }, { valor: "mixta", etiqueta: "Mixta" }],
      },
      {
        tipo: "opcion",
        clave: "viaAerea",
        etiqueta: "Volumen de vía aérea",
        opciones: [{ valor: "normal", etiqueta: "Normal", normal: true }, { valor: "reducido", etiqueta: "Reducido" }, { valor: "muy-reducido", etiqueta: "Muy reducido" }],
      },
      {
        tipo: "varias",
        clave: "sueno",
        etiqueta: "Sueño",
        opciones: [
          { valor: "sin-alteraciones", etiqueta: "Sin alteraciones", normal: true },
          { valor: "ronquido", etiqueta: "Ronquido" },
          { valor: "apnea", etiqueta: "Apnea referida" },
          { valor: "sueno-inquieto", etiqueta: "Sueño inquieto" },
        ],
      },
      { tipo: "texto", clave: "otros", etiqueta: "Otros", max: 500, largo: true },
    ],
  },
  {
    clave: "cefalometria",
    titulo: "Análisis cefalométrico",
    campos: [
      { tipo: "numero", clave: "vertValor", etiqueta: "VERT", unidad: "", min: -5, max: 5, paso: 0.1, grupo: "VERT (Ricketts)" },
      { tipo: "opcion", clave: "vertNivel", etiqueta: "Nivel", opciones: NIVEL, grupo: "VERT (Ricketts)" },
      { tipo: "numero", clave: "porcentajeValor", etiqueta: "Porcentaje", unidad: "%", min: 40, max: 90, paso: 0.5, grupo: "Porcentaje (Jarabak)" },
      {
        tipo: "opcion",
        clave: "porcentajeTipo",
        etiqueta: "Tipo",
        grupo: "Porcentaje (Jarabak)",
        opciones: [
          { valor: "hiperdivergente", etiqueta: "Hiperdivergente" },
          { valor: "normodivergente", etiqueta: "Normodivergente", normal: true },
          { valor: "hipodivergente", etiqueta: "Hipodivergente" },
        ],
      },
      { tipo: "opcion", clave: "porcentajeNivel", etiqueta: "Nivel", opciones: NIVEL, grupo: "Porcentaje (Jarabak)" },
      { tipo: "opcion", clave: "clase", etiqueta: "Clase esquelética", opciones: CLASE, grupo: "Sagital" },
      {
        tipo: "opcion",
        clave: "componente",
        etiqueta: "Componente",
        grupo: "Sagital",
        opciones: [
          { valor: "maxilar", etiqueta: "Maxilar", neutro: true },
          { valor: "mandibular", etiqueta: "Mandibular", neutro: true },
          { valor: "combinado", etiqueta: "Combinado", neutro: true },
          { valor: "dentoalveolar", etiqueta: "Dentoalveolar", neutro: true },
        ],
      },
      { tipo: "numero", clave: "anb", etiqueta: "ANB", unidad: "°", min: -15, max: 15, paso: 0.5, grupo: "Sagital" },
      { tipo: "numero", clave: "wits", etiqueta: "Wits verdadero", unidad: "mm", min: -20, max: 20, paso: 0.5, grupo: "Sagital" },
      { tipo: "numero", clave: "excesoVerticalMaxilar", etiqueta: "Exceso vertical maxilar", unidad: "mm", min: -10, max: 20, paso: 0.5, grupo: "Vertical" },
      { tipo: "numero", clave: "incisivoInferiorStomion", etiqueta: "Incisivo inferior a stomion superior", unidad: "mm", min: -15, max: 15, paso: 0.5, grupo: "Vertical" },
      { tipo: "numero", clave: "incisivoSuperiorStomion", etiqueta: "Incisivo superior a stomion", unidad: "mm", min: -10, max: 15, paso: 0.5, grupo: "Vertical" },
      { tipo: "texto", clave: "analisisPenn", etiqueta: "Análisis Penn", max: 300, grupo: "Otros análisis" },
      {
        tipo: "opcion",
        clave: "anchoSinfisis",
        etiqueta: "Ancho de sínfisis",
        grupo: "Otros análisis",
        opciones: [
          { valor: "estrecha", etiqueta: "Estrecha" },
          { valor: "normal", etiqueta: "Normal", normal: true },
          { valor: "ancha", etiqueta: "Ancha" },
        ],
      },
      { tipo: "texto", clave: "otros", etiqueta: "Otros factores determinantes", max: 1000, largo: true, grupo: "Otros análisis" },
    ],
  },
];

// ─── Tipos ──────────────────────────────────────────────────────────────

export type ValorDx = string | number | string[] | null;
export type SeccionDx = Record<string, ValorDx>;
/**
 * Las medidas de la clasificación que son NOT NULL en la base (con CHECK de rango): al abrir un caso sin capturarlas se
 * guarda un valor neutro (0) y se ANOTA aquí que no son un dato real, para que el resumen las diga «sin capturar» en
 * vez de «0 mm».
 */
export const MEDIDAS_QUE_PUEDEN_FALTAR = ["overjetMm", "overbiteMm", "overbitePercentage"] as const;
export type MedidaQuePuedeFaltar = (typeof MEDIDAS_QUE_PUEDEN_FALTAR)[number];

export type DiagnosticoDetalle = Record<SeccionDelDetalle, SeccionDx> & {
  /** Medidas guardadas como relleno neutro (0): no son un dato real. Ausente o vacío = todas capturadas. */
  sinCapturar?: MedidaQuePuedeFaltar[];
};

const medidasSinCapturar = (d: DiagnosticoDetalle | null | undefined): readonly string[] => d?.sinCapturar ?? [];

/** La base como se DICE: las medidas de relleno (sin capturar) salen como «sin dato», no como un 0 real. */
export function baseSinRelleno(base: DiagnosticoBase, detalle: DiagnosticoDetalle | null | undefined): DiagnosticoBase {
  const faltan = medidasSinCapturar(detalle);
  if (faltan.length === 0) return base;
  return {
    ...base,
    ...(faltan.includes("overjetMm") ? { overjetMm: null } : {}),
    ...(faltan.includes("overbiteMm") ? { overbiteMm: null } : {}),
    ...(faltan.includes("overbitePercentage") ? { overbitePercentage: null } : {}),
  };
}

export const DIAGNOSTICO_DETALLE_VERSION = 1;

export function diagnosticoDetalleVacio(): DiagnosticoDetalle {
  const d = {} as DiagnosticoDetalle;
  for (const s of SECCIONES_DEL_DETALLE) {
    const sec: SeccionDx = {};
    for (const c of s.campos) sec[c.clave] = c.tipo === "varias" ? [] : null;
    d[s.clave] = sec;
  }
  return d;
}

function esVacio(v: ValorDx | undefined): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

export function esDiagnosticoDetalleVacio(d: DiagnosticoDetalle | null | undefined): boolean {
  if (!d) return true;
  if (medidasSinCapturar(d).length > 0) return false; // el aviso de «sin capturar» también se guarda
  return SECCIONES_DEL_DETALLE.every((s) => s.campos.every((c) => esVacio(d[s.clave]?.[c.clave])));
}

function limpiar(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : " ")).trim().slice(0, max);
  return t || null;
}

function numero(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/** Lo leído de la base, tolerante: lo desconocido o fuera de rango se descarta (no se inventa). */
export function normalizarDiagnosticoDetalle(raw: unknown): DiagnosticoDetalle {
  const salida = diagnosticoDetalleVacio();
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const s of SECCIONES_DEL_DETALLE) {
    const sec = o[s.clave] && typeof o[s.clave] === "object" ? (o[s.clave] as Record<string, unknown>) : {};
    for (const c of s.campos) {
      const v = sec[c.clave];
      if (c.tipo === "opcion") {
        salida[s.clave][c.clave] = typeof v === "string" && c.opciones.some((op) => op.valor === v) ? v : null;
      } else if (c.tipo === "varias") {
        const lista = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && c.opciones.some((op) => op.valor === x)) : [];
        salida[s.clave][c.clave] = [...new Set(lista)];
      } else if (c.tipo === "numero") {
        const n = numero(v);
        salida[s.clave][c.clave] = n !== null && n >= c.min && n <= c.max ? n : null;
      } else {
        salida[s.clave][c.clave] = limpiar(v, c.max);
      }
    }
  }
  const faltan = Array.isArray(o.sinCapturar)
    ? [...new Set(o.sinCapturar.filter((x): x is MedidaQuePuedeFaltar => (MEDIDAS_QUE_PUEDEN_FALTAR as readonly unknown[]).includes(x)))]
    : [];
  if (faltan.length > 0) salida.sinCapturar = faltan;
  return salida;
}

export type ResultadoDx = { ok: true; detalle: DiagnosticoDetalle } | { ok: false; error: string };

/** Lo que manda el cliente, ESTRICTO: una opción que no existe o un número fuera de rango es un error con nombre. */
export function validarDiagnosticoDetalle(raw: unknown): ResultadoDx {
  if (raw === null || raw === undefined) return { ok: true, detalle: diagnosticoDetalleVacio() };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Diagnóstico: formato inválido." };
  const o = raw as Record<string, unknown>;
  if (o.sinCapturar !== undefined && o.sinCapturar !== null) {
    if (!Array.isArray(o.sinCapturar) || o.sinCapturar.some((x) => !(MEDIDAS_QUE_PUEDEN_FALTAR as readonly unknown[]).includes(x))) {
      return { ok: false, error: "Diagnóstico: medidas sin capturar no válidas." };
    }
  }
  for (const k of Object.keys(o)) {
    if (k === "sinCapturar") continue;
    if (!(SECCIONES_DEL_DETALLE_CLAVES as readonly string[]).includes(k)) return { ok: false, error: `Diagnóstico: sección desconocida «${k}».` };
  }
  for (const s of SECCIONES_DEL_DETALLE) {
    const sec = o[s.clave];
    if (sec === undefined || sec === null) continue;
    if (typeof sec !== "object" || Array.isArray(sec)) return { ok: false, error: `${s.titulo}: formato inválido.` };
    const campos = new Map(s.campos.map((c) => [c.clave, c]));
    for (const [k, v] of Object.entries(sec as Record<string, unknown>)) {
      const c = campos.get(k);
      if (!c) return { ok: false, error: `${s.titulo}: campo desconocido «${k}».` };
      if (v === null || v === undefined || v === "") continue;
      const donde = `${s.titulo} · ${c.etiqueta}`;
      if (c.tipo === "opcion") {
        if (typeof v !== "string" || !c.opciones.some((op) => op.valor === v)) return { ok: false, error: `${donde}: opción no válida.` };
      } else if (c.tipo === "varias") {
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !c.opciones.some((op) => op.valor === x))) {
          return { ok: false, error: `${donde}: opción no válida.` };
        }
      } else if (c.tipo === "numero") {
        const n = numero(v);
        if (n === null) return { ok: false, error: `${donde}: escribe un número.` };
        if (n < c.min || n > c.max) return { ok: false, error: `${donde}: de ${c.min} a ${c.max}${c.unidad ? ` ${c.unidad}` : ""}.` };
      } else {
        if (typeof v !== "string") return { ok: false, error: `${donde}: texto inválido.` };
        if (v.trim().length > c.max) return { ok: false, error: `${donde}: máximo ${c.max} caracteres.` };
      }
    }
  }
  const detalle = normalizarDiagnosticoDetalle(o);
  // «Sin alteraciones» del sueño no convive con una alteración.
  const sueno = detalle.funcional.sueno as string[];
  if (sueno.includes("sin-alteraciones") && sueno.length > 1) {
    return { ok: false, error: "Funcional y respiratorio · Sueño: «Sin alteraciones» no va junto con una alteración." };
  }
  return { ok: true, detalle };
}

// ─── Lo de siempre (columnas) ───────────────────────────────────────────

export const CLASE_ANGLE: Record<string, string> = {
  CLASS_I: "Clase I",
  CLASS_II_DIV_1: "Clase II div. 1",
  CLASS_II_DIV_2: "Clase II div. 2",
  CLASS_III: "Clase III",
  ASYMMETRIC: "Asimétrica",
};
export const FASE_DENTAL: Record<string, string> = {
  DECIDUOUS: "Temporal",
  MIXED_EARLY: "Mixta temprana",
  MIXED_LATE: "Mixta tardía",
  PERMANENT: "Permanente",
};
export const PATRON_ESQUELETICO: Record<string, string> = {
  MESOFACIAL: "Mesofacial",
  DOLICOFACIAL: "Dolicofacial",
  BRAQUIFACIAL: "Braquifacial",
};
export const HABITO: Record<string, string> = {
  DIGITAL_SUCKING: "Succión digital",
  MOUTH_BREATHING: "Respiración bucal",
  TONGUE_THRUSTING: "Deglución atípica / empuje lingual",
  BRUXISM: "Bruxismo",
  NAIL_BITING: "Onicofagia",
  LIP_BITING: "Succión o mordida labial",
  OTHER: "Otro",
};

/** Las columnas de `orthodontic_diagnoses` que se leen (números ya convertidos de Decimal). */
export interface DiagnosticoBase {
  angleClassRight: string;
  angleClassLeft: string;
  overbiteMm: number | null;
  overbitePercentage: number | null;
  overjetMm: number | null;
  midlineDeviationMm: number | null;
  crowdingUpperMm: number | null;
  crowdingLowerMm: number | null;
  crossbite: boolean;
  crossbiteDetails: string | null;
  openBite: boolean;
  openBiteDetails: string | null;
  etiologySkeletal: boolean;
  etiologyDental: boolean;
  etiologyFunctional: boolean;
  etiologyNotes: string | null;
  habits: readonly string[];
  habitsDescription: string | null;
  dentalPhase: string | null;
  skeletalPattern: string | null;
  tmjPainPresent: boolean;
  tmjClickingPresent: boolean;
  tmjNotes: string | null;
  clinicalSummary: string | null;
}

// ─── Derivados: un dato, un lugar ───────────────────────────────────────
// Reglas del gerente (29-sep-2026): overjet/overbite se capturan en mm y su CATEGORÍA sale de los mm (no hay
// dos campos que se contradigan); la línea media se captura superior e inferior y la columna única
// `midlineDeviationMm` se DERIVA; el apiñamiento se captura en mm y su grado se deriva; la respiración oral
// vive en «Tipo de respiración», no como hábito; el patrón esquelético (columna) es el «tipo» del VERT.

/** Hábitos que se ofrecen: la respiración bucal se dice en «Tipo de respiración». */
export const HABITOS_DEL_PASO = ["DIGITAL_SUCKING", "TONGUE_THRUSTING", "BRUXISM", "NAIL_BITING", "LIP_BITING", "OTHER"] as const;

export type CategoriaOverjet = "normal" | "aumentado" | "disminuido" | "borde-a-borde" | "invertido";
export type CategoriaOverbite = "normal" | "aumentado" | "disminuido" | "borde-a-borde" | "mordida-abierta";

const ETIQ_CATEGORIA: Record<string, string> = {
  normal: "Normal",
  aumentado: "Aumentado",
  disminuido: "Disminuido",
  "borde-a-borde": "Borde a borde",
  invertido: "Invertido",
  "mordida-abierta": "Mordida abierta",
};
export const etiquetaDeCategoria = (c: string): string => ETIQ_CATEGORIA[c] ?? c;

/** Referencia usual: 1 a 4 mm. Negativo = invertido; 0 = borde a borde. */
export function categoriaOverjet(mm: number | null | undefined): CategoriaOverjet | null {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return null;
  if (mm < 0) return "invertido";
  if (mm === 0) return "borde-a-borde";
  if (mm < 1) return "disminuido";
  if (mm > 4) return "aumentado";
  return "normal";
}

/** Referencia usual: 1 a 4 mm. Negativo = mordida abierta; 0 = borde a borde. */
export function categoriaOverbite(mm: number | null | undefined): CategoriaOverbite | null {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return null;
  if (mm < 0) return "mordida-abierta";
  if (mm === 0) return "borde-a-borde";
  if (mm < 1) return "disminuido";
  if (mm > 4) return "aumentado";
  return "normal";
}

/** Grado del apiñamiento desde los mm (discrepancia): < 4 leve, 4 a 7 moderado, > 7 severo. */
export function gradoDeApinamiento(mm: number | null | undefined): "leve" | "moderado" | "severo" | null {
  if (mm === null || mm === undefined || !Number.isFinite(mm) || mm <= 0) return null;
  if (mm < 4) return "leve";
  if (mm <= 7) return "moderado";
  return "severo";
}

/**
 * La columna única `midlineDeviationMm`, derivada de las dos líneas medias: la desviación de mayor magnitud,
 * con signo (+ derecha, − izquierda). `undefined` = el detalle no dice nada (se respeta lo que había).
 */
export function lineaMediaDerivada(d: DiagnosticoDetalle): number | undefined {
  const lado = (estado: ValorDx, mm: ValorDx): number | null => {
    if (estado === "centrada") return 0;
    if (estado !== "derecha" && estado !== "izquierda") return null;
    const n = typeof mm === "number" ? mm : 0;
    return estado === "derecha" ? n : -n;
  };
  const s = lado(d.oclusal.lineaMediaSuperior, d.oclusal.lineaMediaSuperiorMm);
  const i = lado(d.oclusal.lineaMediaInferior, d.oclusal.lineaMediaInferiorMm);
  if (s === null && i === null) return undefined;
  const cands = [s, i].filter((x): x is number => x !== null);
  return cands.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
}

// ─── Lectura: renglones con su estado ───────────────────────────────────

export type EstadoDx = "normal" | "alterado" | "neutro";
export interface LineaDx {
  clave: string;
  etiqueta: string;
  valor: string;
  estado: EstadoDx;
}
export interface SeccionLegible {
  clave: string;
  titulo: string;
  lineas: LineaDx[];
}

export const fmtDx = (n: number, unidad: string): string =>
  `${Number.isInteger(n) ? n : n.toFixed(1)}${unidad ? (unidad === "°" || unidad === "%" ? unidad : ` ${unidad}`) : ""}`;

function estadoDeOpcion(op: OpcionDx | undefined): EstadoDx {
  if (!op) return "neutro";
  return op.normal ? "normal" : op.neutro ? "neutro" : "alterado";
}

export function etiquetaDeOpcion(seccion: SeccionDelDetalle, clave: string, valor: string): string {
  const c = SECCIONES_DEL_DETALLE.find((s) => s.clave === seccion)?.campos.find((x) => x.clave === clave);
  if (!c || (c.tipo !== "opcion" && c.tipo !== "varias")) return valor;
  return c.opciones.find((o) => o.valor === valor)?.etiqueta ?? valor;
}

/** Los renglones con dato de una sección del detalle (lo vacío no sale). La línea media junta estado + mm. */
function lineasDelDetalle(seccion: SeccionDelDetalle, sec: SeccionDx): LineaDx[] {
  const def = SECCIONES_DEL_DETALLE.find((s) => s.clave === seccion)!;
  const out: LineaDx[] = [];
  for (const c of def.campos) {
    const v = sec[c.clave];
    if (esVacio(v)) continue;
    if (c.clave === "lineaMediaSuperiorMm" || c.clave === "lineaMediaInferiorMm") continue;
    // «Tipo» y «Nivel» sueltos no se entienden fuera del formulario: se dicen con su grupo.
    const etiqueta = c.grupo && (c.etiqueta === "Tipo" || c.etiqueta === "Nivel") ? `${c.grupo.replace(/\s*\(.*\)$/, "")} · ${c.etiqueta.toLowerCase()}` : c.etiqueta;
    if (c.tipo === "opcion") {
      const op = c.opciones.find((o) => o.valor === v);
      let valor = op?.etiqueta ?? String(v);
      if (c.clave === "lineaMediaSuperior" || c.clave === "lineaMediaInferior") {
        const mm = sec[`${c.clave}Mm`];
        if (typeof mm === "number" && mm > 0 && v !== "centrada") valor = `${valor} ${fmtDx(mm, "mm")}`;
      }
      out.push({ clave: c.clave, etiqueta, valor, estado: estadoDeOpcion(op) });
    } else if (c.tipo === "varias") {
      const ops = (v as string[]).map((x) => c.opciones.find((o) => o.valor === x)).filter((o): o is OpcionDx => Boolean(o));
      out.push({ clave: c.clave, etiqueta, valor: ops.map((o) => o.etiqueta).join(", "), estado: ops.every((o) => o.normal) ? "normal" : "alterado" });
    } else if (c.tipo === "numero") {
      out.push({ clave: c.clave, etiqueta, valor: fmtDx(v as number, c.unidad), estado: "neutro" });
    } else {
      out.push({ clave: c.clave, etiqueta, valor: String(v), estado: "neutro" });
    }
  }
  return out;
}

/** El renglón de Angle: «Clase I bilateral» si coinciden, «der. Clase II div. 1 · izq. Clase I» si no. */
export function textoDeAngle(der: string, izq: string): string {
  const d = CLASE_ANGLE[der] ?? der;
  const i = CLASE_ANGLE[izq] ?? izq;
  return der === izq ? `${d} bilateral` : `der. ${d} · izq. ${i}`;
}

const estadoCat = (c: string | null): EstadoDx => (c === null ? "neutro" : c === "normal" ? "normal" : "alterado");

/** La respiración que se dice: la del detalle; si no hay y el hábito viejo «respiración bucal» está, «Oral». */
export function respiracionEfectiva(base: DiagnosticoBase | null, d: DiagnosticoDetalle): string | null {
  const r = d.funcional.respiracion as string | null;
  if (r) return r;
  return base?.habits.includes("MOUTH_BREATHING") ? "oral" : null;
}

/**
 * El diagnóstico COMPLETO en secciones legibles, para la ficha, el PDF del plan, el expediente PDF y Sabina.
 * Solo lo que tiene dato: una sección sin nada no sale.
 */
export function seccionesDelDiagnostico(baseCruda: DiagnosticoBase | null, detalle: DiagnosticoDetalle | null): SeccionLegible[] {
  const d = detalle ?? diagnosticoDetalleVacio();
  // Las medidas de relleno («sin capturar») no salen como dato real.
  const base = baseCruda ? baseSinRelleno(baseCruda, detalle) : null;
  const out: SeccionLegible[] = [];

  if (base) {
    const cl: LineaDx[] = [];
    cl.push({
      clave: "angle",
      etiqueta: "Clase de Angle (dental)",
      valor: textoDeAngle(base.angleClassRight, base.angleClassLeft),
      estado: base.angleClassRight === "CLASS_I" && base.angleClassLeft === "CLASS_I" ? "normal" : "alterado",
    });
    if (base.overjetMm !== null) {
      const c = categoriaOverjet(base.overjetMm);
      cl.push({ clave: "overjetMm", etiqueta: "Overjet", valor: `${fmtDx(base.overjetMm, "mm")}${c ? ` · ${etiquetaDeCategoria(c).toLowerCase()}` : ""}`, estado: estadoCat(c) });
    }
    if (base.overbiteMm !== null) {
      const c = categoriaOverbite(base.overbiteMm);
      const pct = base.overbitePercentage ? ` (${base.overbitePercentage}%)` : "";
      cl.push({ clave: "overbiteMm", etiqueta: "Overbite", valor: `${fmtDx(base.overbiteMm, "mm")}${pct}${c ? ` · ${etiquetaDeCategoria(c).toLowerCase()}` : ""}`, estado: estadoCat(c) });
    }
    if (base.dentalPhase) cl.push({ clave: "dentalPhase", etiqueta: "Etapa de dentición", valor: FASE_DENTAL[base.dentalPhase] ?? base.dentalPhase, estado: "neutro" });
    out.push({ clave: "clasificacion", titulo: "Clasificación", lineas: cl });
  }

  const facial = lineasDelDetalle("facial", d.facial);
  if (facial.length) out.push({ clave: "facial", titulo: "Características faciales", lineas: facial });

  const oclusal = lineasDelDetalle("oclusal", d.oclusal);
  if (base && !d.oclusal.lineaMediaSuperior && !d.oclusal.lineaMediaInferior && base.midlineDeviationMm !== null) {
    oclusal.unshift({
      clave: "midlineDeviationMm",
      etiqueta: "Línea media",
      valor: base.midlineDeviationMm === 0 ? "Centrada" : `Desviada ${fmtDx(Math.abs(base.midlineDeviationMm), "mm")}`,
      estado: base.midlineDeviationMm === 0 ? "normal" : "alterado",
    });
  }
  if (oclusal.length) out.push({ clave: "oclusal", titulo: "Análisis oclusal y dentario", lineas: oclusal });

  const dento: LineaDx[] = [];
  for (const [clave, etiqueta, mm] of [
    ["crowdingUpperMm", "Apiñamiento superior", base?.crowdingUpperMm ?? null],
    ["crowdingLowerMm", "Apiñamiento inferior", base?.crowdingLowerMm ?? null],
  ] as const) {
    const g = gradoDeApinamiento(mm);
    if (mm && g) dento.push({ clave, etiqueta, valor: `${fmtDx(mm, "mm")} · ${g}`, estado: "alterado" });
  }
  dento.push(...lineasDelDetalle("dentoalveolar", d.dentoalveolar));
  if (base?.crossbite && !d.dentoalveolar.cruzadaAnterior && !d.dentoalveolar.cruzadaPosterior) {
    dento.push({ clave: "crossbite", etiqueta: "Mordida cruzada", valor: "Presente", estado: "alterado" });
  }
  if (base?.crossbiteDetails) dento.push({ clave: "crossbiteDetails", etiqueta: "Detalle de la mordida cruzada", valor: base.crossbiteDetails, estado: "neutro" });
  if (base?.openBite && !d.dentoalveolar.mordidaAbierta) dento.push({ clave: "openBite", etiqueta: "Mordida abierta", valor: "Presente", estado: "alterado" });
  if (base?.openBiteDetails) dento.push({ clave: "openBiteDetails", etiqueta: "Detalle de la mordida abierta", valor: base.openBiteDetails, estado: "neutro" });
  if (dento.length) out.push({ clave: "dentoalveolar", titulo: "Dentoalveolar", lineas: dento });

  const func = lineasDelDetalle("funcional", d.funcional);
  const resp = respiracionEfectiva(base, d);
  if (resp && !d.funcional.respiracion) {
    func.unshift({ clave: "respiracion", etiqueta: "Tipo de respiración", valor: etiquetaDeOpcion("funcional", "respiracion", resp), estado: resp === "nasal" ? "normal" : "alterado" });
  }
  if (base) {
    const habitos = base.habits.filter((h) => h !== "MOUTH_BREATHING");
    if (habitos.length) func.push({ clave: "habits", etiqueta: "Hábitos", valor: habitos.map((h) => HABITO[h] ?? h).join(", "), estado: "alterado" });
    if (base.habitsDescription) func.push({ clave: "habitsDescription", etiqueta: "Descripción de hábitos", valor: base.habitsDescription, estado: "neutro" });
    const atm = [base.tmjPainPresent ? "dolor" : null, base.tmjClickingPresent ? "chasquido" : null].filter(Boolean) as string[];
    func.push({ clave: "atm", etiqueta: "ATM", valor: atm.length ? `Con ${atm.join(" y ")}` : "Sin dolor ni chasquido", estado: atm.length ? "alterado" : "normal" });
    if (base.tmjNotes) func.push({ clave: "tmjNotes", etiqueta: "Notas de ATM", valor: base.tmjNotes, estado: "neutro" });
  }
  if (func.length) out.push({ clave: "funcional", titulo: "Funcional, respiratorio y ATM", lineas: func });

  const cef = lineasDelDetalle("cefalometria", d.cefalometria);
  if (base?.skeletalPattern) {
    // El patrón esquelético de siempre ES el «tipo» del VERT: va junto a él, no en otra sección.
    const i = cef.findIndex((l) => l.clave === "vertValor");
    cef.splice(i >= 0 ? i + 1 : 0, 0, {
      clave: "skeletalPattern",
      etiqueta: "Patrón esquelético",
      valor: PATRON_ESQUELETICO[base.skeletalPattern] ?? base.skeletalPattern,
      estado: base.skeletalPattern === "MESOFACIAL" ? "normal" : "alterado",
    });
  }
  if (cef.length) out.push({ clave: "cefalometria", titulo: "Análisis cefalométrico", lineas: cef });

  if (base) {
    const et: LineaDx[] = [];
    const tipos = [base.etiologySkeletal ? "esquelética" : null, base.etiologyDental ? "dental" : null, base.etiologyFunctional ? "funcional" : null].filter(Boolean) as string[];
    if (tipos.length) et.push({ clave: "etiologia", etiqueta: "Etiología", valor: tipos.join(", ").replace(/^./, (c) => c.toUpperCase()), estado: "neutro" });
    if (base.etiologyNotes) et.push({ clave: "etiologyNotes", etiqueta: "Notas de etiología", valor: base.etiologyNotes, estado: "neutro" });
    if (et.length) out.push({ clave: "etiologia", titulo: "Etiología", lineas: et });
  }
  return out;
}

// ─── Los valores clave (la franja de arriba de la sección) ──────────────

export interface IndicadorDx {
  clave: "angle" | "overjet" | "overbite" | "claseFacial" | "lineaMedia";
  etiqueta: string;
  valor: string;
  detalle: string | null;
  estado: EstadoDx | null;
}

export function indicadoresClave(baseCruda: DiagnosticoBase, detalle: DiagnosticoDetalle | null): IndicadorDx[] {
  const d = detalle ?? diagnosticoDetalleVacio();
  const base = baseSinRelleno(baseCruda, detalle);
  const cortoAngle = (k: string) => (CLASE_ANGLE[k] ?? k).replace("Clase ", "");
  const oj = categoriaOverjet(base.overjetMm);
  const ob = categoriaOverbite(base.overbiteMm);
  const facial = d.facial.claseFacialSagital as string | null;
  const lmS = d.oclusal.lineaMediaSuperior as string | null;
  const lmI = d.oclusal.lineaMediaInferior as string | null;

  let lineaValor = "—";
  let lineaDetalle: string | null = null;
  let lineaEstado: EstadoDx | null = null;
  const lado = (k: string, mm: ValorDx) =>
    k === "centrada" ? "centrada" : `${k === "derecha" ? "der." : "izq."}${typeof mm === "number" && mm > 0 ? ` ${fmtDx(mm, "mm")}` : ""}`;
  if (lmS || lmI) {
    const desviadas = [lmS, lmI].filter((x) => x && x !== "centrada").length;
    lineaValor = desviadas === 0 ? "Centradas" : desviadas === 2 ? "Desviadas" : "Una desviada";
    lineaDetalle = [lmS ? `sup. ${lado(lmS, d.oclusal.lineaMediaSuperiorMm)}` : null, lmI ? `inf. ${lado(lmI, d.oclusal.lineaMediaInferiorMm)}` : null]
      .filter(Boolean)
      .join(" · ");
    lineaEstado = desviadas === 0 ? "normal" : "alterado";
  } else if (base.midlineDeviationMm !== null) {
    lineaValor = base.midlineDeviationMm === 0 ? "Centrada" : fmtDx(Math.abs(base.midlineDeviationMm), "mm");
    lineaDetalle = base.midlineDeviationMm === 0 ? null : "desviación";
    lineaEstado = base.midlineDeviationMm === 0 ? "normal" : "alterado";
  }

  return [
    {
      clave: "angle",
      etiqueta: "Angle",
      valor:
        base.angleClassRight === base.angleClassLeft
          ? cortoAngle(base.angleClassRight)
          : `${cortoAngle(base.angleClassRight)} / ${cortoAngle(base.angleClassLeft)}`,
      detalle: base.angleClassRight === base.angleClassLeft ? "bilateral" : "der. / izq.",
      estado: base.angleClassRight === "CLASS_I" && base.angleClassLeft === "CLASS_I" ? "normal" : "alterado",
    },
    {
      clave: "overjet",
      etiqueta: "Overjet",
      valor: base.overjetMm !== null ? fmtDx(base.overjetMm, "mm") : "—",
      detalle: oj ? etiquetaDeCategoria(oj).toLowerCase() : null,
      estado: oj ? estadoCat(oj) : null,
    },
    {
      clave: "overbite",
      etiqueta: "Overbite",
      valor: base.overbiteMm !== null ? fmtDx(base.overbiteMm, "mm") : "—",
      detalle: [base.overbitePercentage ? `${base.overbitePercentage}%` : null, ob ? etiquetaDeCategoria(ob).toLowerCase() : null].filter(Boolean).join(" · ") || null,
      estado: ob ? estadoCat(ob) : null,
    },
    {
      clave: "claseFacial",
      etiqueta: "Clase facial",
      valor: facial ? `Clase ${facial}` : "—",
      detalle: facial ? "sagital" : null,
      estado: facial ? (facial === "I" ? "normal" : "alterado") : null,
    },
    { clave: "lineaMedia", etiqueta: "Línea media", valor: lineaValor, detalle: lineaDetalle, estado: lineaEstado },
  ];
}

// ─── Qué cambió (Movimientos del paciente) ──────────────────────────────

/** Secciones de la ficha a las que pertenece cada columna (para la frase de Movimientos). */
const SECCION_DE_COLUMNA: Record<string, string> = {
  angleClassRight: "clasificación",
  angleClassLeft: "clasificación",
  overbiteMm: "clasificación",
  overbitePercentage: "clasificación",
  overjetMm: "clasificación",
  dentalPhase: "clasificación",
  skeletalPattern: "cefalometría",
  midlineDeviationMm: "análisis oclusal",
  initialPhotoSetId: "registros iniciales",
  initialCephFileId: "registros iniciales",
  initialScanFileId: "registros iniciales",
  crowdingUpperMm: "dentoalveolar",
  crowdingLowerMm: "dentoalveolar",
  crossbite: "dentoalveolar",
  crossbiteDetails: "dentoalveolar",
  openBite: "dentoalveolar",
  openBiteDetails: "dentoalveolar",
  habits: "hábitos",
  habitsDescription: "hábitos",
  tmjPainPresent: "ATM",
  tmjClickingPresent: "ATM",
  tmjNotes: "ATM",
  etiologySkeletal: "etiología",
  etiologyDental: "etiología",
  etiologyFunctional: "etiología",
  etiologyNotes: "etiología",
  clinicalSummary: "resumen diagnóstico",
};
const SECCION_DEL_DETALLE_CORTA: Record<SeccionDelDetalle, string> = {
  facial: "características faciales",
  oclusal: "análisis oclusal",
  dentoalveolar: "dentoalveolar",
  funcional: "funcional y respiratorio",
  cefalometria: "cefalometría",
};

/** Las secciones del detalle que cambiaron, con los nombres de campo `diagnosticoDetalle.<sección>.<campo>`. */
export function cambiosDelDetalle(antes: DiagnosticoDetalle | null, despues: DiagnosticoDetalle): { secciones: SeccionDelDetalle[]; campos: string[] } {
  const a = antes ?? diagnosticoDetalleVacio();
  const secciones: SeccionDelDetalle[] = [];
  const campos: string[] = [];
  for (const s of SECCIONES_DEL_DETALLE) {
    let toca = false;
    for (const c of s.campos) {
      if (JSON.stringify(a[s.clave][c.clave] ?? null) !== JSON.stringify(despues[s.clave][c.clave] ?? null)) {
        campos.push(`diagnosticoDetalle.${s.clave}.${c.clave}`);
        toca = true;
      }
    }
    if (toca) secciones.push(s.clave);
  }
  return { secciones, campos };
}

function unirConY(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/** «Actualizó el diagnóstico de ortodoncia: características faciales y cefalometría». Sin valores clínicos. */
export function textoDeMovimientoDelDiagnostico(columnas: readonly string[], seccionesDetalle: readonly SeccionDelDetalle[]): string {
  const nombres: string[] = [];
  for (const c of columnas) {
    const n = SECCION_DE_COLUMNA[c];
    if (n && !nombres.includes(n)) nombres.push(n);
  }
  for (const s of seccionesDetalle) {
    const n = SECCION_DEL_DETALLE_CORTA[s];
    if (!nombres.includes(n)) nombres.push(n);
  }
  const base = "Actualizó el diagnóstico de ortodoncia";
  if (nombres.length === 0) return base;
  if (nombres.length > 4) return `${base}: ${nombres.slice(0, 4).join(", ")} y ${nombres.length - 4} apartado${nombres.length - 4 === 1 ? "" : "s"} más`;
  return `${base}: ${unirConY(nombres)}`;
}

/**
 * Lo que el detalle dice de las mordidas, para mantener las columnas de siempre (`crossbite`, `openBite`) al
 * día: `undefined` = el detalle no dice nada (se respeta lo que había).
 */
export function mordidasDerivadas(d: DiagnosticoDetalle): { crossbite?: boolean; openBite?: boolean } {
  const out: { crossbite?: boolean; openBite?: boolean } = {};
  const ant = d.dentoalveolar.cruzadaAnterior as string | null;
  const post = d.dentoalveolar.cruzadaPosterior as string | null;
  if (ant || post) out.crossbite = Boolean((ant && ant !== "no") || (post && post !== "no"));
  const ab = d.dentoalveolar.mordidaAbierta as string | null;
  if (ab) out.openBite = ab !== "no";
  return out;
}

/** Cuántos campos con dato tiene una sección del detalle (el contador del índice del paso). */
export function camposConDato(d: DiagnosticoDetalle, seccion: SeccionDelDetalle): number {
  return SECCIONES_DEL_DETALLE.find((s) => s.clave === seccion)!.campos.filter((c) => !esVacio(d[seccion][c.clave])).length;
}

/**
 * Qué le falta al diagnóstico para darse por completo (para «Casos con diagnóstico o plan incompleto» del
 * Tablero/Alertas, ws1-t12, y para el índice del paso). Vacío = completo. Los casos migrados de Dentalink
 * entran con el resumen de relleno y sin detalle: aquí salen.
 */
export function faltaDelDiagnostico(base: DiagnosticoBase | null, detalle: DiagnosticoDetalle | null): string[] {
  if (!base) return ["diagnóstico"];
  const d = detalle ?? diagnosticoDetalleVacio();
  const falta: string[] = [];
  if (camposConDato(d, "facial") === 0) falta.push("características faciales");
  if (!d.oclusal.lineaMediaSuperior && !d.oclusal.lineaMediaInferior && base.midlineDeviationMm === null) falta.push("líneas medias");
  if (!respiracionEfectiva(base, d)) falta.push("tipo de respiración");
  if (medidasSinCapturar(detalle).length > 0) falta.push("overjet y overbite");
  if (!(base.clinicalSummary ?? "").trim()) falta.push("resumen diagnóstico");
  return falta;
}
