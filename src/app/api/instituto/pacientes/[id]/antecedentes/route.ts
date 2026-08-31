import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { updateEduPatientAntecedentes } from "@/lib/edu/pacientes";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/pacientes/[id]/antecedentes — los ANTECEDENTES
 * MÉDICOS: alergias, padecimientos crónicos, medicamentos, tipo de sangre
 * y contacto de emergencia.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DOS LLAVES ABREN ESTA PUERTA, y es la decisión de la ola (el patrón
 * es el del WhatsApp de la ficha, que ya abre con dos):
 *
 *   · `pacientes.manage`  → CAJA y dirección. Recepción pregunta las
 *     alergias al registrar al paciente — esperar a que un alumno abra la
 *     historia clínica es dejar la ficha muda justo el primer día.
 *   · `expediente.write`  → ALUMNO, DOCENTE y dirección. La historia
 *     clínica la completa quien tiene al paciente en el sillón.
 *
 * No se inventó una key nueva (`pacientes.antecedentes`) a propósito: una
 * key nueva no llega a nadie con `permissionsOverride` guardado y habría
 * exigido su backfill en SQL. Las dos existentes cubren exactamente a los
 * cuatro roles que el contrato pide, y a nadie más.
 *
 * Y en los dos casos el PACIENTE se busca dentro del alcance de
 * "patients" (updateEduPatientAntecedentes): un alumno captura los de SUS
 * pacientes; el de otro alumno contesta 404, igual que uno que no existe.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 institutionId de getEduContext(), JAMÁS del cuerpo ni del query.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;

  const permUser = { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride };
  const puede =
    hasEduPermission(permUser, "pacientes.manage") ||
    hasEduPermission(permUser, "expediente.write");
  if (!puede) {
    return NextResponse.json(
      {
        error:
          "Capturar antecedentes pide pacientes.manage (recepción) o expediente.write (historia clínica), y tu cuenta no tiene ninguno.",
      },
      { status: 403 },
    );
  }

  try {
    const updated = await updateEduPatientAntecedentes(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, `PATCH /api/instituto/pacientes/${params.id}/antecedentes`);
  }
}
