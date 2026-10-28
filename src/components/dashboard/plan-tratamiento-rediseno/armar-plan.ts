/**
 * «Armar el plan» rápido (ws1-t5, fase 2 · P3): lo que la ventana hace con los hallazgos del
 * odontograma, en funciones PURAS (sin React; lo prueban las pruebas).
 *
 *  · `chipsDelPlan`: un chip por hallazgo por tratar con el procedimiento que se le sugiere
 *    (`sugerir-procedimiento.ts`); los de toda la boca (cálculo → limpieza) van juntos en UN chip
 *    y los de un cuadrante (bolsa → raspado) en uno por cuadrante. Al poner un hallazgo en el
 *    plan aparecen sus sugerencias encadenadas («36 · sugerido: Corona tras la endodoncia»).
 *  · `agregarDesdeChip`: el toque. Un chip = un renglón con procedimiento, precio, minutos y fase
 *    del tarifario; un segundo hallazgo del mismo diente que pide lo mismo se junta con el primero
 *    (caries MO + restauración temporal D = una resina de 3 caras).
 *  · `filasParaGuardar`: los renglones en el formato del contrato de filas (`items.ts`, t12).
 *  · Marcas ROJAS del odontograma (ws1-t6, decisión 2 de Rafael): cada una sale como un chip
 *    `por_hacer` con su procedimiento y el precio de la clínica («Resina · 16 O · $700»), listo para
 *    agregar. Mandan sobre lo que sugeriría un hallazgo del mismo diente (no salen dos resinas).
 */
import {
  CARAS, MINUTOS_POR_DEFECTO, cantidadDe, fechaDeMarca, leerDientes, precioDe, renglonesUtiles, sesionesSugeridas,
  type EntradaOdontograma, type Fase, type Hallazgo, type Pronostico, type Renglon,
} from "./plan-clinico";
import {
  PROCEDIMIENTOS, sugerenciaARenglon, sugerirPlan, sugerirProcedimiento,
  type ProcedimientoTarifario, type Sugerencia,
} from "@/lib/treatments/sugerir-procedimiento";
import { aCentavos } from "@/lib/treatments/items";
import { planQueYaLoTiene, type FilaEnPlan } from "@/lib/treatments/ya-en-planes";

type Entradas = { toothNumber: number; conditionId: string; estado?: string | null }[];

export interface Chip {
  /** Llave estable: `h:16:caries` (un hallazgo), `g:limpieza` (boca), `q:raspado:1` (cuadrante), `e:corona:36` (encadenada),
   *  `r:h:16:restoration` (una marca roja; `r:g:limpieza`, `r:q:…` igual que los otros). */
  clave: string;
  tipo: "hallazgo" | "encadenada" | "por_hacer";
  /** Las condiciones del chip, sin repetir (un chip de boca puede juntar cálculo y sangrado). */
  condiciones: string[];
  dientes: number[];
  /** Caras del hallazgo (solo un chip de un diente). */
  caras: string[];
  hallazgos: Hallazgo[];
  /** Lo que entra al tocarlo; null = el hallazgo no tiene sugerencia (entra un renglón para escribir). */
  sugerencia: Sugerencia | null;
  /** Ya está en el plan. */
  puesto: boolean;
  /**
   * Lo que el chip propone ya está en un plan del paciente (v2 M1; v3: de cualquier doctor, y también
   * si ya se hizo; v4: CUALQUIER chip con sugerencia, no solo los rojos): se enseña como «ya en el
   * plan X» o «ya hecha en el plan X (fecha)» y no se agrega (ni con «Agregar todo»): serían dos notas
   * de cobro. Las reglas, en `ya-en-planes.ts`.
   */
  enOtroPlan?: { plan: string; hechoEn: string | null } | null;
}

const cuadrante = (fdi: number) => Math.floor(fdi / 10);

function llaveDeChip(h: Hallazgo, s: Sugerencia | null): string {
  const r = h.porHacer ? "r:" : "";
  if (!s) return `${r}h:${h.clave}`;
  const alcance = PROCEDIMIENTOS[s.clave].alcance;
  if (alcance === "boca") return `${r}g:${s.clave}`;
  if (alcance === "cuadrante") return `${r}q:${s.clave}:${cuadrante(h.diente)}`;
  return `${r}h:${h.clave}`;
}

/** Lo que ya pide una marca roja: `«clave»:«diente»` (o `«clave»:boca`, `«clave»:q«n»`). */
function cubiertoPor(s: Sugerencia, diente: number): string {
  const alcance = PROCEDIMIENTOS[s.clave].alcance;
  return alcance === "boca" ? `${s.clave}:boca` : alcance === "cuadrante" ? `${s.clave}:q${cuadrante(diente)}` : `${s.clave}:${diente}`;
}

/** ¿El renglón trabaja ese diente? (o toda la boca, si no lleva dientes). */
const enDiente = (r: Renglon, d: number) => leerDientes(r.dientes).dientes.includes(d);

/**
 * Los chips de la ventana. `renglones` es el plan como va: decide qué chip ya está puesto y qué
 * sugerencias encadenadas salen.
 */
export function chipsDelPlan(
  hallazgos: Hallazgo[], tarifario: ProcedimientoTarifario[], entradas: Entradas, renglones: Renglon[], enPlanes: FilaEnPlan[] = [],
): Chip[] {
  const usados = new Set(renglones.flatMap((r) => r.origen ?? []));
  const grupos = new Map<string, { hallazgos: Hallazgo[]; base: Sugerencia | null }>();
  const encadenadas: Chip[] = [];
  const vistasEncadenadas = new Set<string>();
  // Lo que el doctor ya marcó en rojo: un hallazgo del mismo diente que pide lo mismo no sale aparte…
  // salvo que trabaje caras que lo rojo no cubre (caries 16 M con la resina roja en 16 O: sale, y al
  // agregarla se junta con la del 16 en una resina de 2 caras).
  const enRojo = new Map<string, Set<string>>();
  for (const h of hallazgos) {
    if (!h.porHacer) continue;
    const s = sugerirProcedimiento(h, tarifario, entradas).sugerencias[0];
    if (!s) continue;
    const k = cubiertoPor(s, h.diente);
    const caras = enRojo.get(k) ?? new Set<string>();
    h.caras.forEach((c) => caras.add(c));
    enRojo.set(k, caras);
  }
  const cubiertoEnRojo = (h: Hallazgo, s: Sugerencia) => {
    const caras = enRojo.get(cubiertoPor(s, h.diente));
    if (!caras) return false;
    if (PROCEDIMIENTOS[s.clave].variantes !== "caras") return true;
    return h.caras.every((c) => caras.has(c));
  };

  for (const h of hallazgos) {
    const res = sugerirProcedimiento(h, tarifario, entradas);
    const base = res.sugerencias.find((s) => s.encadenadaDe === null) ?? null;
    if (!h.porHacer && base && cubiertoEnRojo(h, base)) continue;
    const llave = llaveDeChip(h, base);
    const g = grupos.get(llave);
    if (g) g.hallazgos.push(h);
    else grupos.set(llave, { hallazgos: [h], base });

    // Lo que se sugiere DESPUÉS, solo cuando lo que lo pide ya está en el plan.
    if (!usados.has(h.clave)) continue;
    for (const s of res.sugerencias) {
      if (s.encadenadaDe === null) continue;
      const llaveE = `e:${s.clave}:${h.diente}`;
      if (vistasEncadenadas.has(llaveE)) continue;
      vistasEncadenadas.add(llaveE);
      if (renglones.some((r) => r.clave === s.clave && enDiente(r, h.diente))) continue;
      encadenadas.push({
        clave: llaveE, tipo: "encadenada", condiciones: [h.conditionId], dientes: [h.diente], caras: [],
        hallazgos: [h], sugerencia: s, puesto: false,
      });
    }
  }

  const chips: Chip[] = [];
  for (const [clave, g] of grupos) {
    const unSolo = g.hallazgos.length === 1;
    const sugerencia = unSolo || !g.base
      ? g.base
      : sugerirPlan(g.hallazgos, tarifario, entradas).find((s) => s.encadenadaDe === null && s.clave === g.base!.clave) ?? g.base;
    chips.push({
      clave,
      tipo: g.hallazgos[0].porHacer ? "por_hacer" : "hallazgo",
      condiciones: [...new Set(g.hallazgos.map((h) => h.conditionId))],
      dientes: [...new Set(g.hallazgos.map((h) => h.diente))].sort((a, b) => a - b),
      caras: unSolo ? g.hallazgos[0].caras : [],
      hallazgos: g.hallazgos,
      sugerencia,
      puesto: g.hallazgos.every((h) => usados.has(h.clave)),
    });
  }
  // Lo que ya está en un plan del paciente (mismo tipo de procedimiento y mismo diente): «ya en el
  // plan X». Vale para TODO chip con sugerencia —rojo, hallazgo (caries → resina) y encadenado (la
  // corona tras la endodoncia)— (v4, M1). Un chip de varios dientes cuenta si alguno ya está.
  // Una fila HECHA solo tapa si se hizo después de marcar lo del chip (v5): la caries de hoy en un
  // diente con una resina de 2023 es trabajo nuevo. La fecha del chip, la de su hallazgo más nuevo.
  if (enPlanes.length > 0) {
    for (const c of [...chips, ...encadenadas]) {
      if (!c.sugerencia || c.puesto) continue;
      const fechas = c.hallazgos.map((h) => h.marcadaEn);
      const marcadaEn = fechas.length > 0 && fechas.every(Boolean)
        ? new Date(Math.max(...fechas.map((f) => Date.parse(f!)))).toISOString()
        : null;
      // con sus caras: «Resina 16 O» en otro plan no tapa la caries de la M (v6, m1)
      const ya = planQueYaLoTiene(c.sugerencia.clave, c.dientes, enPlanes, { marcadaEn, hechoPorSiempre: c.tipo === "por_hacer", caras: c.sugerencia.caras });
      if (ya) c.enOtroPlan = { plan: ya.plan, hechoEn: ya.estado === "hecho" ? ya.hechoEn : null };
    }
  }
  // Lo marcado en rojo, primero: es lo que el doctor ya decidió.
  return [...chips.filter((c) => c.tipo === "por_hacer"), ...chips.filter((c) => c.tipo !== "por_hacer"), ...encadenadas];
}

export interface ContextoAgregar {
  tarifario: ProcedimientoTarifario[];
  entradas: Entradas;
  nuevoId: () => string;
  /** El motivo que se escribe en el renglón («Caries», «Tras la endodoncia»). */
  motivo: string;
  idioma: "es" | "en";
}

/** El toque en un chip: el plan con el renglón nuevo (o con el renglón del mismo diente ampliado). */
export function agregarDesdeChip(renglones: Renglon[], chip: Chip, ctx: ContextoAgregar): Renglon[] {
  if (chip.puesto || chip.enOtroPlan != null) return renglones;
  const s = chip.sugerencia;
  const primero = chip.hallazgos[0];
  const hallazgo = {
    condicion: primero.conditionId,
    diente: chip.dientes.length === 1 ? chip.dientes[0] : null,
    caras: chip.caras,
    entryId: null,
  };
  const origen = chip.tipo !== "encadenada" ? chip.hallazgos.map((h) => h.clave) : [];

  if (!s) {
    // Sin sugerencia: el renglón de siempre, con fase, diente, caras y motivo, para escribir el procedimiento.
    return [...renglones, {
      id: ctx.nuevoId(), fase: primero.fase, procedimiento: "", procedimientoId: null, dientes: chip.dientes.join(", "),
      caras: chip.caras, motivo: ctx.motivo, cantidad: "1", precio: "", precioDelTarifario: false, minutos: 0,
      origen, clave: null, hallazgo, revisar: false,
    }];
  }

  const alcance = PROCEDIMIENTOS[s.clave].alcance;
  // Mismo diente y mismo procedimiento: se juntan (caras y hallazgos) en vez de repetir el renglón.
  if (chip.tipo !== "encadenada" && alcance === "diente") {
    const d = chip.dientes[0];
    const i = renglones.findIndex((r) => r.clave === s.clave && leerDientes(r.dientes).dientes.length === 1 && enDiente(r, d));
    if (i >= 0) {
      const r = renglones[i];
      const caras = CARAS.filter((c) => r.caras.includes(c) || chip.caras.includes(c));
      const junto: Renglon = { ...r, caras, origen: [...new Set([...(r.origen ?? []), ...origen])] };
      // Si el renglón sigue como lo dejó la sugerencia, la variante se ajusta a las caras nuevas.
      if (r.precioDelTarifario) {
        const otra = sugerirProcedimiento({ diente: d, caras, conditionId: primero.conditionId, porHacer: primero.porHacer }, ctx.tarifario, ctx.entradas)
          .sugerencias.find((x) => x.clave === s.clave && x.encadenadaDe === null);
        if (otra?.procedimientoId) {
          Object.assign(junto, {
            procedimiento: otra.nombre, procedimientoId: otra.procedimientoId, precio: String(otra.precio),
            minutos: otra.minutos ?? 0, revisar: otra.revisar,
          });
        }
      }
      return renglones.map((x, j) => (j === i ? junto : x));
    }
  }

  const nuevo = sugerenciaARenglon(s, { id: ctx.nuevoId(), motivo: ctx.motivo, idioma: ctx.idioma });
  return [...renglones, {
    ...nuevo,
    // Toda la boca no lleva dientes: el PDF y el presupuesto dicen «limpieza», no «31, 41».
    dientes: alcance === "boca" ? "" : nuevo.dientes,
    caras: alcance === "diente" ? nuevo.caras : [],
    origen,
    hallazgo,
  }];
}

/* ─────── Desde la Nueva consulta (P9) ─────── */

/** Un diente en el formato `Records` del odontograma (el de la consulta, con letras de pantalla). */
type RegistroDiente = { surfaces?: Record<string, string[] | undefined>; tooth?: string[]; note?: string; estados?: Record<string, string> };

/** Lo que la consulta sabe de cada marca del odontograma VIVO: su estado y cuándo se marcó (v6, m3). */
export type FechasDelVivo = ReadonlyMap<string, { estado: string | null; fecha: string | null }>;

/**
 * Las fechas del vivo por marca (`«diente»:«cara de la base»:«condición»`), de las entradas que
 * devuelve `GET /api/odontogram` (`fetchOdontogram().entries`).
 */
export function fechasDelVivo(entradas: Array<{ toothNumber: number; surface: string | null; conditionId: string; estado?: string | null; estadoDesde?: string | null; createdAt?: string | null; updatedAt?: string | null }>): FechasDelVivo {
  return new Map(entradas.map((e) => [`${e.toothNumber}:${e.surface ?? "_"}:${e.conditionId}`, { estado: e.estado ?? null, fecha: fechaDeMarca(e) }]));
}

/**
 * El odontograma de una consulta (`Records`, lo que el doctor ve y marcó, aún sin guardar) como
 * las entradas que leen los chips: caras de la base (la «I» de un anterior es la «O»), el diente
 * completo con `surface: null`, sin la nota del diente.
 *
 * Con `fechas` (las del vivo, v6 m3) cada marca lleva cuándo se marcó: la que ya estaba en el vivo
 * con el mismo estado, su fecha; la que se puso (o se repintó) en ESTA consulta, `ahora`. Sin
 * `fechas`, sin fecha (los chips usan la regla de «sin fecha fiable»).
 */
export function entradasDeRegistros(
  registros: Record<number | string, RegistroDiente | undefined>,
  fechas?: FechasDelVivo,
  ahora: Date = new Date(),
): EntradaOdontograma[] {
  const out: EntradaOdontograma[] = [];
  const vistas = new Set<string>();
  const poner = (toothNumber: number, surface: string | null, conditionId: string, estado: string | undefined) => {
    const k = `${toothNumber}:${surface ?? "_"}:${conditionId}`;
    if (vistas.has(k) || conditionId === "__note__") return;
    vistas.add(k);
    let marcadaEn: string | null = null;
    if (fechas) {
      const vivo = fechas.get(k);
      marcadaEn = vivo && vivo.estado === (estado ?? null) ? vivo.fecha : ahora.toISOString();
    }
    out.push({ toothNumber, surface, conditionId, ...(estado ? { estado } : {}), ...(marcadaEn ? { marcadaEn } : {}) });
  };
  for (const [fdi, r] of Object.entries(registros)) {
    const diente = Number(fdi);
    if (!Number.isInteger(diente) || !r) continue;
    // el rojo/azul de cada marca (ws1-t6), con la letra de la pantalla en la llave
    for (const [letra, ids] of Object.entries(r.surfaces ?? {})) {
      for (const id of ids ?? []) poner(diente, letra === "I" ? "O" : letra, id, r.estados?.[`${letra}:${id}`]);
    }
    for (const id of r.tooth ?? []) poner(diente, null, id, r.estados?.[`_:${id}`]);
  }
  return out;
}

/**
 * Lo que la Nueva consulta le pasa a la ventana (P9): diagnóstico = observaciones de la consulta
 * más los CIE-10 si no están ya escritos; el pronóstico tal cual; y el odontograma de la consulta
 * solo si la precarga del vivo llegó (sin ella está a medias y la ventana lee el del paciente).
 */
export function precargaDeConsulta(c: {
  observaciones: string;
  cie10: string;
  pronostico: Pronostico;
  odontograma: Record<number | string, RegistroDiente | undefined>;
  odontogramaListo: boolean;
  /** Las fechas de las marcas del vivo (v6, m3): así la consulta decide como la ficha. */
  fechas?: FechasDelVivo;
}): { diagnostico: string; pronostico: Pronostico; entradas: EntradaOdontograma[] | undefined } {
  const obs = c.observaciones.trim();
  const cie = c.cie10.trim();
  return {
    diagnostico: [obs, cie && !obs.includes(cie) ? cie : ""].filter(Boolean).join("\n"),
    pronostico: c.pronostico,
    entradas: c.odontogramaListo ? entradasDeRegistros(c.odontograma, c.fechas) : undefined,
  };
}

/* ─────── Lo que se llena solo ─────── */

const MESES: Record<"es" | "en", string[]> = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** «Plan 20 oct 2026» / «Plan Oct 20, 2026»: corto, porque viaja en el WhatsApp de seguimiento. */
export function nombrePorDefecto(fecha: Date, idioma: "es" | "en"): string {
  const d = fecha.getDate(), m = MESES[idioma][fecha.getMonth()], a = fecha.getFullYear();
  return idioma === "en" ? `Plan ${m} ${d}, ${a}` : `Plan ${d} ${m} ${a}`;
}

/**
 * Días entre sesiones que se mandan sin preguntarlos (la ventana ya no los pide). Es el valor de
 * siempre del servidor; el seguimiento por WhatsApp sigue contando con él hasta que P8 lo cambie
 * por «pendientes sin cita». DECISIÓN PARA RAFAEL (reporte ws1-t5, fase 2).
 */
export const DIAS_ENTRE_SESIONES = 30;

/** Minutos de sillón y citas estimadas del plan (las mismas cuentas que «sesiones sugeridas»). */
export function sillon(renglones: Renglon[]): { minutos: number; citas: number } {
  const utiles = renglonesUtiles(renglones);
  const minutos = utiles.reduce((a, r) => a + cantidadDe(r) * (r.minutos > 0 ? r.minutos : MINUTOS_POR_DEFECTO), 0);
  return { minutos, citas: utiles.length > 0 ? sesionesSugeridas(renglones) : 0 };
}

/* ─────── Al guardar: las filas del contrato (items.ts) ─────── */

export interface FilaParaGuardar {
  nombre: string;
  procedureId: string | null;
  dientes: number[];
  caras: string[];
  fase: Fase;
  cantidad: number;
  precioCentavos: number;
  motivo: string;
  hallazgo: Renglon["hallazgo"] | null;
  estado: "pendiente";
}

/** Los renglones con procedimiento, en orden de fase, como filas nuevas (sin `id`). */
export function filasParaGuardar(renglones: Renglon[]): FilaParaGuardar[] {
  return renglonesUtiles(renglones).map((r) => ({
    nombre: r.procedimiento.trim(),
    procedureId: r.procedimientoId,
    dientes: leerDientes(r.dientes).dientes,
    caras: CARAS.filter((c) => r.caras.includes(c)),
    fase: r.fase,
    cantidad: cantidadDe(r),
    precioCentavos: aCentavos(precioDe(r)),
    motivo: r.motivo.trim(),
    hallazgo: r.hallazgo ?? null,
    estado: "pendiente",
  }));
}
