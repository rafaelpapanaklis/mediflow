// LIMPIEZA de la subida DIRECTA: borra el objeto que quedó en el bucket cuando
// una subida se cancela o falla y por tanto NUNCA se confirmó.
//
// POST /api/patients/[id]/uploads/abort   body: { path }  → { deleted: boolean }
//
// Sin esto, cancelar una subida de 900 MB dejaba el objeto en Storage ocupando
// espacio real y sin ninguna fila que lo contabilizara: espacio fantasma que la
// clínica paga y que ni el sistema ni ella pueden ver.
//
// SEGURIDAD — esta ruta borra bytes, así que se defiende en tres frentes:
//   1. sesión + visibilidad del paciente + paciente de ESTA clínica
//   2. el path debe caer exactamente en la carpeta de esta clínica y paciente
//   3. NO debe existir NINGÚN PatientFile apuntando a ese path (ni siquiera uno
//      borrado lógicamente). Sólo se borran objetos huérfanos: si el archivo ya
//      es parte del expediente, se sale por la puerta de borrado real, que
//      respeta la retención NOM-024. Este endpoint no es un atajo para eso.
//
// Es best-effort por diseño: si el navegador se cierra a media subida nadie lo
// llama. Ese caso queda para un barrido periódico de huérfanos (follow-up
// documentado en ORQUESTA.md).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { removeFileFromStorage } from "@/lib/storage";
import { extOfName, isStudyExt, studyPathPrefix } from "@/lib/uploads/patient-study-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_PATH = /^[a-zA-Z0-9/._-]+$/;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const denied = await assertPatientVisible(params.id, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (denied) return denied;

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const path = String(body?.path ?? "");
  if (!path) return NextResponse.json({ error: "Falta el path" }, { status: 400 });
  if (!SAFE_PATH.test(path) || path.includes("..")) {
    return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  }

  const ext = extOfName(path);
  if (!isStudyExt(ext)) return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  if (!path.startsWith(studyPathPrefix(ctx.clinicId, params.id, ext))) {
    return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  }

  // Sólo huérfanos. Un objeto ya registrado (aunque esté borrado lógicamente)
  // pertenece al expediente y no se toca desde aquí.
  const registered = await prisma.patientFile.findFirst({
    where: { clinicId: ctx.clinicId, patientId: params.id, url: path },
    select: { id: true },
  });
  if (registered) {
    return NextResponse.json(
      { error: "El archivo ya está registrado en el expediente", deleted: false },
      { status: 409 },
    );
  }

  try {
    await removeFileFromStorage(path);
  } catch (e) {
    // Best-effort: que falle la limpieza no debe romperle nada al usuario, que
    // simplemente canceló una subida. Se registra para el barrido de huérfanos.
    console.error("[uploads/abort] no se pudo borrar el objeto huérfano:", path, e);
    return NextResponse.json({ deleted: false });
  }

  return NextResponse.json({ deleted: true });
}
