import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduStudyNotes } from "@/lib/edu/estudios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/estudios/[id]/notas — las notas del estudio.
 *
 * La escribe el visor del dental, que manda `{ doctorNotes }`; se guarda en
 * `EduStudy.notes`, la MISMA columna que rellena el formulario de subida y
 * que lee la línea de tiempo del expediente. Un solo sitio: dos columnas de
 * notas serían dos verdades y la ficha enseñaría la vieja.
 *
 * Es la GEMELA de PATCH /api/patients/[id]/models-3d/[fileId] del dental,
 * que resuelve contra `PatientFile` con la sesión del dental.
 *
 * 🔴 PERMISO: `estudios.upload`, no `estudios.view`. Es el permiso de
 * ESCRITURA que ya tiene esta pantalla — es el que hoy deja poner notas al
 * subir el estudio. Con solo `estudios.view` se mira el expediente y no se
 * escribe en él.
 *
 * 🔴 TENANT: el estudio se resuelve con el institutionId de la SESIÓN y el
 * alcance clínico del rol. Uno de otra escuela es 404, igual que uno
 * inventado.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    // `doctorNotes` es el nombre que manda el visor del dental; `notes` se
    // acepta igual para que la ruta se pueda llamar desde el vertical sin
    // heredar el vocabulario del otro producto.
    const raw = body.doctorNotes !== undefined ? body.doctorNotes : body.notes;
    const out = await updateEduStudyNotes(g.ctx, params.id, raw);
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/estudios/[id]/notas");
  }
}
