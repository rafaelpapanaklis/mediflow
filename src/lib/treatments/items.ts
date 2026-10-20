// Filas del plan de tratamiento (ws1-t12 · P1) — EL CONTRATO.
//
// Hasta aquí los procedimientos del plan vivían como TEXTO en `treatment_plans.description`
// (`plan-tratamiento-rediseno/plan-clinico.ts`) y se releían con expresiones regulares. Ahora
// cada procedimiento es una FILA de `treatment_plan_items` (sql/plan-tratamiento-filas.sql): de
// ella salen el PDF, el presupuesto y la nota de cobro, sin volver a capturar nada.
//
// Este archivo es PURO (sin base ni sesión) y es lo que importan la API, el lector dual
// (`leer-plan.ts`), la nota de cobro (`cobro.ts`) y, en la fase 2, la ventana rápida, «Hoy en el
// sillón» y «hecho → odontograma». La capa de base es `items-db.ts` (solo servidor).
//
// Reglas que fija el contrato:
//  · el dinero viaja en CENTAVOS enteros (`precioCentavos`): $1,250.50 es 125050, nunca 1250.4999;
//  · una fila NUNCA se borra: se cancela (`estado = "cancelado"`, con quién y cuándo);
//  · una fila ya cobrada (`invoiceId`) no cambia de nombre, procedimiento, cantidad ni precio, y no
//    se cancela desde el plan: eso se ajusta en la nota (Facturación);
//  · una fila hecha no desaparece por omisión: se deshace a «pendiente» (fase 2, con bitácora).

import type { Prisma } from "@prisma/client";
import { esFdi, FASES, type Fase } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";

export { FASES, type Fase };

export const ESTADOS_DE_FILA = ["pendiente", "en_curso", "hecho", "cancelado"] as const;
export type EstadoDeFila = (typeof ESTADOS_DE_FILA)[number];

/** Las caras que se guardan, en su orden de lectura. La incisal se guarda como «O» (odontograma). */
export const CARAS_DE_FILA = ["M", "O", "D", "V", "L"] as const;

/** Tope de filas por plan: un plan dental real tiene 4–20; más es un error de quien llama. */
export const MAX_FILAS_POR_PLAN = 100;
export const MAX_CANTIDAD = 999;
/** NUMERIC(12,2): hasta 9,999,999,999.99. El tope práctico por unidad es 10 millones de pesos. */
export const MAX_PRECIO_CENTAVOS = 10_000_000 * 100;
export const MAX_NOMBRE = 200;
export const MAX_MOTIVO = 200;

/** El hallazgo del odontograma que originó la fila (chip de la ventana). */
export interface HallazgoDeOrigen {
  /** Condición del odontograma («caries», «pulpitis»…), tal como la guarda `OdontogramEntry`. */
  condicion: string;
  diente: number | null;
  caras: string[];
  /** La entrada del odontograma, si la hay. */
  entryId: string | null;
}

/** Una fila tal como está guardada. */
export interface FilaDelPlan {
  id: string;
  clinicId: string;
  planId: string;
  /** Procedimiento del tarifario (`procedure_catalog`), si salió de ahí. */
  procedureId: string | null;
  /** Nombre COPIADO al planear: si el tarifario cambia después, la fila no. */
  nombre: string;
  /** FDI, en el orden en que se eligieron. */
  dientes: number[];
  caras: string[];
  fase: Fase | null;
  /** Etapa numérica de un presupuesto («Fase 2») cuando la fila nació de él y no trae fase clínica. */
  faseNumero: number | null;
  cantidad: number;
  precioCentavos: number;
  estado: EstadoDeFila;
  hechoEn: Date | null;
  hechoPor: string | null;
  citaId: string | null;
  /** El texto del motivo («Caries»), para el PDF y el presupuesto. "" si no hay. */
  motivo: string;
  hallazgo: HallazgoDeOrigen | null;
  /** La nota de cobro (Invoice) que la cobra, y en qué línea de sus `items`. */
  invoiceId: string | null;
  invoiceLinea: number | null;
  /** El concepto del presupuesto que salió de ella. */
  quoteItemId: string | null;
  orden: number;
  canceladoEn: Date | null;
  canceladoPor: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Lo que hace falta para dar de alta (o reescribir) una fila, ya validado. */
export interface FilaNueva {
  procedureId: string | null;
  nombre: string;
  dientes: number[];
  caras: string[];
  fase: Fase | null;
  faseNumero: number | null;
  cantidad: number;
  precioCentavos: number;
  motivo: string;
  hallazgo: HallazgoDeOrigen | null;
  /** Solo «pendiente», «en_curso» o «hecho» al nacer (lo hecho fuera del plan entra como hecho). */
  estado: Exclude<EstadoDeFila, "cancelado">;
}

/** Una fila que llega del navegador para un PATCH: con `id`, es una que ya existe. */
export interface FilaEntrante extends FilaNueva {
  id: string | null;
}

// ── Dinero ──────────────────────────────────────────────────────────────────

/** Pesos → centavos exactos. «1250.5», 1250.5 y «$1,250.50» dan 125050. NaN si no es un número. */
export function aCentavos(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.round(valor * 100) : NaN;
  if (typeof valor !== "string") return NaN;
  const limpio = valor.replace(/[$\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return NaN;
  const [entero, dec = ""] = limpio.replace("-", "").split(".");
  // Sin pasar por float: «0.29» × 100 en float da 28.999…
  const centavos = Number(entero) * 100 + Number((dec + "00").slice(0, 2)) + (Number(dec.charAt(2) || "0") >= 5 ? 1 : 0);
  return limpio.startsWith("-") ? -centavos : centavos;
}

/** Centavos → pesos (para Prisma Float y para pintar). */
export const aPesos = (centavos: number): number => Math.round(centavos) / 100;

export const importeCentavos = (f: Pick<FilaDelPlan, "cantidad" | "precioCentavos">): number => f.cantidad * f.precioCentavos;

export const esViva = (f: Pick<FilaDelPlan, "estado">): boolean => f.estado !== "cancelado";

export function filasVivas<T extends Pick<FilaDelPlan, "estado">>(filas: T[]): T[] {
  return filas.filter(esViva);
}

/** Lo que suman las filas no canceladas, en centavos. */
export function totalCentavos(filas: Array<Pick<FilaDelPlan, "estado" | "cantidad" | "precioCentavos">>): number {
  return filasVivas(filas).reduce((s, f) => s + importeCentavos(f), 0);
}

export interface ResumenDeFilas {
  /** Filas no canceladas. */
  vivas: number;
  pendientes: number;
  enCurso: number;
  hechas: number;
  canceladas: number;
  totalCentavos: number;
  /** De lo vivo, lo que ya está en una nota de cobro. */
  enNotaCentavos: number;
}

export function resumenDeFilas(filas: FilaDelPlan[]): ResumenDeFilas {
  const r: ResumenDeFilas = { vivas: 0, pendientes: 0, enCurso: 0, hechas: 0, canceladas: 0, totalCentavos: 0, enNotaCentavos: 0 };
  for (const f of filas) {
    if (f.estado === "cancelado") {
      r.canceladas++;
      continue;
    }
    r.vivas++;
    if (f.estado === "pendiente") r.pendientes++;
    else if (f.estado === "en_curso") r.enCurso++;
    else r.hechas++;
    r.totalCentavos += importeCentavos(f);
    if (f.invoiceId) r.enNotaCentavos += importeCentavos(f);
  }
  return r;
}

/** «16,26»: los dientes como los guarda `QuoteItem.toothFdi`. "" si no hay. */
export const dientesCsv = (dientes: number[]): string => dientes.join(",");

// ── Estados ─────────────────────────────────────────────────────────────────

const PASOS: Record<EstadoDeFila, readonly EstadoDeFila[]> = {
  pendiente: ["en_curso", "hecho", "cancelado"],
  en_curso: ["pendiente", "hecho", "cancelado"],
  // Deshacer un «hecho» lo regresa a pendiente o a en curso; un hecho no se cancela.
  hecho: ["pendiente", "en_curso"],
  // Una cancelada no revive: si vuelve a hacer falta, es una fila nueva (queda el rastro de las dos).
  cancelado: [],
};

/** ¿Se puede pasar de `de` a `a`? (Quedarse igual no es un paso.) */
export function puedePasar(de: EstadoDeFila, a: EstadoDeFila): boolean {
  return PASOS[de].indexOf(a) !== -1;
}

/** Por qué una fila no se puede cancelar, o null si sí. */
export function motivoParaNoCancelar(f: Pick<FilaDelPlan, "estado" | "invoiceId">): CodigoDeFila | null {
  if (f.estado === "cancelado") return null;
  if (f.estado === "hecho") return "fila_hecha";
  if (f.invoiceId) return "fila_cobrada";
  return null;
}

// ── Validación de lo que llega del navegador ────────────────────────────────

export type CodigoDeFila =
  | "filas_no_lista"
  | "demasiadas_filas"
  | "sin_nombre"
  | "nombre_largo"
  | "diente_invalido"
  | "cara_invalida"
  | "fase_invalida"
  | "cantidad_invalida"
  | "precio_invalido"
  | "estado_invalido"
  | "fila_desconocida"
  | "fila_repetida"
  | "fila_cancelada"
  | "fila_cobrada"
  | "fila_hecha";

/**
 * Resultado de leer filas. Interfaz plana a propósito (tsconfig sin `strict`: `if (!r.ok)` no
 * estrecha una unión — ver lib/quotes/present.ts).
 */
export interface LecturaDeFilas<T> {
  ok: boolean;
  filas?: T[];
  /** Índice (desde 0) de la fila que falló. */
  indice?: number;
  codigo?: CodigoDeFila;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function leerDientesDeFila(v: unknown): number[] | null {
  const crudos: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[^0-9]+/).filter(Boolean) : v == null ? [] : [v];
  const out: number[] = [];
  for (const c of crudos) {
    const n = typeof c === "number" ? c : Number(String(c).trim());
    if (!esFdi(n)) return null;
    if (out.indexOf(n) === -1) out.push(n);
  }
  return out.length > 32 ? null : out;
}

function leerCaras(v: unknown): string[] | null {
  const crudos: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split("") : v == null ? [] : [v];
  const marcadas = new Set<string>();
  for (const c of crudos) {
    const letra = String(c).trim().toUpperCase();
    if (!letra || letra === "," || letra === " ") continue;
    const cara = letra === "I" ? "O" : letra; // incisal = la cara del centro (odontograma)
    if ((CARAS_DE_FILA as readonly string[]).indexOf(cara) === -1) return null;
    marcadas.add(cara);
  }
  return CARAS_DE_FILA.filter((c) => marcadas.has(c));
}

function leerHallazgo(v: unknown): HallazgoDeOrigen | null {
  if (!v || typeof v !== "object") return null;
  const h = v as Record<string, unknown>;
  const condicion = texto(h.condicion).slice(0, 80);
  if (!condicion) return null;
  const diente = Number(h.diente);
  return {
    condicion,
    diente: esFdi(diente) ? diente : null,
    caras: leerCaras(h.caras) ?? [],
    entryId: texto(h.entryId).slice(0, 100) || null,
  };
}

/**
 * Lee UNA fila del navegador. Acepta el precio como `precio` (pesos: número o texto) o como
 * `precioCentavos` (entero); dientes como lista o «16, 26»; caras como lista o «MO».
 */
export function leerFila(raw: unknown): { fila: FilaEntrante | null; codigo: CodigoDeFila | null } {
  if (!raw || typeof raw !== "object") return { fila: null, codigo: "sin_nombre" };
  const r = raw as Record<string, unknown>;
  const nombre = texto(r.nombre ?? r.name);
  if (!nombre) return { fila: null, codigo: "sin_nombre" };
  if (nombre.length > MAX_NOMBRE) return { fila: null, codigo: "nombre_largo" };

  const dientes = leerDientesDeFila(r.dientes);
  if (!dientes) return { fila: null, codigo: "diente_invalido" };
  const caras = leerCaras(r.caras);
  if (!caras) return { fila: null, codigo: "cara_invalida" };

  const faseCruda = r.fase == null || r.fase === "" ? null : String(r.fase);
  if (faseCruda !== null && (FASES as readonly string[]).indexOf(faseCruda) === -1) return { fila: null, codigo: "fase_invalida" };
  const faseNumero = r.faseNumero == null || r.faseNumero === "" ? null : Number(r.faseNumero);
  if (faseNumero !== null && !(Number.isInteger(faseNumero) && faseNumero >= 1 && faseNumero <= 50)) return { fila: null, codigo: "fase_invalida" };

  const cantidad = r.cantidad == null || r.cantidad === "" ? 1 : Number(r.cantidad);
  if (!(Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= MAX_CANTIDAD)) return { fila: null, codigo: "cantidad_invalida" };

  const precioCentavos =
    r.precioCentavos != null && r.precioCentavos !== "" ? Number(r.precioCentavos) : r.precio == null || r.precio === "" ? 0 : aCentavos(r.precio);
  if (!(Number.isInteger(precioCentavos) && precioCentavos >= 0 && precioCentavos <= MAX_PRECIO_CENTAVOS)) {
    return { fila: null, codigo: "precio_invalido" };
  }

  const estadoCrudo = r.estado == null || r.estado === "" ? "pendiente" : String(r.estado);
  if (estadoCrudo !== "pendiente" && estadoCrudo !== "en_curso" && estadoCrudo !== "hecho") return { fila: null, codigo: "estado_invalido" };

  const procedureId = texto(r.procedureId ?? r.procedimientoId).slice(0, 100) || null;
  const id = texto(r.id).slice(0, 100) || null;
  return {
    fila: {
      id,
      procedureId,
      nombre,
      dientes,
      caras,
      fase: faseCruda as Fase | null,
      faseNumero,
      cantidad,
      precioCentavos,
      motivo: texto(r.motivo).slice(0, MAX_MOTIVO),
      hallazgo: leerHallazgo(r.hallazgo),
      estado: estadoCrudo,
    },
    codigo: null,
  };
}

/** Lee la lista entera (`items` del cuerpo). Cualquier fila mala detiene todo: nada se guarda a medias. */
export function leerFilas(raw: unknown): LecturaDeFilas<FilaEntrante> {
  if (!Array.isArray(raw)) return { ok: false, codigo: "filas_no_lista" };
  if (raw.length > MAX_FILAS_POR_PLAN) return { ok: false, codigo: "demasiadas_filas" };
  const filas: FilaEntrante[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const { fila, codigo } = leerFila(raw[i]);
    if (!fila) return { ok: false, indice: i, codigo: codigo ?? "sin_nombre" };
    if (fila.id) {
      if (ids.has(fila.id)) return { ok: false, indice: i, codigo: "fila_repetida" };
      ids.add(fila.id);
    }
    filas.push(fila);
  }
  return { ok: true, filas };
}

/** Quita el `id` (alta): una fila nueva nunca trae id del navegador. */
export function comoNueva(f: FilaEntrante): FilaNueva {
  const { id: _id, ...resto } = f;
  return resto;
}

// ── Editar el plan: qué cambia ──────────────────────────────────────────────

export interface CambioDeFila {
  id: string;
  antes: FilaDelPlan;
  despues: FilaNueva;
}

export interface PlanDeCambios {
  ok: boolean;
  altas?: FilaNueva[];
  cambios?: CambioDeFila[];
  /** Filas que dejan de estar en la lista: se CANCELAN (nunca se borran). */
  cancelar?: FilaDelPlan[];
  /** Orden final: id de fila existente o «alta:N» (índice en `altas`). */
  orden?: string[];
  indice?: number;
  codigo?: CodigoDeFila;
}

const DINERO_Y_QUE: Array<keyof FilaNueva> = ["procedureId", "nombre", "cantidad", "precioCentavos"];

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** ¿La fila cambia en algo que se guarda? (el estado no: ese se mueve aparte). */
export function filaCambia(antes: FilaDelPlan, despues: FilaNueva): boolean {
  const campos: Array<keyof FilaNueva> = ["procedureId", "nombre", "dientes", "caras", "fase", "faseNumero", "cantidad", "precioCentavos", "motivo", "hallazgo"];
  return campos.some((k) => !igual((antes as unknown as Record<string, unknown>)[k], despues[k]));
}

/**
 * PATCH con `items`: la lista que manda la ventana es el plan ENTERO, en su orden.
 *  · sin `id` → alta;
 *  · con `id` de una fila viva → cambio (si cambia algo). Su ESTADO no se toca aquí;
 *  · una fila viva que ya no viene → se cancela. Si está hecha o ya cobrada, no: error, porque
 *    callarla escondería un procedimiento hecho o cobrado;
 *  · un `id` que no es del plan, o de una fila cancelada → error (nada se guarda).
 * Una fila cobrada solo admite cambios de dientes, caras, fase, motivo y orden.
 */
export function planearCambios(actuales: FilaDelPlan[], entrantes: FilaEntrante[]): PlanDeCambios {
  const porId = new Map(actuales.map((f) => [f.id, f]));
  const altas: FilaNueva[] = [];
  const cambios: CambioDeFila[] = [];
  const orden: string[] = [];
  const vistas = new Set<string>();

  for (let i = 0; i < entrantes.length; i++) {
    const e = entrantes[i];
    if (!e.id) {
      orden.push(`alta:${altas.length}`);
      altas.push(comoNueva(e));
      continue;
    }
    const antes = porId.get(e.id);
    if (!antes) return { ok: false, indice: i, codigo: "fila_desconocida" };
    if (antes.estado === "cancelado") return { ok: false, indice: i, codigo: "fila_cancelada" };
    vistas.add(e.id);
    orden.push(e.id);
    const despues = comoNueva(e);
    if (!filaCambia(antes, despues)) continue;
    if (antes.invoiceId && DINERO_Y_QUE.some((k) => !igual((antes as unknown as Record<string, unknown>)[k], despues[k]))) {
      return { ok: false, indice: i, codigo: "fila_cobrada" };
    }
    cambios.push({ id: e.id, antes, despues });
  }

  const cancelar: FilaDelPlan[] = [];
  for (const f of actuales) {
    if (f.estado === "cancelado" || vistas.has(f.id)) continue;
    const no = motivoParaNoCancelar(f);
    if (no) return { ok: false, codigo: no, indice: -1 };
    cancelar.push(f);
  }
  return { ok: true, altas, cambios, cancelar, orden };
}

// ── La capa de base (la implementa items-db.ts, solo servidor) ──────────────

/** El cliente con el que se escribe: `prisma` o la `tx` de una transacción. */
export type DbDeFilas = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

export interface CambioDeEstado {
  clinicId: string;
  planId: string;
  filaId: string;
  a: EstadoDeFila;
  userId: string | null;
  /** La cita en que se hizo (al pasar a «hecho»). */
  citaId?: string | null;
  /** Cuándo (por omisión, ahora). */
  en?: Date;
}

export interface RepoFilas {
  /** ¿Está la tabla? Sin ella, el plan es el de siempre (texto) y nada de esto se consulta. */
  disponible(forzar?: boolean): Promise<boolean>;
  /** Filas del plan en su orden; las canceladas solo si se piden. */
  leer(clinicId: string, planId: string, opciones?: { conCanceladas?: boolean; db?: DbDeFilas }): Promise<FilaDelPlan[]>;
  /** Filas vivas de varios planes en UNA consulta (la lista de planes). */
  leerDePlanes(clinicId: string, planIds: string[]): Promise<Map<string, FilaDelPlan[]>>;
  insertar(db: DbDeFilas, args: { clinicId: string; planId: string; userId: string | null; filas: FilaNueva[]; ordenDesde?: number }): Promise<FilaDelPlan[]>;
  /** Aplica un `planearCambios` ya validado: altas, cambios, cancelaciones y orden. */
  aplicarCambios(db: DbDeFilas, args: { clinicId: string; planId: string; userId: string | null; cambios: PlanDeCambios }): Promise<FilaDelPlan[]>;
  /** Mueve el estado (valida `puedePasar`); al pasar a «hecho» anota cuándo, quién y la cita. */
  cambiarEstado(db: DbDeFilas, cambio: CambioDeEstado): Promise<FilaDelPlan>;
  /** Liga filas a su nota de cobro SOLO si no tienen una viva: devuelve cuántas ligó. */
  ligarANota(db: DbDeFilas, args: { clinicId: string; planId: string; ligas: Array<{ filaId: string; invoiceId: string; linea: number | null }>; reemplazar?: string[] }): Promise<number>;
  /** Anota de qué concepto del presupuesto salió cada fila. */
  ligarAConceptos(db: DbDeFilas, args: { clinicId: string; planId: string; ligas: Array<{ filaId: string; quoteItemId: string | null }> }): Promise<void>;
}
