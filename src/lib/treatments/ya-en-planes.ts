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
//  · la fila está por hacer (pendiente o en curso, en un plan no cancelado) o HECHA:
//      - de un procedimiento de un diente, hecha en CUALQUIER fecha (m-b): si la marca se quedó roja
//        con el trabajo hecho —«Hecho» sin permiso de odontograma, o sin el SQL—, no se ofrece otra vez.
//        Rehacerla años después se escribe a mano.
//      - de uno de toda la boca o de un cuadrante (limpieza, flúor, raspado), solo si se hizo hace
//        poco (`HECHO_RECIENTE_MS`): esos se repiten cada pocos meses.
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
  estado: string;
  hechoEn: Date | string | null;
}

const PLAN_CANCELADO = "ABANDONED";

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
      out.push({ planId: p.id, plan: p.name, clave, dientes: [...f.dientes], estado, hechoEn });
    }
  }
  return out;
}

function cuenta(f: FilaEnPlan, ahora: Date): boolean {
  if (f.estado !== "hecho") return true;
  if (PROCEDIMIENTOS[f.clave].alcance === "diente") return true;
  const en = f.hechoEn ? Date.parse(f.hechoEn) : NaN;
  return Number.isFinite(en) && ahora.getTime() - en <= HECHO_RECIENTE_MS;
}

/**
 * La fila de algún plan que ya tiene ese procedimiento en esos dientes (la primera por hacer; si
 * no, la primera hecha), o null. `excluirPlanId`: el plan que se está editando no cuenta.
 */
export function planQueYaLoTiene(
  clave: ClaveProcedimiento,
  dientes: number[],
  filas: FilaEnPlan[],
  opciones: { excluirPlanId?: string | null; ahora?: Date } = {},
): FilaEnPlan | null {
  const ahora = opciones.ahora ?? new Date();
  const candidatas = filas.filter((f) =>
    f.clave === clave
    && f.planId !== opciones.excluirPlanId
    && (f.dientes.length === 0 || dientes.length === 0 || dientes.some((d) => f.dientes.includes(d)))
    && cuenta(f, ahora));
  return candidatas.find((f) => f.estado !== "hecho") ?? candidatas[0] ?? null;
}

/** Las filas nuevas de un plan que ya están en OTRO plan del paciente: «Resina 16 (ya en «Plan X»)». */
export function filasRepetidas(
  nuevas: Array<{ nombre: string; procedureId: string | null; dientes: number[] }>,
  filas: FilaEnPlan[],
  opciones: { codigos?: ReadonlyMap<string, string>; excluirPlanId?: string | null; ahora?: Date } = {},
): Array<{ nombre: string; dientes: number[]; plan: string }> {
  const out: Array<{ nombre: string; dientes: number[]; plan: string }> = [];
  for (const n of nuevas) {
    const clave = claveDeProcedimiento({ codigo: n.procedureId ? opciones.codigos?.get(n.procedureId) ?? null : null, nombre: n.nombre });
    if (!clave) continue;
    const ya = planQueYaLoTiene(clave, n.dientes, filas, opciones);
    if (ya) out.push({ nombre: n.nombre, dientes: [...n.dientes], plan: ya.plan });
  }
  return out;
}
