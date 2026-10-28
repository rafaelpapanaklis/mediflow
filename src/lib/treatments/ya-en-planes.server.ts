// «¿Esto ya está en un plan del paciente?» (ws1-t6 v3) — lo que lee la base. La regla está en
// `ya-en-planes.ts` (pura).
//
// Todo por el `clinicId` de la sesión de quien llama; sin él (o sin paciente) se corta ANTES de
// consultar: `clinicId: undefined` no filtra nada en Prisma. Sin la tabla de filas (SQL sin pegar)
// no hay plan con filas: lista vacía.

import { prisma } from "@/lib/prisma";
import { repoFilas, tablaDeFilasExiste } from "./items-db";
import { planesDelPaciente } from "./sin-doble-cobro.server";
import { filasRepetidas, resumirFilas, type FilaEnPlan } from "./ya-en-planes";

/** procedureId → llave `ODO_*`, solo del tarifario de ESA clínica. */
async function codigosDeLaClinica(clinicId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!clinicId || unicos.length === 0) return new Map();
  const r = await prisma.procedureCatalog.findMany({
    where: { clinicId, id: { in: unicos } },
    select: { id: true, code: true },
  });
  return new Map(r.filter((x) => x.code).map((x) => [x.id, x.code as string]));
}

/**
 * Las filas que cuentan como «ya en un plan» del paciente, de TODOS sus doctores: tipo, dientes,
 * nombre del plan y estado (sin precios ni notas). `extraIds`: procedureIds de filas que se van a
 * comparar (sus llaves `ODO_*` salen en la misma consulta).
 */
export async function filasEnPlanesDelPaciente(
  clinicId: string,
  patientId: string,
  extraIds: Array<string | null> = [],
): Promise<{ filas: FilaEnPlan[]; codigos: Map<string, string> }> {
  if (!clinicId || !patientId) return { filas: [], codigos: new Map() };
  if (!(await tablaDeFilasExiste())) return { filas: [], codigos: new Map() };
  const planes = await planesDelPaciente(clinicId, patientId);
  if (planes.length === 0) return { filas: [], codigos: await codigosDeLaClinica(clinicId, extraIds) };
  const porPlan = await repoFilas.leerDePlanes(clinicId, planes.map((p) => p.id));
  const ids = [...Array.from(porPlan.values()).flat().map((f) => f.procedureId), ...extraIds];
  const codigos = await codigosDeLaClinica(clinicId, ids);
  return { filas: resumirFilas(planes, porPlan, codigos), codigos };
}

/**
 * Al guardar un plan (alta o filas nuevas): cuáles de sus filas NUEVAS ya están en otro plan del
 * paciente. No rechaza (una fila repetida a propósito —rehacer un trabajo— es válida): la respuesta
 * lo AVISA y la pantalla lo dice. Si la lectura falla, no avisa nada y no tumba el guardado.
 */
export async function avisoDeFilasRepetidas(
  clinicId: string,
  patientId: string,
  nuevas: Array<{ nombre: string; procedureId: string | null; dientes: number[] }>,
  planIdPropio: string | null = null,
): Promise<Array<{ nombre: string; dientes: number[]; plan: string }>> {
  if (nuevas.length === 0) return [];
  try {
    const { filas, codigos } = await filasEnPlanesDelPaciente(clinicId, patientId, nuevas.map((n) => n.procedureId));
    return filasRepetidas(nuevas, filas, { codigos, excluirPlanId: planIdPropio });
  } catch (e) {
    console.error("[plan] no se pudo comprobar si las filas ya están en otro plan:", e);
    return [];
  }
}
