import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/paciente/recetas — recetas de los pacientes vinculados a la
 * cuenta de paciente del portal.
 *
 * TODO(portal-paciente): main todavía NO tiene el helper de sesión de
 * paciente (cookie `patient_session`) — lo está construyendo otra terminal.
 * Cuando exista, implementar así:
 *   1. Leer la cookie `patient_session` y resolver la cuenta con el helper
 *      de sesión de paciente (src/lib/patient-session o equivalente).
 *   2. Obtener los patientId vinculados a esa cuenta.
 *   3. const list = await prisma.prescription.findMany({
 *        where: { patientId: { in: patientIds } },
 *        include: {
 *          doctor: { select: { firstName: true, lastName: true } },
 *          clinic: { select: { name: true } },
 *          items:  { include: { cums: true } },
 *        },
 *        orderBy: { issuedAt: "desc" },
 *      });
 *   4. Devolver SOLO campos necesarios (sin datos de otros pacientes ni
 *      tokens). El aislamiento es por la lista de patientIds de la cuenta —
 *      nunca aceptar patientId por query string aquí.
 *
 * Mientras no exista la sesión de paciente, respondemos 501 para no exponer
 * nada.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "not_implemented",
      detail:
        "La sesión de paciente (cookie patient_session) aún no está disponible en main. " +
        "Este endpoint se activa cuando exista el helper de sesión del portal de pacientes.",
    },
    { status: 501 },
  );
}
