// «¿Esto ya está en un plan del paciente?» (ws1-t6 v3, MAYOR-B y m-b de la revisión de t1) — la
// regla, en funciones PURAS. La usan la ventana «Nuevo plan» (lo marcado en rojo que ya está en un
// plan sale «ya en el plan X» y no se agrega) y el servidor al guardar un plan (avisa la fila repetida).
//
// Decisión (gerente, en línea con Rafael, 28-oct): cualquier doctor ve y marca «Hecho» en planes de
// otros, así que se miran los planes de TODOS los doctores del paciente, y solo con lo mínimo:
// tipo de procedimiento + dientes + nombre del plan + estado de la fila (sin precios ni notas).
//
// Cuándo una fila «ya lo tiene»:
//  · el mismo TIPO de procedimiento (`claveDeProcedimiento`: «Resina 2 caras» y «Restauración con
//    resina» son la misma resina) y
//  · el mismo diente (una fila sin dientes, o una marca sin diente, vale para cualquiera) y
//  · la fila está por hacer (pendiente o en curso, en un plan no cancelado): tapa SIEMPRE;
//  · la fila está HECHA (v5, M1-v4 de la revisión de t1): tapa solo si se hizo DESPUÉS de que se
//    marcó la marca o el hallazgo del chip (`marcadaEn`). Una caries marcada hoy en un diente con una
//    resina de 2023 es trabajo NUEVO y se ofrece; una marca roja puesta antes de que se hiciera el
//    trabajo (se quedó roja: «Hecho» sin permiso de odontograma, o sin el SQL) no se ofrece otra vez.
//    Sin fecha fiable de la marca (lo marcado en la consulta y aún sin guardar):
//      - marca ROJA (`hechoPorSiempre`): la de un diente, hecha en cualquier fecha; la de toda la
//        boca o un cuadrante (limpieza, flúor, raspado), solo si es reciente (`HECHO_RECIENTE_MS`);
//      - hallazgo o encadenado: solo si es reciente.
//  · una fila cancelada nunca.

import { HECHO_RECIENTE_MS } from "./sin-doble-cobro";
import { PROCEDIMIENTOS, claveDeProcedimiento, type ClaveProcedimiento } from "./sugerir-procedimiento";

export type EstadoEnPlan = "pendiente" | "en_curso" | "hecho";

/** Lo que viaja de cada fila (lo que contesta `GET /api/treatments/en-planes`). */
export interface FilaEnPlan {
  planId: string;
  /** Nombre del plan («Plan 20 oct 2026»). */
  plan: string;
  clave: ClaveProcedimiento;
  dientes: number[];
  /** Caras que trabaja (letras de la base: M O D V L); vacío = no lo dice (v6, m1). */
  caras: string[];
  estado: EstadoEnPlan;
  /** Cuándo se marcó hecha (ISO), solo si está hecha. */
  hechoEn: string | null;
}

/** Lo que hace falta de un plan y de sus filas para resumirlas. */
export interface PlanParaResumir { id: string; name: string; status: string }
export interface FilaParaResumir {
  nombre: string;
  procedureId: string | null;
  dientes: number[];
  caras?: string[];
  estado: string;
  hechoEn: Date | string | null;
}

const PLAN_CANCELADO = "ABANDONED";
const CARAS_BASE = ["M", "O", "D", "V", "L"];
/** Letras de la base, sin repetir (la «I» de un anterior es la «O»). */
const carasBase = (caras: readonly string[] | undefined) =>
  CARAS_BASE.filter((c) => (caras ?? []).some((x) => (String(x).toUpperCase() === "I" ? "O" : String(x).toUpperCase()) === c));

/**
 * Las filas que cuentan, ya con su tipo: las por hacer de planes no cancelados y las hechas de
 * cualquier plan. `codigos`: procedureId → llave `ODO_*` del tarifario de la clínica.
 */
export function resumirFilas(
  planes: PlanParaResumir[],
  filasPorPlan: ReadonlyMap<string, FilaParaResumir[]>,
  codigos: ReadonlyMap<string, string> = new Map(),
): FilaEnPlan[] {
  const out: FilaEnPlan[] = [];
  for (const p of planes) {
    for (const f of filasPorPlan.get(p.id) ?? []) {
      const estado = f.estado as EstadoEnPlan;
      if (estado !== "pendiente" && estado !== "en_curso" && estado !== "hecho") continue;
      if (estado !== "hecho" && p.status === PLAN_CANCELADO) continue;
      const clave = claveDeProcedimiento({ codigo: f.procedureId ? codigos.get(f.procedureId) ?? null : null, nombre: f.nombre });
      if (!clave) continue;
      const hechoEn = estado === "hecho" && f.hechoEn ? new Date(f.hechoEn).toISOString() : null;
      out.push({ planId: p.id, plan: p.name, clave, dientes: [...f.dientes], caras: carasBase(f.caras), estado, hechoEn });
    }
  }
  return out;
}

/** Cómo pesa una fila HECHA para el chip que se mira (ver arriba). */
export interface ContextoDeMarca {
  /** Cuándo se marcó la marca o el hallazgo (ISO). Sin ella (o si no se lee), «sin fecha fiable». */
  marcadaEn?: string | null;
  /** Sin fecha fiable: una marca ROJA cuenta lo hecho de un diente en cualquier fecha. */
  hechoPorSiempre?: boolean;
}

function cuenta(f: FilaEnPlan, ahora: Date, marca: ContextoDeMarca): boolean {
  if (f.estado !== "hecho") return true;
  const hecho = f.hechoEn ? Date.parse(f.hechoEn) : NaN;
  const marcada = marca.marcadaEn ? Date.parse(marca.marcadaEn) : NaN;
  if (Number.isFinite(marcada)) return Number.isFinite(hecho) && hecho > marcada;
  if (marca.hechoPorSiempre && PROCEDIMIENTOS[f.clave].alcance === "diente") return true;
  return Number.isFinite(hecho) && ahora.getTime() - hecho <= HECHO_RECIENTE_MS;
}

/**
 * La fila de algún plan que ya tiene ese procedimiento en esos dientes (la primera por hacer; si
 * no, la primera hecha), o null. `excluirPlanId`: el plan que se está editando no cuenta.
 */
type OpcionesDeCobertura = { excluirPlanId?: string | null; ahora?: Date; caras?: readonly string[] } & ContextoDeMarca;

/** Qué de lo que se pide ya está en algún plan: la fila que lo tiene y qué caras cubre y faltan. */
export interface Cobertura {
  /** La fila que lo tiene (la primera por hacer; si no, la primera hecha), o null si nada solapa. */
  fila: FilaEnPlan | null;
  /** Caras pedidas que ya están en algún plan (letras de la base). */
  cubiertas: string[];
  /** Caras pedidas que NO están en ningún plan: lo que sigue siendo trabajo nuevo. */
  faltan: string[];
}

/**
 * Cuánto de un procedimiento (en esos dientes y, si va por caras, esas caras) ya está en los planes.
 * En un procedimiento por caras (resina, sellante…) una fila cubre solo las caras que trabaja, o
 * todas si no dice caras (v6, m1); con solape PARCIAL, `faltan` dice lo que queda por ofrecer
 * (v7, M1-v6: así la cara ya planeada no entra dos veces).
 */
export function coberturaEnPlanes(
  clave: ClaveProcedimiento,
  dientes: number[],
  filas: FilaEnPlan[],
  opciones: OpcionesDeCobertura = {},
): Cobertura {
  const ahora = opciones.ahora ?? new Date();
  let candidatas = filas.filter((f) =>
    f.clave === clave
    && f.planId !== opciones.excluirPlanId
    && (f.dientes.length === 0 || dientes.length === 0 || dientes.some((d) => f.dientes.includes(d)))
    && cuenta(f, ahora, opciones));
  const piden = carasBase(opciones.caras);
  let cubiertas = piden;
  if (PROCEDIMIENTOS[clave].variantes === "caras" && piden.length > 0) {
    // (una respuesta de antes, sin `caras`, cuenta como «no dice caras»)
    const carasDe = (f: FilaEnPlan) => f.caras ?? [];
    candidatas = candidatas.filter((f) => carasDe(f).length === 0 || carasDe(f).some((c) => piden.includes(c)));
    cubiertas = candidatas.some((f) => carasDe(f).length === 0)
      ? piden
      : piden.filter((c) => candidatas.some((f) => carasDe(f).includes(c)));
  }
  const fila = candidatas.find((f) => f.estado !== "hecho") ?? candidatas[0] ?? null;
  if (!fila) return { fila: null, cubiertas: [], faltan: piden };
  return { fila, cubiertas, faltan: piden.filter((c) => !cubiertas.includes(c)) };
}

/** La fila de algún plan que ya tiene TODO lo pedido (dientes y, si va por caras, todas sus caras), o null. */
export function planQueYaLoTiene(
  clave: ClaveProcedimiento,
  dientes: number[],
  filas: FilaEnPlan[],
  opciones: OpcionesDeCobertura = {},
): FilaEnPlan | null {
  const c = coberturaEnPlanes(clave, dientes, filas, opciones);
  return c.fila && c.faltan.length === 0 ? c.fila : null;
}

/**
 * Las filas nuevas de un plan que ya están en OTRO plan del paciente: «Resina 16 (ya en «Plan X»)».
 * Aquí no hay marca detrás (se tecleó o salió de un chip): lo hecho solo cuenta si es reciente.
 */
export function filasRepetidas(
  nuevas: Array<{ nombre: string; procedureId: string | null; dientes: number[]; caras?: string[] }>,
  filas: FilaEnPlan[],
  opciones: { codigos?: ReadonlyMap<string, string>; excluirPlanId?: string | null; ahora?: Date } = {},
): Array<{ nombre: string; dientes: number[]; plan: string }> {
  const out: Array<{ nombre: string; dientes: number[]; plan: string }> = [];
  for (const n of nuevas) {
    const clave = claveDeProcedimiento({ codigo: n.procedureId ? opciones.codigos?.get(n.procedureId) ?? null : null, nombre: n.nombre });
    if (!clave) continue;
    // avisa con CUALQUIER solape (una cara en común, o una fila sin caras), no solo si lo cubre todo (v7)
    const ya = coberturaEnPlanes(clave, n.dientes, filas, { ...opciones, caras: n.caras }).fila;
    if (ya) out.push({ nombre: n.nombre, dientes: [...n.dientes], plan: ya.plan });
  }
  return out;
}
