/**
 * Procedimiento HECHO → cambio en el odontograma (ws1-t5, pieza P7 de la investigación;
 * decisión 3 de Rafael: marcar «hecho» actualiza solo el odontograma, con deshacer y bitácora).
 *
 * El mapa inverso de `sugerir-procedimiento.ts`: resina sobre la caries de esas caras,
 * conducto sobre la pulpitis, ausente tras la extracción, corona, implante… PURO: recibe lo
 * que hay en el odontograma del paciente y devuelve las altas y bajas de `OdontogramEntry` a
 * aplicar, y su deshacer exacto. No escribe en la base: eso es de la fase 2, y para escribir
 * puede usar `comoCambiosDeSync` (el formato de `POST /api/odontogram/sync` con `cambios`,
 * el del odontograma 3D: aplica la diferencia dentro de una transacción sobre lo que haya).
 *
 * Formato de las entradas = el de la base (`odontogram_entries`): caras M D V L O, la incisal
 * de los anteriores guardada como «O», `surface: null` = el diente completo; la nota por
 * diente (`__note__`) no se toca nunca.
 *
 * Rojo → azul (ws1-t6, decisión 3 de Rafael): si lo que el procedimiento deja ya está marcado
 * EN ROJO («por hacer»), no se crea otra marca: esa pasa a azul («hecho»; hecho no es pagado) y va
 * en `aHecho`. Su deshacer la regresa a rojo (`deshacer.aPorHacer`). Sin caras en el renglón, las
 * caras salen también de las marcas rojas de ese procedimiento en el diente.
 */
import { esFdi } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { classify } from "@/components/dashboard/odontogram-v2/data";
import { PROCEDIMIENTOS, claveDeProcedimiento, type ClaveProcedimiento } from "@/lib/treatments/sugerir-procedimiento";
import { CLAVE_DE_MARCA, type EstadoMarca } from "./estado-marca";

export type CaraBase = "M" | "D" | "V" | "L" | "O";

export interface EntradaOdontograma {
  toothNumber: number;
  surface: CaraBase | null;
  conditionId: string;
  notes?: string | null;
  /** Rojo/azul (ws1-t6); null o ausente = lo de antes, sin estado. */
  estado?: EstadoMarca | null;
}

export interface ProcedimientoHecho {
  /** La clave de la sugerencia, si el renglón salió de una. Manda sobre código y nombre. */
  clave?: ClaveProcedimiento | null;
  /** `ProcedureCatalog.code` (llave `ODO_*`). */
  codigo?: string | null;
  /** Nombre del tarifario o del renglón. */
  nombre?: string | null;
  dientes: number[];
  /** Letras de pantalla o de base; la «I» de un anterior es la «O» de la base. */
  caras?: string[];
}

export type SinCambio =
  | "procedimiento_desconocido"  // no se sabe qué es (consulta, radiografía, blanqueamiento…)
  | "no_cambia_el_odontograma"   // se sabe qué es y no deja marca (flúor, ferulización, injerto)
  | "sin_dientes"                // no dice en qué diente y no hay de dónde sacarlo
  | "sin_caras"                  // resina sin caras y sin caries que la ubique
  | "ya_estaba";                 // el odontograma ya decía eso

export interface CambioOdontograma {
  clave: ClaveProcedimiento | null;
  altas: EntradaOdontograma[];
  bajas: EntradaOdontograma[];
  /** Marcas que estaban EN ROJO y pasan a azul (ws1-t6): no se crean ni se quitan, cambian de estado. */
  aHecho: EntradaOdontograma[];
  /** Marcas que vuelven a rojo: solo en el deshacer (`cambioDeshacer`); `aplicarHecho` la deja vacía. */
  aPorHacer: EntradaOdontograma[];
  /** Lo que vuelve el odontograma a como estaba (las bajas regresan con su nota; lo que pasó a azul, a rojo). */
  deshacer: { altas: EntradaOdontograma[]; bajas: EntradaOdontograma[]; aHecho: EntradaOdontograma[]; aPorHacer: EntradaOdontograma[] };
  /** Todo lo que el procedimiento deja en el odontograma, ESTUVIERA o no (lo que «hecho» cubre:
   *  si el doctor ya lo había pintado, tampoco se vuelve a proponer cobrar). Sin notas. */
  objetivo: EntradaOdontograma[];
  /** null = hay cambios. */
  sinCambio: SinCambio | null;
  /** Dientes que no son FDI: se ignoran. */
  dientesInvalidos: number[];
}

/** Lo que queda en el diente tras una extracción. «Ausente», como pidió Rafael (alternativa: `ext_done`). */
export const CONDICION_TRAS_EXTRACCION = "missing";

const NOTA = "__note__";
const LESION_CARA = ["caries", "caries_inc", "temp_rest"];

interface Efecto {
  /** Condición que se pone en cada cara trabajada. */
  ponerEnCaras?: string;
  /** Condición que se pone en el diente completo. */
  ponerEnDiente?: string | ((fdi: number) => string);
  /** Se quitan de las caras trabajadas. */
  quitarDeCaras?: string[];
  /** Se quitan de cualquier cara del diente. */
  quitarDeTodasLasCaras?: string[];
  /** Se quitan del diente completo (surface null). */
  quitarDelDiente?: string[];
  /** Extracción: se va todo lo del diente (menos la nota). */
  todoElDiente?: boolean;
  /** Sin caras: las de estos hallazgos en el diente. */
  carasDesde?: string[];
  /** Sin caras ni hallazgos que las den: estas. */
  carasPorDefecto?: CaraBase[];
  /** Las únicas caras donde puede ir (sellante: oclusal). */
  soloCaras?: CaraBase[];
  /** Sin dientes (limpieza de toda la boca): los dientes que tengan estos hallazgos. */
  sinDientesUsa?: string[];
}

const LIMPIEZA: Efecto = { quitarDeTodasLasCaras: ["calculus"], quitarDelDiente: ["bleeding"], sinDientesUsa: ["calculus", "bleeding"] };

/** Qué deja cada procedimiento en el odontograma; null = nada (se sabe qué es, pero no se dibuja). */
export const EFECTO_HECHO: Record<ClaveProcedimiento, Efecto | null> = {
  resina:                { ponerEnCaras: "restoration", quitarDeCaras: LESION_CARA, carasDesde: LESION_CARA },
  incrustacion:          { ponerEnCaras: "inlay", quitarDeCaras: LESION_CARA, carasDesde: LESION_CARA },
  endodoncia:            { ponerEnDiente: "rct", quitarDelDiente: ["pulpitis", "necrosis"] },
  pulpectomia:           { ponerEnDiente: "rct", quitarDelDiente: ["pulpitis", "necrosis"] },
  retratamiento:         { ponerEnDiente: "retreatment", quitarDelDiente: ["pulpitis", "necrosis"] },
  pulpotomia:            { ponerEnDiente: (fdi) => (classify(fdi).primary ? "pulpotomy_ped" : "pulpotomy"), quitarDelDiente: ["pulpitis"] },
  corona:                { ponerEnDiente: "crown", quitarDelDiente: ["fracture"], quitarDeTodasLasCaras: LESION_CARA },
  corona_acero:          { ponerEnDiente: "steel_crown", quitarDelDiente: ["fracture"], quitarDeTodasLasCaras: LESION_CARA },
  carilla:               { ponerEnDiente: "veneer" },
  perno:                 { ponerEnDiente: "post_core" },
  extraccion:            { todoElDiente: true, ponerEnDiente: CONDICION_TRAS_EXTRACCION },
  extraccion_quirurgica: { todoElDiente: true, ponerEnDiente: CONDICION_TRAS_EXTRACCION },
  implante:              { ponerEnDiente: "implant", quitarDelDiente: ["missing", "ext_done", "ext_indicated", "root_remnant"] },
  apicectomia:           { ponerEnDiente: "apicoectomy" },
  limpieza:              LIMPIEZA,
  raspado:               LIMPIEZA,
  sellante:              { ponerEnCaras: "sealant", quitarDeCaras: ["caries_inc"], carasPorDefecto: ["O"], soloCaras: ["O"] },
  mantenedor:            { ponerEnDiente: "space_maint" },
  fluor:                 null,
  ferulizacion:          null,
  injerto_gingival:      null,
};

const CARAS: CaraBase[] = ["M", "O", "D", "V", "L"];
const aCaraBase = (c: string): CaraBase | null => {
  const l = c.trim().toUpperCase();
  const b = l === "I" ? "O" : l;
  return (CARAS as string[]).includes(b) ? (b as CaraBase) : null;
};
const clave = (e: { toothNumber: number; surface: string | null; conditionId: string }) =>
  `${e.toothNumber}:${e.surface ?? "_"}:${e.conditionId}`;

/**
 * Las altas y bajas que deja un procedimiento hecho, sobre lo que hay HOY en el odontograma
 * (`entradas`: las del paciente; basta con las de esos dientes). Solo se da de alta lo que no
 * está y de baja lo que sí está, así el deshacer es exacto.
 */
export function aplicarHecho(hecho: ProcedimientoHecho, entradas: EntradaOdontograma[]): CambioOdontograma {
  const claveProc = hecho.clave ?? claveDeProcedimiento({ codigo: hecho.codigo, nombre: hecho.nombre });
  const objetivo: EntradaOdontograma[] = [];
  const sinEstado = ({ estado: _e, ...e }: EntradaOdontograma): EntradaOdontograma => e;
  // Lo marcado EN ROJO de este mismo procedimiento en el diente completo (flúor, profilaxis, pulpotomía,
  // corona…): «hecho» lo pasa a azul aunque el procedimiento no dibuje nada o dibuje otra cosa (ws1-t6).
  // En toda la boca si el procedimiento es de boca y el renglón no dice dientes. Las caras las lleva `poner`.
  const pedidosFdi = [...new Set(hecho.dientes.filter(esFdi))];
  const deLaBoca = !!claveProc && PROCEDIMIENTOS[claveProc].alcance === "boca" && pedidosFdi.length === 0;
  const rojosDelProc = claveProc
    ? entradas.filter((e) => e.conditionId !== NOTA && e.surface === null && e.estado === "por_hacer"
      && CLAVE_DE_MARCA[e.conditionId] === claveProc && (deLaBoca || pedidosFdi.includes(e.toothNumber)))
    : [];
  const vacio = (sinCambio: SinCambio, dientesInvalidos: number[] = []): CambioOdontograma => {
    if (rojosDelProc.length > 0) {
      const aHecho = rojosDelProc.map((e) => ({ ...sinEstado(e), notes: e.notes ?? null }));
      return {
        clave: claveProc, altas: [], bajas: [], aHecho, aPorHacer: [],
        deshacer: { altas: [], bajas: [], aHecho: [], aPorHacer: aHecho.map((e) => ({ ...e })) },
        objetivo: [...objetivo, ...aHecho.map((e) => ({ ...e, notes: null }))], sinCambio: null, dientesInvalidos,
      };
    }
    return { clave: claveProc, altas: [], bajas: [], aHecho: [], aPorHacer: [], deshacer: { altas: [], bajas: [], aHecho: [], aPorHacer: [] }, objetivo: [...objetivo], sinCambio, dientesInvalidos };
  };

  const dientesInvalidos = [...new Set(hecho.dientes.filter((d) => !esFdi(d)))];
  if (!claveProc) return vacio("procedimiento_desconocido", dientesInvalidos);
  const efecto = EFECTO_HECHO[claveProc];
  if (!efecto) return vacio("no_cambia_el_odontograma", dientesInvalidos);

  const vivas = entradas.filter((e) => e.conditionId !== NOTA);
  let dientes = [...new Set(hecho.dientes.filter(esFdi))];
  if (dientes.length === 0 && efecto.sinDientesUsa) {
    dientes = [...new Set(vivas.filter((e) => efecto.sinDientesUsa!.includes(e.conditionId)).map((e) => e.toothNumber))];
    if (dientes.length === 0) return vacio("ya_estaba", dientesInvalidos);
  }
  if (dientes.length === 0) return vacio("sin_dientes", dientesInvalidos);
  dientes.sort((a, b) => a - b);

  const pedidas = [...new Set((hecho.caras ?? []).map(aCaraBase).filter((c): c is CaraBase => c !== null))];
  const hay = new Map(vivas.map((e) => [clave(e), e]));
  const altas: EntradaOdontograma[] = [];
  const bajas: EntradaOdontograma[] = [];
  const aHecho: EntradaOdontograma[] = [];
  const quitar = (e: EntradaOdontograma) => { if (!bajas.some((b) => clave(b) === clave(e))) bajas.push({ ...e, notes: e.notes ?? null }); };
  const poner = (toothNumber: number, surface: CaraBase | null, conditionId: string) => {
    const e = { toothNumber, surface, conditionId };
    if (!objetivo.some((o) => clave(o) === clave(e))) objetivo.push({ ...e, notes: null });
    const ya = hay.get(clave(e));
    // Marcada en rojo: pasa a azul, no se crea otra (ws1-t6).
    if (ya?.estado === "por_hacer" && !bajas.some((b) => clave(b) === clave(e))) {
      if (!aHecho.some((a) => clave(a) === clave(e))) aHecho.push({ ...sinEstado(ya), notes: ya.notes ?? null });
      return;
    }
    if (!ya && !altas.some((a) => clave(a) === clave(e))) altas.push({ ...e, notes: null });
  };
  let faltanCaras = false;

  for (const diente of dientes) {
    const delDiente = vivas.filter((e) => e.toothNumber === diente);

    if (efecto.todoElDiente) delDiente.forEach(quitar);
    for (const e of delDiente) {
      if (e.surface && efecto.quitarDeTodasLasCaras?.includes(e.conditionId)) quitar(e);
      if (!e.surface && efecto.quitarDelDiente?.includes(e.conditionId)) quitar(e);
    }

    if (efecto.ponerEnCaras) {
      let caras = pedidas;
      if (caras.length === 0 && efecto.carasDesde) {
        caras = CARAS.filter((c) => delDiente.some((e) => e.surface === c && efecto.carasDesde!.includes(e.conditionId)));
      }
      // …o de donde el doctor ya lo marcó en rojo (ws1-t6)
      if (caras.length === 0) {
        caras = CARAS.filter((c) => delDiente.some((e) => e.surface === c && e.conditionId === efecto.ponerEnCaras && e.estado === "por_hacer"));
      }
      if (caras.length === 0 && efecto.carasPorDefecto) caras = efecto.carasPorDefecto;
      if (efecto.soloCaras) caras = caras.filter((c) => efecto.soloCaras!.includes(c));
      if (caras.length === 0) { faltanCaras = true; continue; }
      for (const cara of caras) {
        for (const e of delDiente) {
          if (e.surface === cara && efecto.quitarDeCaras?.includes(e.conditionId)) quitar(e);
        }
        poner(diente, cara, efecto.ponerEnCaras);
      }
    }

    if (efecto.ponerEnDiente) {
      // Si el doctor ya lo marcó en rojo (p. ej. «Pulpotomía» en un temporal), esa marca es la que pasa a azul.
      const rojo = efecto.todoElDiente ? undefined : rojosDelProc.find((e) => e.toothNumber === diente);
      const id = rojo ? rojo.conditionId : typeof efecto.ponerEnDiente === "function" ? efecto.ponerEnDiente(diente) : efecto.ponerEnDiente;
      // Extracción: lo que se quita del diente no cuenta como «ya estaba».
      if (efecto.todoElDiente && hay.has(clave({ toothNumber: diente, surface: null, conditionId: id }))) {
        const i = bajas.findIndex((b) => clave(b) === clave({ toothNumber: diente, surface: null, conditionId: id }));
        if (i >= 0) bajas.splice(i, 1);
        objetivo.push({ toothNumber: diente, surface: null, conditionId: id, notes: null });
      } else {
        poner(diente, null, id);
      }
    }
  }

  for (const r of rojosDelProc) {
    if (aHecho.some((a) => clave(a) === clave(r)) || bajas.some((b) => clave(b) === clave(r))) continue;
    aHecho.push({ ...sinEstado(r), notes: r.notes ?? null });
    if (!objetivo.some((o) => clave(o) === clave(r))) objetivo.push({ ...sinEstado(r), notes: null });
  }
  if (altas.length === 0 && bajas.length === 0 && aHecho.length === 0) return vacio(faltanCaras ? "sin_caras" : "ya_estaba", dientesInvalidos);
  const orden = (a: EntradaOdontograma, b: EntradaOdontograma) =>
    a.toothNumber - b.toothNumber || (a.surface ?? "").localeCompare(b.surface ?? "") || a.conditionId.localeCompare(b.conditionId);
  altas.sort(orden);
  bajas.sort(orden);
  aHecho.sort(orden);
  objetivo.sort(orden);
  return {
    clave: claveProc,
    altas,
    bajas,
    aHecho,
    aPorHacer: [],
    deshacer: { altas: bajas.map((e) => ({ ...e })), bajas: altas.map((e) => ({ ...e })), aHecho: [], aPorHacer: aHecho.map((e) => ({ ...e })) },
    objetivo,
    sinCambio: null,
    dientesInvalidos,
  };
}

/** El deshacer como un cambio más (para aplicarlo con las mismas funciones). */
export function cambioDeshacer(c: CambioOdontograma): CambioOdontograma {
  return {
    clave: c.clave,
    altas: c.deshacer.altas,
    bajas: c.deshacer.bajas,
    aHecho: c.deshacer.aHecho,
    aPorHacer: c.deshacer.aPorHacer,
    deshacer: { altas: c.altas, bajas: c.bajas, aHecho: c.aHecho, aPorHacer: c.aPorHacer },
    objetivo: c.deshacer.altas,
    sinCambio: c.sinCambio,
    dientesInvalidos: c.dientesInvalidos,
  };
}

/** Las entradas tras aplicar el cambio (para vista previa y pruebas): lo de `aHecho` queda azul y lo de `aPorHacer`, rojo. */
export function aplicarAEntradas(
  entradas: EntradaOdontograma[],
  c: Pick<CambioOdontograma, "altas" | "bajas"> & { aHecho?: EntradaOdontograma[]; aPorHacer?: EntradaOdontograma[] },
): EntradaOdontograma[] {
  const fuera = new Set(c.bajas.map(clave));
  const azul = new Set((c.aHecho ?? []).map(clave));
  const rojo = new Set((c.aPorHacer ?? []).map(clave));
  const quedan = entradas
    .filter((e) => !fuera.has(clave(e)))
    .map((e) => (azul.has(clave(e)) ? { ...e, estado: "hecho" as const } : rojo.has(clave(e)) ? { ...e, estado: "por_hacer" as const } : e));
  const ya = new Set(quedan.map(clave));
  return [...quedan, ...c.altas.filter((e) => !ya.has(clave(e)))];
}

/** Un diente en el formato `Records` del odontograma v2/3D (caras con letra de la base). */
export interface RegistroDiente { surfaces: Record<string, string[]>; tooth: string[] }

function registro(entradas: EntradaOdontograma[], diente: number): RegistroDiente {
  const r: RegistroDiente = { surfaces: {}, tooth: [] };
  for (const e of entradas) {
    if (e.toothNumber !== diente || e.conditionId === NOTA) continue;
    if (e.surface) {
      const l = (r.surfaces[e.surface] ??= []);
      if (!l.includes(e.conditionId)) l.push(e.conditionId);
    } else if (!r.tooth.includes(e.conditionId)) {
      r.tooth.push(e.conditionId);
    }
  }
  return r;
}

/**
 * El cambio en el formato de `POST /api/odontogram/sync` con `cambios` (el de «Guardar
 * consulta» del odontograma 3D): por cada diente tocado, cómo está (`base`) y cómo queda
 * (`now`). El servidor aplica SOLO esa diferencia, en su transacción y sobre lo que haya,
 * así no pisa lo que otra pestaña autoguardó. Sin `note`: la nota del diente no se toca.
 * Ojo: ese camino crea las altas con `notes: null`; si el deshacer debe devolver la nota de
 * una baja, la fase 2 la escribe aparte (va en `deshacer.altas[].notes`).
 */
export function comoCambiosDeSync(
  entradas: EntradaOdontograma[],
  c: Pick<CambioOdontograma, "altas" | "bajas">,
): Record<number, { base: RegistroDiente; now: RegistroDiente }> {
  const despues = aplicarAEntradas(entradas, c);
  const dientes = [...new Set([...c.altas, ...c.bajas].map((e) => e.toothNumber))].sort((a, b) => a - b);
  const out: Record<number, { base: RegistroDiente; now: RegistroDiente }> = {};
  for (const d of dientes) out[d] = { base: registro(entradas, d), now: registro(despues, d) };
  return out;
}

/* ─────── Deshacer en la base (fase 2): exacto y sin pisar lo que vino después ─────── */

/** Una entrada del odontograma tal como está en la base, con su id. */
export interface EntradaConId extends EntradaOdontograma { id: string }

/**
 * Lo que «hecho» escribió en la base: las altas con el id que les tocó (así el deshacer quita
 * esas y no otra igual que alguien pintó después) y las bajas con su nota (vuelven con ella).
 */
export interface EscritoPorHecho {
  altas: EntradaConId[];
  bajas: EntradaOdontograma[];
  /** Lo que estaba en rojo y «hecho» pasó a azul, con su id (ws1-t6): el deshacer lo regresa a rojo. */
  aHecho?: EntradaConId[];
}

export interface ConflictoDeshacer {
  toothNumber: number;
  surface: CaraBase | null;
  conditionId: string;
  /** `alta_ya_no_esta`: alguien quitó después lo que puso «hecho» (no se toca nada ahí).
   *  `cambio_posterior`: lo que «hecho» quitó no se devuelve, porque lo que puso en su lugar ya no está.
   *  `nota_quitada`: lo que puso «hecho» se quitó igual, pero alguien le había escrito una nota (va en `nota`,
   *  para que quede en la bitácora). Se quita igual: si se quedara, con la fila otra vez pendiente, la
   *  consulta lo propondría cobrar además de la nota del plan. */
  motivo: "alta_ya_no_esta" | "cambio_posterior" | "nota_quitada";
  nota?: string;
}

export interface PlanDeDeshacer {
  /** Las altas de «hecho» que siguen ahí (por id): se quitan. */
  borrar: EntradaConId[];
  /** Lo que «hecho» pasó de rojo a azul y sigue azul (por id): vuelve a rojo (ws1-t6). */
  aPorHacer: EntradaConId[];
  /** Lo que «hecho» quitó y se devuelve, con su nota. */
  crear: EntradaOdontograma[];
  conflictos: ConflictoDeshacer[];
}

/**
 * El deshacer de un «hecho» contra el odontograma de HOY. Regla: no pisar lo que vino después.
 *  - Una alta se quita solo si sigue ahí con SU id. Si alguien la quitó (o la quitó y pintó otra
 *    igual), no se toca: se avisa.
 *  - Una baja se devuelve si no está ya, y solo si lo que «hecho» puso en ese sitio (la misma cara;
 *    si no puso nada en esa cara, el mismo diente) sigue ahí. Si se cambió después (la resina se
 *    volvió corona, el diente extraído ya tiene implante), no se devuelve: se avisa.
 *  - Lo que «hecho» quitó sin poner nada en el diente (limpieza) se devuelve si no está.
 */
export function planearDeshacer(escrito: EscritoPorHecho, actuales: EntradaConId[]): PlanDeDeshacer {
  const porId = new Map(actuales.map((e) => [e.id, e]));
  const hay = new Set(actuales.filter((e) => e.conditionId !== NOTA).map(clave));
  const borrar: EntradaConId[] = [];
  const perdidas: EntradaConId[] = [];
  for (const a of escrito.altas) {
    const viva = porId.get(a.id);
    if (viva && clave(viva) === clave(a)) borrar.push(viva);
    else perdidas.push(a);
  }
  // Lo que pasó a azul: vuelve a rojo si sigue ahí y sigue azul; si alguien lo quitó, se avisa; si
  // alguien ya le cambió el estado (lo regresó a rojo, o es «previo»), no se toca.
  const aPorHacer: EntradaConId[] = [];
  for (const a of escrito.aHecho ?? []) {
    const viva = porId.get(a.id);
    if (!viva || clave(viva) !== clave(a)) perdidas.push(a);
    else if (viva.estado === "hecho") aPorHacer.push(viva);
  }
  const conflictos: ConflictoDeshacer[] = perdidas.map((a) => ({
    toothNumber: a.toothNumber, surface: a.surface, conditionId: a.conditionId, motivo: "alta_ya_no_esta",
  }));
  for (const v of borrar) {
    const nota = (v.notes ?? "").trim();
    if (nota) conflictos.push({ toothNumber: v.toothNumber, surface: v.surface, conditionId: v.conditionId, motivo: "nota_quitada", nota });
  }
  const crear: EntradaOdontograma[] = [];
  for (const b of escrito.bajas) {
    if (b.conditionId === NOTA || hay.has(clave(b))) continue;
    // Lo que «hecho» puso en ese sitio: sus altas y lo que pasó de rojo a azul.
    const puestas = [...escrito.altas, ...(escrito.aHecho ?? [])];
    const enLaCara = puestas.filter((a) => a.toothNumber === b.toothNumber && a.surface === b.surface);
    const anclas = enLaCara.length > 0 ? enLaCara : puestas.filter((a) => a.toothNumber === b.toothNumber);
    if (anclas.some((a) => perdidas.includes(a))) {
      conflictos.push({ toothNumber: b.toothNumber, surface: b.surface, conditionId: b.conditionId, motivo: "cambio_posterior" });
      continue;
    }
    if (!crear.some((c) => clave(c) === clave(b))) crear.push({ ...b, notes: b.notes ?? null });
  }
  const orden = (a: EntradaOdontograma, b: EntradaOdontograma) =>
    a.toothNumber - b.toothNumber || (a.surface ?? "").localeCompare(b.surface ?? "") || a.conditionId.localeCompare(b.conditionId);
  return { borrar: borrar.sort(orden), aPorHacer: aPorHacer.sort(orden), crear: crear.sort(orden), conflictos: conflictos.sort(orden) };
}
