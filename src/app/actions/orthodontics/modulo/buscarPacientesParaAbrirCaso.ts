"use server";
// Ortodoncia — módulo (ws1-t3, H17 de la QA en vivo del 28-sep-2026): el
// buscador de pacientes del botón «Abrir caso» de Pacientes en tratamiento.
// Solo LEE: a quién se le puede abrir un caso y quién ya lo tiene.
//
// `clinicId` SIEMPRE de la sesión (`getOrthoActionContext`), nunca del
// cliente; del cliente solo llega el texto a buscar. Todas las consultas
// filtran por clínica Y por visibilidad de paciente: un paciente restringido
// no se encuentra aquí por su nombre.
//
// La búsqueda es la MISMA del buscador de «Nueva cita»
// (`findPatientIdsBySearch`): sin acentos, con el teléfono normalizado y por
// folio. Tres consultas como mucho, en fila.

import { prisma } from "@/lib/prisma";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { patientSearchTokens } from "@/lib/patients/patient-search-core";
import { findPatientIdsBySearch } from "@/lib/patients/patient-search";
import {
  MAX_RESULTADOS,
  MIN_LETRAS_BUSQUEDA,
  situacionOrto,
  type SituacionOrto,
} from "@/lib/orthodontics/abrir-caso";
import { getOrthoActionContext } from "../_helpers";
import { isFailure, ok, type ActionResult } from "../result";

export interface PacienteParaAbrirCaso {
  id: string;
  fullName: string;
  /** Folio del paciente (P0147), si lo tiene. */
  patientNumber: string | null;
  phone: string | null;
  situacion: SituacionOrto;
}

export interface PacientesParaAbrirCaso {
  pacientes: PacienteParaAbrirCaso[];
  /** `true` = no se buscó nada: son los pacientes más recientes de la clínica. */
  recientes: boolean;
}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function buscarPacientesParaAbrirCaso(
  input: unknown,
): Promise<ActionResult<PacientesParaAbrirCaso>> {
  // Abrir un caso ESCRIBE en el expediente: quien no puede, tampoco busca aquí.
  const auth = await getOrthoActionContext({ write: true });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const crudo = typeof input === "string" ? input : (input as { q?: unknown } | null)?.q;
  const q = (typeof crudo === "string" ? crudo : "").trim().slice(0, 80);
  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const buscando = q.length >= MIN_LETRAS_BUSQUEDA;

  const base = {
    clinicId: ctx.clinicId,
    // ARCO: un paciente cancelado no aparece en ningún buscador.
    deletedAt: null,
  };
  const select = { id: true, firstName: true, lastName: true, phone: true, patientNumber: true } as const;

  let filas: Array<{ id: string; firstName: string; lastName: string; phone: string | null; patientNumber: string | null }>;
  if (!buscando) {
    filas = await prisma.patient.findMany({
      where: { ...base, AND: [...patientVisibilityAnd(viewer)] },
      select,
      orderBy: { createdAt: "desc" },
      take: MAX_RESULTADOS,
    });
  } else {
    const tokens = q.split(/\s+/).filter(Boolean);
    const ids = await findPatientIdsBySearch({
      clinicIds: [ctx.clinicId],
      tokens: patientSearchTokens(q),
      limit: 200,
    });
    filas = await prisma.patient.findMany({
      where: {
        ...base,
        AND: [
          ...patientVisibilityAnd(viewer),
          // Si la búsqueda normalizada no pudo preguntar (`null`), el
          // `contains` de siempre: nunca la lista sin filtrar.
          ...(ids !== null
            ? [{ id: { in: ids } }]
            : tokens.map((t) => ({
                OR: [
                  { firstName: { contains: t, mode: "insensitive" as const } },
                  { lastName: { contains: t, mode: "insensitive" as const } },
                  { phone: { contains: t } },
                  { patientNumber: { contains: t, mode: "insensitive" as const } },
                ],
              }))),
        ],
      },
      select,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: MAX_RESULTADOS,
    });
  }
  if (filas.length === 0) return ok({ pacientes: [], recientes: !buscando });

  const patientIds = filas.map((f) => f.id);
  const planes = await prisma.orthodonticTreatmentPlan.findMany({
    where: { clinicId: ctx.clinicId, patientId: { in: patientIds }, deletedAt: null },
    select: { patientId: true, status: true },
  });

  // `inObservation` es una columna de sql/ortodoncia-alta-caso.sql: si aún no
  // está en la base, se lee sin ella (el paciente sale «con diagnóstico»).
  let diagnosticos: Array<{ patientId: string; inObservation?: boolean }>;
  try {
    diagnosticos = await prisma.orthodonticDiagnosis.findMany({
      where: { clinicId: ctx.clinicId, patientId: { in: patientIds }, deletedAt: null },
      select: { patientId: true, inObservation: true },
    });
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
    diagnosticos = await prisma.orthodonticDiagnosis.findMany({
      where: { clinicId: ctx.clinicId, patientId: { in: patientIds }, deletedAt: null },
      select: { patientId: true },
    });
  }

  const planesPorPaciente = new Map<string, string[]>();
  for (const p of planes) {
    const lista = planesPorPaciente.get(p.patientId);
    if (lista) lista.push(p.status);
    else planesPorPaciente.set(p.patientId, [p.status]);
  }
  const dxPorPaciente = new Map<string, { cuantos: number; enObservacion: boolean }>();
  for (const d of diagnosticos) {
    const previo = dxPorPaciente.get(d.patientId) ?? { cuantos: 0, enObservacion: false };
    dxPorPaciente.set(d.patientId, {
      cuantos: previo.cuantos + 1,
      enObservacion: previo.enObservacion || d.inObservation === true,
    });
  }

  return ok({
    recientes: !buscando,
    pacientes: filas.map((f) => ({
      id: f.id,
      fullName: `${f.firstName} ${f.lastName}`.trim(),
      patientNumber: f.patientNumber,
      phone: f.phone,
      situacion: situacionOrto({
        planes: planesPorPaciente.get(f.id) ?? [],
        diagnosticos: dxPorPaciente.get(f.id)?.cuantos ?? 0,
        enObservacion: dxPorPaciente.get(f.id)?.enObservacion ?? false,
      }),
    })),
  });
}
