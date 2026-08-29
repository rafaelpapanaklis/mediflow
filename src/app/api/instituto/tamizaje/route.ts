import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { runEduTamizaje } from "@/lib/edu/casos";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/tamizaje — LA VALORACIÓN INICIAL.
 *
 * Asigna el paciente a un alumno y abre su caso. Es la puerta de entrada de
 * la clínica de la escuela, y por eso exige "casos.assign" (dirección y
 * docentes): decidir quién trata a quién es la decisión académica de esta
 * ola, no un trámite de recepción.
 *
 * Se puede llegar desde una cita de tamizaje (lo normal: el paciente ya
 * está sentado) o directamente desde un paciente registrado, porque la
 * valoración a veces ocurre en el pasillo y obligar a agendarla primero
 * haría que nadie la registrara.
 *
 * 🔴 Cuando viene una cita, el paciente sale de LA CITA y no del body: si
 * se aceptaran los dos y no coincidieran, se abriría el caso de una persona
 * con la valoración de otra.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("casos.assign");
  if ("response" in g) return g.response;

  try {
    const res = await runEduTamizaje(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: res.id, patientId: res.patientId }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/tamizaje");
  }
}
