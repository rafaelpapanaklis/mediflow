// PASO 1 de la subida DIRECTA de estudios pesados (hasta 2 GB).
//
// POST /api/patients/[id]/uploads/sign   body: { name, size, contentType? }
//   → { path, token, signedUrl, contentType, maxBytes }
//
// El navegador NO manda el binario aquí: pide permiso, sube directo al bucket
// con la signed upload URL (paso 2) y luego llama a /confirm (paso 3). El techo
// de ~4.5 MB del cuerpo de la petición en Vercel nunca entra en juego.
//
// QUÉ SE VALIDA AQUÍ (todo en el servidor, nada se cree del cliente):
//   · sesión + visibilidad del paciente (Ola 3) + paciente de ESTA clínica
//   · extensión dentro de la whitelist
//   · tamaño DECLARADO <= 2 GB
//   · cuota del plan contando ese tamaño declarado
//   · el PATH lo compone el servidor con el clinicId de la sesión
//
// QUÉ **NO** SE PUEDE VALIDAR AQUÍ: la firma real del contenido (magic number),
// porque los bytes nunca pasan por el servidor. Para archivos chicos esa
// validación sí se hace, pero en /confirm (que se descarga el objeto ya subido).
// Ver el comentario de MAX_SERVER_INSPECT_BYTES.
//
// El tamaño declarado es una PISTA, no una garantía: un cliente puede mentir.
// Por eso /confirm vuelve a medir el objeto real en Storage y re-evalúa la
// cuota antes de crear la fila. Aquí se valida igual para no dejar que alguien
// empiece a subir 2 GB que de todas formas se van a rechazar.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS } from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";
import {
  MAX_STUDY_UPLOAD_BYTES,
  MAX_STUDY_UPLOAD_LABEL,
  STUDY_UPLOAD_EXT,
  extOfName,
  isStudyExt,
  mimeForStudyExt,
  safeStudyFileName,
  studyStoragePath,
} from "@/lib/uploads/patient-study-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Visibilidad por paciente (Ola 3): 404 si el viewer no puede ver este paciente.
  const denied = await assertPatientVisible(params.id, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (denied) return denied;

  // Multi-tenant: el paciente debe ser de la clínica de la sesión.
  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const rawName = String(body?.name ?? "").trim();
  const declaredSize = Number(body?.size);

  if (!rawName) return NextResponse.json({ error: "Falta el nombre del archivo" }, { status: 400 });

  const ext = extOfName(rawName);
  if (!isStudyExt(ext)) {
    return NextResponse.json(
      {
        error: `Formato no permitido. Se aceptan: ${STUDY_UPLOAD_EXT.map((e) => `.${e}`).join(", ")}.`,
      },
      { status: 400 },
    );
  }

  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return NextResponse.json({ error: "Falta el tamaño del archivo" }, { status: 400 });
  }
  if (declaredSize > MAX_STUDY_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Archivo demasiado grande (máx ${MAX_STUDY_UPLOAD_LABEL}).`, code: "FILE_TOO_LARGE" },
      { status: 413 },
    );
  }

  // Cuota del plan contando el tamaño declarado: corta ANTES de que la clínica
  // gaste media hora subiendo algo que no cabe. FAIL-OPEN ante un error de la
  // consulta (no bloqueamos una subida legítima por un fallo de infra): el
  // cobro definitivo, con el tamaño REAL medido en Storage, lo hace /confirm.
  try {
    const quotaErr = await storageQuotaError(ctx.clinicId, declaredSize);
    if (quotaErr) return quotaErr;
  } catch (e) {
    console.error("[uploads/sign] no se pudo evaluar la cuota, se deja pasar:", e);
  }

  const safeName = safeStudyFileName(rawName, ext);
  // El path SIEMPRE lo compone el servidor con el clinicId de la sesión.
  const path = studyStoragePath(ctx.clinicId, params.id, ext, randomUUID(), safeName);
  const contentType = mimeForStudyExt(ext, String(body?.contentType ?? ""));

  const supabase = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // upsert: true — es la ÚNICA forma de que un reintento sobre el mismo path
  // funcione. El header `x-upsert` del PUT lo ignora Storage en las signed
  // upload URLs: la opción se fija al firmar. Sin esto, un corte de red a mitad
  // de una subida de 2 GB dejaba el path quemado y el reintento moría con 409.
  // No hay riesgo de pisar nada ajeno: el path lleva un UUID recién generado.
  const { data, error } = await supabase.storage
    .from(BUCKETS.PATIENT_FILES)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    console.error("[uploads/sign] createSignedUploadUrl:", error);
    return NextResponse.json(
      { error: "No se pudo preparar la subida. Intenta de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path,
    token: data.token,
    signedUrl: data.signedUrl,
    contentType,
    maxBytes: MAX_STUDY_UPLOAD_BYTES,
  });
}
