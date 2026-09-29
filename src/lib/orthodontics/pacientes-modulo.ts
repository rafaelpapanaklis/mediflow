// ═══════════════════════════════════════════════════════════════════════════
// PACIENTES EN TRATAMIENTO — la pantalla del módulo (ws1-t4 ronda 6, filas 18,
// 19 y 20 de la revisión de lógica de uso). Puro, sin I/O: recibe los casos y
// los controles ya cargados (`pacientes-modulo-db.ts`) y devuelve las filas y
// los filtros que pinta `/dashboard/orthodontics/pacientes`.
//
// LO QUE ARREGLA
//  - La tabla enseñaba dinero dos veces (saldo vencido y próxima mensualidad)
//    y nada clínico: era casi la misma tabla que Cobranza. Ahora dice por
//    dónde va cada caso, qué aparatología lleva y cuándo fue y cuándo es su
//    control. De dinero queda una sola columna.
//  - Solo salían los casos «en curso», sin forma de encontrar a quien está en
//    retención, en pausa, terminó o abandonó. Ahora hay filtro por estado y
//    por doctor tratante.
//  - Un caso SIN plan de pago salía «Al día», que quiere decir «paga
//    puntual». Ahora dice «Sin plan de pago».
//
// Un solo nombre para cada cosa: el expediente de ortodoncia es el «caso», y
// los estados se dicen igual que en la ficha (`resumen-para-ficha.ts`).
// ═══════════════════════════════════════════════════════════════════════════

import { differenceInMonths } from "date-fns";
import { nombreDeTecnica } from "./tecnicas-de-la-clinica";
import {
  evaluarEliminacion,
  explicacionDeHistorial,
  type HistorialDelCaso,
  type VeredictoDeEliminacion,
} from "./eliminar-caso";
import {
  ETIQUETA_ESTADO_CASO,
  resumenOrtoParaFicha,
  type EstadoCasoOrto,
} from "./resumen-para-ficha";

export type EstadoDelPlan = "PLANNED" | "IN_PROGRESS" | "ON_HOLD" | "RETENTION" | "COMPLETED" | "DROPPED_OUT";

/** Lo que se necesita de cada caso. `OrthoCaseSummary` lo cumple, más lo clínico. */
export interface CasoParaLaLista {
  planId: string;
  patientId: string;
  patientName: string;
  treatingDoctorId: string | null;
  treatingDoctorName: string | null;
  status: EstadoDelPlan | string;
  installedAt: Date | null;
  estimatedDurationMonths: number | null;
  statusUpdatedAt: Date;
  /** `null` = sin plan de pago todavía. */
  cobranza: { vencidas: ReadonlyArray<{ falta: number }> } | null;
}

export interface LoClinicoDelCaso {
  /** Clave de la técnica (`OrthoTechnique`), o `null` si no se pudo leer. */
  technique: string | null;
  /** ws1-t10: nombre propio de la técnica del caso; sin él sale el del tipo base. */
  techniqueLabel?: string | null;
  phases: ReadonlyArray<{ status: string; phaseKey: string }>;
}

export interface ControlesDelPaciente {
  /** El último control al que SÍ vino (cita atendida u hoja registrada). */
  ultimo: Date | null;
  /** Su próximo control agendado (ni cancelado ni falta). */
  proximo: Date | null;
}

export type CobranzaDeLaFila = "vencido" | "al-dia" | "sin-plan";

export interface FilaDeCaso {
  planId: string;
  patientId: string;
  patientName: string;
  treatingDoctorId: string | null;
  treatingDoctorName: string | null;
  estado: EstadoCasoOrto;
  /** «En curso», «Por colocar», «Pausado», «En retención», «Terminado», «Abandonado». */
  etiquetaEstado: string;
  /** «Mes 2 de 18 · Alineación». Vacío cuando el estado ya lo dice todo. */
  etapa: string;
  /** «Brackets metálicos», o «—» si no se sabe. */
  aparatologia: string;
  /** Instantes en ISO: la pantalla los pinta en la zona de la clínica. */
  ultimoControl: string | null;
  proximoControl: string | null;
  cobranza: CobranzaDeLaFila;
  vencidoMxn: number;
  colocadoEsteMes: boolean;
  retiradoEsteMes: boolean;
  /** ws1-t8: cuándo se colocó (ISO), o `null` si el caso aún no se coloca. */
  inicio: string | null;
  /** ws1-t8: lo que falta por pagar de la factura del tratamiento; `null` = sin factura. */
  saldoMxn: number | null;
  /**
   * ws1-t8: si el caso se puede eliminar (abierto por error, sin historial).
   * `explicacion` es lo que se le dice cuando NO se puede; vacío si no se sabe.
   */
  eliminar: VeredictoDeEliminacion & { explicacion: string };
}

/** Lo que la lista sabe de cada caso además de lo clínico: el saldo y qué tiene (para «Eliminar»). */
export interface LoDelDineroYElHistorial {
  saldoMxn: number | null;
  /** Sin él no se sabe si el caso tiene historial, y «Eliminar» no se ofrece. */
  historial?: HistorialDelCaso;
}

/** Las mismas palabras que la pestaña Ortodoncia de la ficha (`redesign/adapter.ts`). */
export const ETIQUETA_TECNICA: Record<string, string> = {
  METAL_BRACKETS: "Brackets metálicos",
  CERAMIC_BRACKETS: "Brackets cerámicos",
  SELF_LIGATING_METAL: "Brackets metálicos auto-ligado",
  SELF_LIGATING_CERAMIC: "Brackets cerámicos auto-ligado",
  LINGUAL_BRACKETS: "Brackets linguales",
  CLEAR_ALIGNERS: "Alineadores transparentes",
  HYBRID: "Tratamiento híbrido",
};

const ESTADO_POR_STATUS: Record<string, EstadoCasoOrto> = {
  PLANNED: "planeado",
  IN_PROGRESS: "en-curso",
  ON_HOLD: "pausado",
  RETENTION: "retencion",
  COMPLETED: "terminado",
  DROPPED_OUT: "abandonado",
};

/** El mismo criterio que los indicadores del Tablero (`isSameCalendarMonthUtc`). */
function mismoMes(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

export function filaDeCaso(
  caso: CasoParaLaLista,
  clinico: LoClinicoDelCaso | undefined,
  controles: ControlesDelPaciente | undefined,
  ahora: Date,
  extra?: LoDelDineroYElHistorial,
): FilaDeCaso | null {
  const estado = ESTADO_POR_STATUS[String(caso.status)];
  // Un estado que no se conoce no se pinta: mejor una fila menos que una mal dicha.
  if (!estado) return null;

  const resumen = resumenOrtoParaFicha({
    plan: { status: String(caso.status), estimatedDurationMonths: caso.estimatedDurationMonths },
    phases: clinico?.phases ?? [],
    monthInTreatment: caso.installedAt ? Math.max(0, differenceInMonths(ahora, caso.installedAt)) : 0,
  });

  const vencidoMxn = Math.round((caso.cobranza?.vencidas ?? []).reduce((s, q) => s + q.falta, 0));
  const cobranza: CobranzaDeLaFila = caso.cobranza === null ? "sin-plan" : vencidoMxn > 0 ? "vencido" : "al-dia";

  return {
    planId: caso.planId,
    patientId: caso.patientId,
    patientName: caso.patientName,
    treatingDoctorId: caso.treatingDoctorId,
    treatingDoctorName: caso.treatingDoctorName,
    estado,
    etiquetaEstado: ETIQUETA_ESTADO_CASO[estado],
    etapa: resumen?.enCurso ? resumen.linea : "",
    aparatologia: clinico?.technique ? nombreDeTecnica(clinico.technique, clinico.techniqueLabel, ETIQUETA_TECNICA[clinico.technique] ?? clinico.technique) : "—",
    ultimoControl: controles?.ultimo ? controles.ultimo.toISOString() : null,
    proximoControl: controles?.proximo ? controles.proximo.toISOString() : null,
    cobranza,
    vencidoMxn,
    colocadoEsteMes: caso.installedAt !== null && mismoMes(caso.installedAt, ahora),
    retiradoEsteMes:
      (caso.status === "RETENTION" || caso.status === "COMPLETED") && mismoMes(caso.statusUpdatedAt, ahora),
    inicio: caso.installedAt ? caso.installedAt.toISOString() : null,
    saldoMxn: extra?.saldoMxn ?? null,
    eliminar: veredictoDeLaFila(extra?.historial),
  };
}

function veredictoDeLaFila(h: HistorialDelCaso | undefined): FilaDeCaso["eliminar"] {
  // Sin saber qué tiene el caso, no se ofrece borrarlo ni se dice que tiene historial.
  if (!h) return { puede: false, motivos: [], facturasACancelar: 0, explicacion: "" };
  const v = evaluarEliminacion(h);
  return { ...v, explicacion: explicacionDeHistorial(v) };
}

/** Lo que falta por pagar de una factura: total menos lo cobrado, sin bajar de cero. */
export function saldoDeFactura(total: unknown, pagos: ReadonlyArray<{ amount: unknown }>): number {
  const pagado = pagos.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return Math.max(0, Math.round(((Number(total) || 0) - pagado) * 100) / 100);
}

/**
 * Los controles de cada paciente, a partir de las citas de control de la
 * Agenda y de las hojas de control registradas. Una cita pasada que nadie
 * marcó como atendida y que no tiene hoja no cuenta: no se sabe si vino.
 */
export function controlesPorPaciente(
  citas: ReadonlyArray<{ patientId: string; startsAt: Date; status: string }>,
  hojas: ReadonlyArray<{ patientId: string; visitDate: Date }>,
  ahora: Date,
): Map<string, ControlesDelPaciente> {
  const mapa = new Map<string, ControlesDelPaciente>();
  const de = (id: string) => {
    let c = mapa.get(id);
    if (!c) {
      c = { ultimo: null, proximo: null };
      mapa.set(id, c);
    }
    return c;
  };
  for (const c of citas) {
    if (c.status === "CANCELLED" || c.status === "NO_SHOW") continue;
    const p = de(c.patientId);
    if (c.startsAt >= ahora) {
      if (!p.proximo || c.startsAt < p.proximo) p.proximo = c.startsAt;
    } else if (c.status === "COMPLETED" || c.status === "CHECKED_OUT") {
      if (!p.ultimo || c.startsAt > p.ultimo) p.ultimo = c.startsAt;
    }
  }
  for (const h of hojas) {
    if (h.visitDate > ahora) continue;
    const p = de(h.patientId);
    if (!p.ultimo || h.visitDate > p.ultimo) p.ultimo = h.visitDate;
  }
  return mapa;
}

// ── Filtros ────────────────────────────────────────────────────────────────

export type FiltroEstado = "activos" | EstadoCasoOrto | "todos";
export type FiltroVer = "colocados-este-mes" | "retirados-este-mes";

const ACTIVOS: ReadonlyArray<EstadoCasoOrto> = ["planeado", "en-curso", "pausado", "retencion"];

/** El orden en que se ofrecen, y cómo se llaman. «Activos» es con lo que abre la pantalla. */
export const OPCIONES_DE_ESTADO: ReadonlyArray<{ id: FiltroEstado; etiqueta: string }> = [
  { id: "activos", etiqueta: "Casos activos" },
  { id: "en-curso", etiqueta: ETIQUETA_ESTADO_CASO["en-curso"] },
  { id: "planeado", etiqueta: ETIQUETA_ESTADO_CASO.planeado },
  { id: "pausado", etiqueta: ETIQUETA_ESTADO_CASO.pausado },
  { id: "retencion", etiqueta: ETIQUETA_ESTADO_CASO.retencion },
  { id: "terminado", etiqueta: ETIQUETA_ESTADO_CASO.terminado },
  { id: "abandonado", etiqueta: ETIQUETA_ESTADO_CASO.abandonado },
  { id: "todos", etiqueta: "Todos los casos" },
];

/** Lo que llega en la dirección (`?estado=`), saneado. Lo que no se conoce es «activos». */
export function leerFiltroEstado(valor: string | string[] | undefined): FiltroEstado {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return OPCIONES_DE_ESTADO.some((o) => o.id === v) ? (v as FiltroEstado) : "activos";
}

/** Lo que llega en la dirección (`?ver=`), saneado. */
export function leerFiltroVer(valor: string | string[] | undefined): FiltroVer | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v === "colocados-este-mes" || v === "retirados-este-mes" ? v : null;
}

export const ETIQUETA_VER: Record<FiltroVer, string> = {
  "colocados-este-mes": "Colocados este mes",
  "retirados-este-mes": "Retirados este mes",
};

export interface FiltrosDeCasos {
  estado: FiltroEstado;
  /** Id del doctor tratante, `"sin-doctor"` o `null` para todos. */
  doctor: string | null;
  ver: FiltroVer | null;
  consulta: string;
}

export const SIN_DOCTOR = "sin-doctor";

const comparable = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function filtrarCasos(filas: ReadonlyArray<FilaDeCaso>, f: FiltrosDeCasos): FilaDeCaso[] {
  const q = comparable(f.consulta);
  return filas.filter((r) => {
    // «Colocados / retirados este mes» manda sobre el estado: un retiro de
    // este mes ya está en retención o terminado, y tiene que salir.
    if (f.ver === "colocados-este-mes") {
      if (!r.colocadoEsteMes) return false;
    } else if (f.ver === "retirados-este-mes") {
      if (!r.retiradoEsteMes) return false;
    } else if (f.estado === "activos") {
      if (ACTIVOS.indexOf(r.estado) === -1) return false;
    } else if (f.estado !== "todos" && r.estado !== f.estado) {
      return false;
    }
    if (f.doctor === SIN_DOCTOR) {
      if (r.treatingDoctorId) return false;
    } else if (f.doctor && r.treatingDoctorId !== f.doctor) {
      return false;
    }
    if (q) {
      const texto = comparable(`${r.patientName} ${r.treatingDoctorName ?? ""}`);
      if (texto.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/** Cuántos casos hay en cada opción del filtro de estado, para pintarlo al lado. */
export function contarPorEstado(filas: ReadonlyArray<FilaDeCaso>): Record<FiltroEstado, number> {
  const c: Record<FiltroEstado, number> = {
    activos: 0,
    "en-curso": 0,
    planeado: 0,
    pausado: 0,
    retencion: 0,
    terminado: 0,
    abandonado: 0,
    todos: filas.length,
  };
  for (const r of filas) {
    c[r.estado] += 1;
    if (ACTIVOS.indexOf(r.estado) !== -1) c.activos += 1;
  }
  return c;
}

/** Los doctores tratantes que aparecen en la lista, por nombre. */
export function doctoresDeLaLista(
  filas: ReadonlyArray<FilaDeCaso>,
): { id: string; nombre: string }[] {
  const vistos = new Map<string, string>();
  let hayCasosSinDoctor = false;
  for (const r of filas) {
    if (r.treatingDoctorId) vistos.set(r.treatingDoctorId, r.treatingDoctorName ?? "Doctor sin nombre");
    else hayCasosSinDoctor = true;
  }
  const lista = Array.from(vistos, ([id, nombre]) => ({ id, nombre })).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es"),
  );
  if (hayCasosSinDoctor) lista.push({ id: SIN_DOCTOR, nombre: "Sin doctor tratante" });
  return lista;
}
