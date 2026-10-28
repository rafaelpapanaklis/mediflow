// «En esta cita: resina $700 (hecha) · Debe hoy $700» — el detalle de la cita en la Agenda (v17,
// decisión 2 de Rafael, 28-oct-2026).
//
//  · Los procedimientos del plan LIGADOS a esa cita: agendados para ella («Agendar lo pendiente»,
//    `citaAgendadaId`) y/o marcados hechos en ella (`citaId`), con su importe y su estado. Sin canceladas.
//  · «Debe hoy» = `debeDelPaciente`, la misma cifra de Pacientes y del «Debe» de la ficha.
//  · Sin nada del plan en la cita, nada (y no se lee el dinero).
//
// Todo por `clinicId` de la sesión: la fila, el plan y la cita de la MISMA clínica. SQL crudo, como el
// resto de las filas del plan.

import { prisma } from "@/lib/prisma";
import { debeDelPaciente } from "@/lib/dinero/lo-que-se-debe.server";
import { aCentavos, aPesos, ESTADOS_DE_FILA, type EstadoDeFila } from "./items";
import { tablaDeFilasExiste } from "./items-db";
import { citasDelPlanDisponible } from "./citas-del-plan-db";

export interface FilaDeLaCita {
  id: string;
  planId: string;
  plan: string;
  /** «Resina 16 (MO)». */
  nombre: string;
  /** Cantidad × precio, en pesos. */
  importe: number;
  estado: EstadoDeFila;
  /** Agendada para esta cita. */
  agendada: boolean;
  /** Marcada hecha EN esta cita. */
  hechaAqui: boolean;
}

export interface PlanDeLaCita {
  filas: FilaDeLaCita[];
  /** null cuando no hay filas (no se lee). */
  debeHoy: number | null;
}

const NADA: PlanDeLaCita = { filas: [], debeHoy: null };

export async function planDeLaCita(clinicId: string, appointmentId: string): Promise<PlanDeLaCita> {
  if (!clinicId) throw new Error("plan:cita: clinicId ausente — se corta antes de consultar");
  if (!appointmentId) return NADA;
  const cita = await prisma.$queryRaw<Array<{ patientId: string | null }>>`
    SELECT "patientId" FROM "appointments" WHERE "id" = ${appointmentId} AND "clinicId" = ${clinicId}`;
  if (cita.length !== 1) return NADA;
  if (!(await tablaDeFilasExiste())) return NADA;
  // Sin sql/plan-tratamiento-citas.sql no hay «agendada para»: solo lo hecho en la cita.
  const conAgendadas = await citasDelPlanDisponible();
  const filas = conAgendadas
    ? await prisma.$queryRaw<FilaSql[]>`
        SELECT t."id", t."planId", p."name" AS "plan", t."nombre", t."dientes", t."caras", t."cantidad", t."precio", t."estado",
               (t."citaAgendadaId" = ${appointmentId}) AS "agendada", (t."citaId" = ${appointmentId}) AS "hechaAqui"
          FROM "treatment_plan_items" t
          JOIN "treatment_plans" p ON p."id" = t."planId" AND p."clinicId" = t."clinicId"
         WHERE t."clinicId" = ${clinicId} AND t."estado" <> 'cancelado'
           AND (t."citaId" = ${appointmentId} OR t."citaAgendadaId" = ${appointmentId})
         ORDER BY p."createdAt", t."orden", t."createdAt", t."id"`
    : await prisma.$queryRaw<FilaSql[]>`
        SELECT t."id", t."planId", p."name" AS "plan", t."nombre", t."dientes", t."caras", t."cantidad", t."precio", t."estado",
               false AS "agendada", true AS "hechaAqui"
          FROM "treatment_plan_items" t
          JOIN "treatment_plans" p ON p."id" = t."planId" AND p."clinicId" = t."clinicId"
         WHERE t."clinicId" = ${clinicId} AND t."estado" <> 'cancelado' AND t."citaId" = ${appointmentId}
         ORDER BY p."createdAt", t."orden", t."createdAt", t."id"`;
  if (filas.length === 0) return NADA;
  const salida = filas.map((r): FilaDeLaCita => {
    const dientes = (r.dientes ?? []).map(Number);
    const caras = (r.caras ?? []).map(String);
    const centavos = aCentavos(String(r.precio ?? "0"));
    const estado = (ESTADOS_DE_FILA as readonly string[]).includes(r.estado) ? (r.estado as EstadoDeFila) : "pendiente";
    return {
      id: r.id,
      planId: r.planId,
      plan: r.plan,
      nombre: `${r.nombre}${dientes.length ? ` ${dientes.join(", ")}` : ""}${caras.length ? ` (${caras.join("")})` : ""}`,
      importe: aPesos((Number(r.cantidad) || 1) * (Number.isFinite(centavos) ? centavos : 0)),
      estado,
      agendada: r.agendada === true,
      hechaAqui: r.hechaAqui === true,
    };
  });
  const patientId = cita[0].patientId;
  return { filas: salida, debeHoy: patientId ? await debeDelPaciente(clinicId, patientId) : 0 };
}

interface FilaSql {
  id: string;
  planId: string;
  plan: string;
  nombre: string;
  dientes: number[] | null;
  caras: string[] | null;
  cantidad: number;
  precio: unknown;
  estado: string;
  agendada: boolean | null;
  hechaAqui: boolean | null;
}
