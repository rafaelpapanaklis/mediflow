// Ortodoncia — lector de base de «quién puede ser doctor tratante» (ws1-t5,
// ronda 6). La regla vive en `doctores-tratantes.ts` (pura, con test); aquí
// solo está la consulta. `clinicId` SIEMPRE de la sesión.

import { prisma } from "@/lib/prisma";
import {
  ROLES_QUE_ATIENDEN,
  atiendePacientes,
  opcionesDeDoctorTratante,
  type DoctorTratanteOpcion,
} from "./doctores-tratantes";

const SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
  specialty: true,
  especialidad: true,
  agendaActive: true,
  isActive: true,
  permissionsOverride: true,
} as const;

/** Los doctores que se pueden elegir como tratantes en esta clínica. */
export async function cargarDoctoresTratantes(clinicId: string): Promise<DoctorTratanteOpcion[]> {
  if (!clinicId) return [];
  const usuarios = await prisma.user.findMany({
    where: { clinicId, isActive: true, role: { in: [...ROLES_QUE_ATIENDEN] } },
    select: SELECT,
  });
  return opcionesDeDoctorTratante(usuarios);
}

/**
 * ¿Este usuario puede quedar como doctor tratante en ESTA clínica? Lo usan las
 * acciones que guardan un `treatingDoctorId` o el doctor por defecto: el
 * identificador llega del navegador y no se da por bueno.
 */
export async function esDoctorTratanteDeLaClinica(clinicId: string, userId: string): Promise<boolean> {
  if (!clinicId || !userId) return false;
  const usuario = await prisma.user.findFirst({
    where: { id: userId, clinicId, isActive: true, role: { in: [...ROLES_QUE_ATIENDEN] } },
    select: SELECT,
  });
  return usuario ? atiendePacientes(usuario) : false;
}

/**
 * ¿Existe `orthodontic_treatment_plans.treatingDoctorId` en esta base? Sin ella
 * (sql/ortodoncia-nucleo.sql sin pegar) el alta no puede exigir doctor: no hay
 * dónde guardarlo. Es lo mismo que `columnsExist.treatingDoctorId` del alta;
 * si no se puede comprobar, se trata como ausente (el alta no se bloquea).
 */
export async function existeColumnaDoctorTratante(): Promise<boolean> {
  try {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orthodontic_treatment_plans' AND column_name = 'treatingDoctorId'
    `;
    return cols.length > 0;
  } catch (e) {
    console.error("[ortho] no se pudo comprobar la columna treatingDoctorId:", e);
    return false;
  }
}
