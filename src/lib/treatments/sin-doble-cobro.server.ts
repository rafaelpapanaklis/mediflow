// «Que nada se cobre dos veces» (ws1-t12 · fase 2) — lo que lee la base. La regla está en
// `sin-doble-cobro.ts` (pura).
//
// Toda consulta lleva el `clinicId` de la sesión de quien llama, y sin él (o sin paciente) se corta
// ANTES de consultar: `clinicId: undefined` no filtra nada en Prisma.

import { prisma } from "@/lib/prisma";
import { repoFilas, tablaDeFilasExiste } from "./items-db";
import { emparejarConElPlan, nombresApartados, soloLoDeFuera, type FilaParaEmparejar } from "./sin-doble-cobro";

/**
 * Planes cuyas filas pueden «ser» lo que se cobra hoy. De un plan CANCELADO solo cuentan las filas que
 * siguen en una nota viva: cancelarlo no cambia su nota (borrar-plan.ts), así que lo que esa nota
 * cobra no se vuelve a facturar aparte (revisión, hallazgo 3).
 */
const ESTADOS_DE_PLAN_VIVO = ["ACTIVE", "PAUSED", "COMPLETED"] as const;
const CANCELADO = "ABANDONED";

/** Tope de planes por paciente que se miran (un paciente real tiene 1–3). */
const MAX_PLANES = 20;

export interface PlanDelPaciente {
  id: string;
  name: string;
  status: string;
  doctorId: string;
}

/**
 * Los planes del paciente (también los cancelados), del más nuevo al más viejo.
 *
 * v20 (B1 de t1, 28-oct): el estado se filtra AQUÍ, no en el `where`. En la base real
 * `treatment_plans.status` es TEXT y schema.prisma lo declara enum `TreatmentStatus`: un `where: { status }`
 * manda el parámetro como enum y Postgres contesta 42883 «operator does not exist: text = "TreatmentStatus"»
 * (panel.108: «Cuenta del plan», `/api/treatments/cuentas`, daba 500). Un paciente tiene pocos planes.
 */
export async function planesDelPaciente(clinicId: string, patientId: string): Promise<PlanDelPaciente[]> {
  if (!clinicId || !patientId) return [];
  const todos = await prisma.treatmentPlan.findMany({
    where: { clinicId, patientId },
    select: { id: true, name: true, status: true, doctorId: true },
    orderBy: { createdAt: "desc" },
  });
  const cuentan: readonly string[] = [...ESTADOS_DE_PLAN_VIVO, CANCELADO];
  return todos
    .map((p) => ({ ...p, status: String(p.status) }))
    .filter((p) => cuentan.includes(p.status))
    .slice(0, MAX_PLANES);
}

/**
 * Las filas del paciente que pueden ser lo de hoy, listas para `emparejarConElPlan`: las vivas de sus
 * planes vivos y, de un plan cancelado, las que siguen en una nota no cancelada. Sin la tabla de filas
 * (SQL sin pegar) no hay plan con filas: lista vacía y todo se cobra como hoy.
 */
export async function filasDelPaciente(clinicId: string, patientId: string): Promise<FilaParaEmparejar[]> {
  if (!clinicId || !patientId) return [];
  if (!(await tablaDeFilasExiste())) return [];
  const planes = await planesDelPaciente(clinicId, patientId);
  if (planes.length === 0) return [];
  const porPlan = await repoFilas.leerDePlanes(clinicId, planes.map((p) => p.id));
  const vivas = planes.filter((p) => p.status !== CANCELADO).flatMap((p) => porPlan.get(p.id) ?? []);
  const deCancelados = planes.filter((p) => p.status === CANCELADO).flatMap((p) => (porPlan.get(p.id) ?? []).filter((f) => !!f.invoiceId));
  if (deCancelados.length === 0) return vivas;
  const notasVivas = new Set(
    (await prisma.invoice.findMany({
      where: { clinicId, id: { in: Array.from(new Set(deCancelados.map((f) => f.invoiceId!))) }, status: { not: "CANCELLED" } },
      select: { id: true },
    })).map((i) => i.id),
  );
  return [...vivas, ...deCancelados.filter((f) => notasVivas.has(f.invoiceId!))];
}

/**
 * Filas que otra consulta del paciente ya apartó de su borrador (`specialtyData.planItemsApartados`):
 * no se vuelven a apartar. Sin esto, una fila pendiente que nadie marca hecha se tragaría las
 * consultas siguientes y lo de después ya no se cobraría (revisión, hallazgo 4).
 */
async function filasYaApartadasPorConsultas(clinicId: string, patientId: string): Promise<Set<string>> {
  const r = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT jsonb_array_elements_text("specialtyData"->'planItemsApartados') AS "id"
      FROM "medical_records"
     WHERE "clinicId" = ${clinicId} AND "patientId" = ${patientId}
       AND jsonb_typeof("specialtyData"->'planItemsApartados') = 'array'`;
  return new Set(r.map((x) => x.id));
}

/** Un procedimiento de «Procedimientos realizados» tal como viaja en `specialtyData.procedures`. */
export interface ProcedimientoDeConsulta {
  id?: string;
  name: string;
  price: number;
  quantity: number;
}

/**
 * La factura BORRADOR que la consulta crea sola (`POST /api/clinical`, `autoInvoice`) se queda solo
 * con lo que NO es de un plan del paciente: lo del plan se cobra en su nota. Devuelve lo que va al
 * borrador (con las cantidades que quedan), los nombres de lo apartado (para avisarlo) y las filas
 * que lo cubren (la consulta las anota en su `specialtyData.planItemsApartados`).
 */
export async function procedimientosParaElBorrador(
  clinicId: string,
  patientId: string,
  procedures: ProcedimientoDeConsulta[],
  ahora: Date = new Date(),
): Promise<{ procedures: ProcedimientoDeConsulta[]; delPlan: string[]; filaIds: string[] }> {
  const todas = await filasDelPaciente(clinicId, patientId);
  if (todas.length === 0) return { procedures, delPlan: [], filaIds: [] };
  const yaApartadas = await filasYaApartadasPorConsultas(clinicId, patientId);
  const filas = todas.filter((f) => !yaApartadas.has(f.id));
  if (filas.length === 0) return { procedures, delPlan: [], filaIds: [] };
  const cosas = procedures.map((p) => ({
    ...p,
    nombre: typeof p?.name === "string" ? p.name : "",
    procedureId: typeof p?.id === "string" ? p.id : null,
    cantidad: Number(p?.quantity) > 0 ? Number(p.quantity) : 1,
  }));
  const e = emparejarConElPlan(cosas, filas, ahora);
  return {
    procedures: soloLoDeFuera(cosas, e).map(({ nombre: _n, procedureId: _p, cantidad, ...resto }) => ({ ...resto, quantity: cantidad ?? resto.quantity })),
    delPlan: nombresApartados(cosas, e),
    filaIds: Array.from(new Set(e.delPlan.map((m) => m.filaId))),
  };
}
