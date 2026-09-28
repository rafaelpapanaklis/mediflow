"use server";
// Ortodoncia — Alta del caso (ws1-t10, decisión 5 de Rafael): «SÍ, el
// responsable de pago es una persona compartida entre hermanos». Hoy el
// tutor se captura una vez POR HIJO (`getCaseIntakeOptions` solo ofrece los
// Guardian de ESTE paciente), así que dos hermanos nunca comparten
// `responsibleGuardianId` y «Cobrar a los dos» (R5, `ListaMensualidades.tsx`)
// nunca se enciende aunque el código de agrupar ya exista.
//
// Esta acción busca un tutor YA REGISTRADO de OTRO paciente de la misma
// clínica (por nombre o teléfono), para que el alta del segundo hijo pueda
// reusar el MISMO `Guardian.id` en vez de crear uno nuevo. `createTreatmentPlan`
// ya acepta un `responsibleGuardianId` existente sin exigir que pertenezca a
// este paciente — el hueco era solo de búsqueda/UI.
//
// Solo lectura. `clinicId` SIEMPRE de la sesión.

import { prisma } from "@/lib/prisma";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { getOrthoActionContext } from "./_helpers";
import { isFailure, ok, type ActionResult } from "./result";

const MIN_LETRAS = 2;
const MAX_RESULTADOS = 8;

export interface TutorDeLaClinica {
  id: string;
  fullName: string;
  parentesco: string;
  phone: string;
  /** De quién ya es tutor — para que recepción confirme que es el hermano correcto. */
  patientId: string;
  patientName: string;
}

export async function buscarTutoresDeLaClinica(input: unknown): Promise<ActionResult<TutorDeLaClinica[]>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const crudo = typeof input === "string" ? input : (input as { q?: unknown; excludePatientId?: unknown } | null)?.q;
  const q = (typeof crudo === "string" ? crudo : "").trim().slice(0, 80);
  const excludePatientId =
    typeof input === "object" && input !== null && typeof (input as { excludePatientId?: unknown }).excludePatientId === "string"
      ? (input as { excludePatientId: string }).excludePatientId
      : undefined;
  if (q.length < MIN_LETRAS) return ok([]);

  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const tokens = q.split(/\s+/).filter(Boolean).map((t) => t.replace(/\D/g, "").length >= 4 ? t.replace(/\D/g, "") : t);

  const guardianes = await prisma.guardian.findMany({
    where: {
      clinicId: ctx.clinicId,
      deletedAt: null,
      ...(excludePatientId ? { patientId: { not: excludePatientId } } : {}),
      patient: { deletedAt: null },
      // Un paciente restringido no debe delatar a su tutor por aquí.
      AND: [
        ...relatedPatientVisibilityAnd(viewer),
        ...tokens.map((t) => ({
          OR: [
            { fullName: { contains: t, mode: "insensitive" as const } },
            { phone: { contains: t } },
          ],
        })),
      ],
    },
    select: {
      id: true,
      fullName: true,
      parentesco: true,
      phone: true,
      patientId: true,
      patient: { select: { firstName: true, lastName: true } },
    },
    orderBy: { fullName: "asc" },
    take: MAX_RESULTADOS,
  });

  // Un mismo tutor puede tener varias filas (una por hijo, hoy): se muestra
  // cada una — es justo la fila de ESE hermano la que hay que reusar.
  return ok(guardianes.map((g) => ({
    id: g.id,
    fullName: g.fullName,
    parentesco: g.parentesco,
    phone: g.phone,
    patientId: g.patientId,
    patientName: `${g.patient.firstName} ${g.patient.lastName}`.trim(),
  })));
}
