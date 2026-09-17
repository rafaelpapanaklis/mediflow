/**
 * Lo CLÍNICO de un plan de tratamiento dental, en funciones puras.
 *
 * `model TreatmentPlan` guarda nombre, sesiones, intervalo y costo; no tiene
 * dónde poner dientes, caras, fases ni alternativas. Mientras Rafael decide
 * las tablas nuevas (reporte ws1-t2, punto 3), la ventana recoge todo eso y
 * lo escribe como TEXTO ordenado en `description`: el único campo libre del
 * plan, que ni el cron de seguimiento ni el portal del paciente leen
 * (`patient-portal/types.ts`: «TreatmentPlan: … NUNCA description»).
 *
 * ⛔ `name` NO se toca aquí: viaja en el WhatsApp de seguimiento
 * (`api/cron/treatment-followup`), así que se queda corto y limpio.
 *
 * Nada de esto cambia lo que recibe `POST /api/treatments`: los mismos siete
 * campos de siempre, con los mismos tipos.
 */

/** Las fases con las que se ordena un plan dental, en su orden clínico. */
export const FASES = ["urgencia", "sistemica", "higienica", "correctiva", "restauradora", "mantenimiento"] as const;
export type Fase = (typeof FASES)[number];

/** Clave i18n del nombre de cada fase. */
export const FASE_CLAVE: Record<Fase, string> = {
  urgencia: "planTratamiento.fase.urgencia",
  sistemica: "planTratamiento.fase.sistemica",
  higienica: "planTratamiento.fase.higienica",
  correctiva: "planTratamiento.fase.correctiva",
  restauradora: "planTratamiento.fase.restauradora",
  mantenimiento: "planTratamiento.fase.mantenimiento",
};

export const PRONOSTICOS = ["bueno", "reservado", "malo"] as const;
export type Pronostico = (typeof PRONOSTICOS)[number] | "";

export const PRONOSTICO_CLAVE: Record<Exclude<Pronostico, "">, string> = {
  bueno: "planTratamiento.pronostico.bueno",
  reservado: "planTratamiento.pronostico.reservado",
  malo: "planTratamiento.pronostico.malo",
};

/** Un procedimiento del plan: qué, dónde, en qué fase y cuánto. */
export interface Renglon {
  id: string;
  fase: Fase;
  procedimiento: string;
  /** id del tarifario (`ProcedureCatalog`) si el nombre salió de ahí. */
  procedimientoId: string | null;
  /** Dientes FDI tal como se teclean: «16, 26». */
  dientes: string;
  /** Caras marcadas, en el orden en que se leen: M O D V L. */
  caras: string[];
  /** El hallazgo que lo justifica («Caries»). */
  motivo: string;
  cantidad: string;
  precio: string;
  /** El precio lo puso el tarifario (y no una mano): se puede volver a pisar. */
  precioDelTarifario: boolean;
  /** Minutos de sillón (del tarifario); 0 = no se sabe. */
  minutos: number;
}

export interface PlanClinico {
  diagnostico: string;
  pronostico: Pronostico;
  renglones: Renglon[];
  alternativa: string;
  notas: string;
}

export const PLAN_VACIO: PlanClinico = { diagnostico: "", pronostico: "", renglones: [], alternativa: "", notas: "" };

/** El orden de lectura de las caras; la del centro es O (posterior) o I (anterior). */
export const CARAS = ["M", "O", "D", "V", "L"] as const;

// ── Dientes ────────────────────────────────────────────────────────────────

/** ¿Es un número FDI que existe? Permanentes 11–48, temporales 51–85. */
export function esFdi(n: number): boolean {
  if (!Number.isInteger(n)) return false;
  const cuadrante = Math.floor(n / 10);
  const pieza = n % 10;
  if (cuadrante >= 1 && cuadrante <= 4) return pieza >= 1 && pieza <= 8;
  if (cuadrante >= 5 && cuadrante <= 8) return pieza >= 1 && pieza <= 5;
  return false;
}

/** «16, 26 y 99» → { dientes: [16, 26], invalidos: ["99"] }, sin repetidos. */
export function leerDientes(texto: string): { dientes: number[]; invalidos: string[] } {
  const dientes: number[] = [];
  const invalidos: string[] = [];
  for (const trozo of texto.split(/[^0-9a-zA-Z]+/).filter(Boolean)) {
    const n = Number(trozo);
    if (/^\d+$/.test(trozo) && esFdi(n)) {
      if (!dientes.includes(n)) dientes.push(n);
    } else if (!/^y$/i.test(trozo)) {
      invalidos.push(trozo);
    }
  }
  return { dientes, invalidos };
}

/** Un diente anterior (incisivos y caninos) tiene borde incisal, no cara oclusal. */
export function esAnterior(fdi: number): boolean {
  return fdi % 10 <= 3;
}

/** La letra con la que se ENSEÑA la cara del centro para los dientes del renglón. */
export function letraCentro(dientes: number[]): "O" | "I" {
  return dientes.length > 0 && dientes.every(esAnterior) ? "I" : "O";
}

/** Pone o quita un diente del texto, conservando el orden en que se eligieron. */
export function alternarDiente(texto: string, fdi: number): string {
  const { dientes } = leerDientes(texto);
  const sig = dientes.includes(fdi) ? dientes.filter((d) => d !== fdi) : [...dientes, fdi];
  return sig.join(", ");
}

// ── Cuentas ────────────────────────────────────────────────────────────────

const numero = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function importeRenglon(r: Renglon): number {
  const cantidad = r.cantidad.trim() === "" ? 1 : numero(r.cantidad);
  return Math.round(cantidad * numero(r.precio) * 100) / 100;
}

/** Los renglones que dicen algo (con procedimiento), en orden de fase. */
export function renglonesUtiles(renglones: Renglon[]): Renglon[] {
  return renglones
    .filter((r) => r.procedimiento.trim() !== "")
    .map((r, i) => ({ r, i }))
    .sort((a, b) => FASES.indexOf(a.r.fase) - FASES.indexOf(b.r.fase) || a.i - b.i)
    .map((x) => x.r);
}

export function subtotalesPorFase(renglones: Renglon[]): { fase: Fase; renglones: Renglon[]; subtotal: number }[] {
  const utiles = renglonesUtiles(renglones);
  return FASES
    .map((fase) => {
      const suyos = utiles.filter((r) => r.fase === fase);
      return { fase, renglones: suyos, subtotal: Math.round(suyos.reduce((a, r) => a + importeRenglon(r), 0) * 100) / 100 };
    })
    .filter((f) => f.renglones.length > 0);
}

export function totalProcedimientos(renglones: Renglon[]): number {
  return Math.round(renglonesUtiles(renglones).reduce((a, r) => a + importeRenglon(r), 0) * 100) / 100;
}

/** Sin duración en el tarifario se supone una cita corta de sillón. */
export const MINUTOS_POR_DEFECTO = 45;
/** Lo que razonablemente se trabaja en una cita. */
export const MINUTOS_POR_SESION = 60;

/**
 * Sesiones que pide el plan: por fase, los minutos de sillón repartidos en
 * citas de una hora. Cada fase pide al menos una cita (no se mezclan fases en
 * la misma silla: entre ellas hay reevaluación o cicatrización).
 */
export function sesionesSugeridas(renglones: Renglon[]): number {
  let total = 0;
  for (const f of subtotalesPorFase(renglones)) {
    const minutos = f.renglones.reduce((a, r) => {
      const cantidad = r.cantidad.trim() === "" ? 1 : Math.max(1, numero(r.cantidad));
      return a + cantidad * (r.minutos > 0 ? r.minutos : MINUTOS_POR_DEFECTO);
    }, 0);
    total += Math.max(1, Math.ceil(minutos / MINUTOS_POR_SESION));
  }
  return total;
}

// ── Orden clínico: lo que depende de qué ───────────────────────────────────

const ES_ENDODONCIA = /endodon|conducto|pulpotom|pulpectom/i;
const ES_CORONA_O_POSTE = /corona|poste|perno|mu[ñn][oó]n|incrustaci|onlay|inlay|carilla|puente/i;
const ES_EXTRACCION = /extracci|exodon/i;
const ES_IMPLANTE = /implante/i;

export type AvisoOrden =
  | { tipo: "endoAntesDeCorona"; diente: number }
  | { tipo: "cicatrizacionAntesDeImplante"; diente: number };

/**
 * Dos dependencias duras que un plan no puede llevar al revés:
 *  · en un mismo diente, la endodoncia va ANTES que el poste o la corona;
 *  · entre extraer y poner el implante hay cicatrización: no van en la misma fase
 *    (salvo implante inmediato, que el doctor decide: por eso es aviso y no bloqueo).
 */
export function avisosDeOrden(renglones: Renglon[]): AvisoOrden[] {
  const utiles = renglonesUtiles(renglones);
  const avisos: AvisoOrden[] = [];
  const fase = (r: Renglon) => FASES.indexOf(r.fase);
  const dientesDe = (r: Renglon) => leerDientes(r.dientes).dientes;
  const vistos = new Set<string>();
  const avisar = (a: AvisoOrden) => {
    const k = `${a.tipo}:${a.diente}`;
    if (!vistos.has(k)) { vistos.add(k); avisos.push(a); }
  };

  for (const a of utiles) {
    for (const b of utiles) {
      if (a === b) continue;
      const comunes = dientesDe(a).filter((d) => dientesDe(b).includes(d));
      for (const diente of comunes) {
        if (ES_ENDODONCIA.test(a.procedimiento) && ES_CORONA_O_POSTE.test(b.procedimiento) && fase(b) < fase(a)) {
          avisar({ tipo: "endoAntesDeCorona", diente });
        }
        if (ES_EXTRACCION.test(a.procedimiento) && ES_IMPLANTE.test(b.procedimiento) && fase(b) <= fase(a)) {
          avisar({ tipo: "cicatrizacionAntesDeImplante", diente });
        }
      }
    }
  }
  return avisos;
}

// ── El texto que se guarda en `description` ────────────────────────────────

export interface Rotulos {
  diagnostico: string;
  pronostico: string;
  total: string;
  alternativa: string;
  notas: string;
  por: string;
  fase: (f: Fase) => string;
  pronosticoValor: (p: Exclude<Pronostico, "">) => string;
  dinero: (n: number) => string;
}

/** Con lo que empieza una descripción escrita por esta ventana. */
export const MARCA_PLAN = "▸ ";

export function esDescripcionDePlan(descripcion: string | null | undefined): boolean {
  return !!descripcion && descripcion.startsWith(MARCA_PLAN);
}

function lineaRenglon(r: Renglon, rot: Rotulos): string {
  const { dientes } = leerDientes(r.dientes);
  const centro = letraCentro(dientes);
  const caras = CARAS.filter((c) => r.caras.includes(c)).map((c) => (c === "O" ? centro : c)).join("");
  const donde = dientes.length > 0 ? ` — ${dientes.join(", ")}${caras ? ` (${caras})` : ""}` : "";
  const cantidad = r.cantidad.trim() === "" ? 1 : numero(r.cantidad);
  const precio = numero(r.precio);
  const cuanto = precio > 0 ? ` · ${cantidad} × ${rot.dinero(precio)} = ${rot.dinero(importeRenglon(r))}` : "";
  const motivo = r.motivo.trim() ? ` · ${rot.por} ${r.motivo.trim()}` : "";
  return `• ${r.procedimiento.trim()}${donde}${cuanto}${motivo}`;
}

/**
 * El plan clínico como texto. Si no se llenó NADA clínico devuelve las notas
 * tal cual —lo mismo que mandaba la ventana de siempre—, de modo que quien
 * usa el plan como hoy guarda exactamente lo de hoy.
 */
export function componerDescripcion(plan: PlanClinico, rot: Rotulos): string {
  const notas = plan.notas.trim();
  const fases = subtotalesPorFase(plan.renglones);
  const hayClinico = plan.diagnostico.trim() || plan.pronostico || fases.length > 0 || plan.alternativa.trim();
  if (!hayClinico) return notas;

  const bloques: string[] = [];
  const cabeza: string[] = [];
  if (plan.diagnostico.trim()) cabeza.push(`${MARCA_PLAN}${rot.diagnostico}: ${plan.diagnostico.trim()}`);
  if (plan.pronostico) cabeza.push(`${MARCA_PLAN}${rot.pronostico}: ${rot.pronosticoValor(plan.pronostico)}`);
  if (cabeza.length > 0) bloques.push(cabeza.join("\n"));

  for (const f of fases) {
    const titulo = `${MARCA_PLAN}${rot.fase(f.fase)}${f.subtotal > 0 ? ` — ${rot.dinero(f.subtotal)}` : ""}`;
    bloques.push([titulo, ...f.renglones.map((r) => lineaRenglon(r, rot))].join("\n"));
  }
  const total = totalProcedimientos(plan.renglones);
  if (fases.length > 0 && total > 0) bloques.push(`${MARCA_PLAN}${rot.total}: ${rot.dinero(total)}`);
  if (plan.alternativa.trim()) bloques.push(`${MARCA_PLAN}${rot.alternativa}: ${plan.alternativa.trim()}`);
  if (notas) bloques.push(`${MARCA_PLAN}${rot.notas}: ${notas}`);
  return bloques.join("\n\n");
}

// ── Del odontograma al plan ────────────────────────────────────────────────

/**
 * Los hallazgos del odontograma que PIDEN tratamiento (la lista de problemas
 * de la que nace un plan) y la fase en la que de entrada se atienden. Los ids
 * son los de `odontogram-v2/data.ts`; lo que no está aquí es trabajo ya hecho
 * (restauraciones, coronas, implantes) o un dato que no se trata por sí solo.
 */
export const HALLAZGO_FASE: Record<string, Fase> = {
  pulpitis: "urgencia",
  fracture: "urgencia",
  caries: "higienica",
  caries_inc: "higienica",
  necrosis: "higienica",
  periapical1: "higienica",
  periapical2: "higienica",
  periapical3: "higienica",
  ext_indicated: "higienica",
  root_remnant: "higienica",
  temp_rest: "higienica",
  calculus: "higienica",
  pocket: "higienica",
  bleeding: "higienica",
  impacted: "correctiva",
  recession: "correctiva",
  furcation: "correctiva",
  mobility: "correctiva",
  perio_mobility: "correctiva",
  missing: "restauradora",
};

export interface EntradaOdontograma { toothNumber: number; surface: string | null; conditionId: string }

export interface Hallazgo {
  clave: string;
  diente: number;
  caras: string[];
  conditionId: string;
  fase: Fase;
}

/** Un hallazgo por (diente, condición), con sus caras juntas: «16 · MO · Caries». */
export function hallazgosPorTratar(entradas: EntradaOdontograma[]): Hallazgo[] {
  const mapa = new Map<string, Hallazgo>();
  for (const e of entradas) {
    const fase = HALLAZGO_FASE[e.conditionId];
    if (!fase || !esFdi(e.toothNumber)) continue;
    const clave = `${e.toothNumber}:${e.conditionId}`;
    const h = mapa.get(clave) ?? { clave, diente: e.toothNumber, caras: [], conditionId: e.conditionId, fase };
    if (e.surface && (CARAS as readonly string[]).includes(e.surface) && !h.caras.includes(e.surface)) h.caras.push(e.surface);
    mapa.set(clave, h);
  }
  return [...mapa.values()].sort((a, b) => FASES.indexOf(a.fase) - FASES.indexOf(b.fase) || a.diente - b.diente);
}
