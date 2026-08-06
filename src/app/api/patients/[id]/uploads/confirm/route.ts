// PASO 3 de la subida DIRECTA de estudios pesados.
//
// POST /api/patients/[id]/uploads/confirm   body: { path, name }
//   → el PatientFile creado (con signed URL fresca) + estado de procesamiento
//
// El objeto YA está en el bucket (lo subió el navegador con la signed upload URL
// del paso 1). Aquí el servidor decide si esa subida se convierte en un registro
// del expediente — y NO se cree NADA de lo que diga el cliente:
//
//   · el `path` debe caer exactamente en la carpeta de ESTA clínica y paciente
//   · el tamaño se le pregunta a STORAGE (getStorageObjectSize), nunca al cliente:
//     validar cuota con un número que el cliente controla es regalar el límite
//     del plan justo en los archivos más pesados del sistema
//   · con ese tamaño real se re-evalúa la cuota; si no cabe, el objeto se BORRA
//     (si no, quedaría ocupando espacio sin fila que lo contabilice)
//
// PROCESAMIENTO (ver MAX_SERVER_INSPECT_BYTES): hasta 60 MB el servidor se
// descarga el objeto —descarga servidor→servidor, sin el techo de 4.5 MB del
// cuerpo de la petición— para validar la firma real del contenido y convertir
// mallas a GLB web. Por encima de eso el archivo se guarda TAL CUAL: meter 2 GB
// en la memoria de una función serverless la mata. La UI lo dice explícitamente
// en la tarjeta; no hay spinner infinito esperando una conversión que no llega.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { createClient as createAdmin } from "@supabase/supabase-js";
import {
  BUCKETS,
  getStorageObjectSize,
  removeFileFromStorage,
  signMaybeUrl,
} from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";
import { validateCbctZip, validateModel3D } from "@/lib/validate-upload";
import {
  MAX_SERVER_INSPECT_BYTES,
  extOfName,
  isCbctZipExt,
  isMeshExt,
  isStudyExt,
  mimeForStudyExt,
  studyPathPrefix,
} from "@/lib/uploads/patient-study-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Inspeccionar + convertir una malla a GLB tarda; mismo margen que el POST viejo.
export const maxDuration = 300;

// El GLB web vive JUNTO al original (mismo folder por clinicId): path + sufijo.
// Debe coincidir con lo que lee GET /api/patients/[id]/models-3d.
const WEB_GLB_SUFFIX = ".web.glb";
const GLB_CONTENT_TYPE = "model/gltf-binary";

// Sólo caracteres que produce studyStoragePath(). Cierra ../ y cualquier intento
// de escaparse de la carpeta aunque el prefijo coincida.
const SAFE_PATH = /^[a-zA-Z0-9/._-]+$/;

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Tamaño real del objeto, con un par de reintentos cortos: justo después de un
 * PUT grande la fila de storage.objects puede tardar un instante en listarse.
 */
async function sizeWithRetry(path: string): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const size = await getStorageObjectSize(path);
    if (size != null) return size;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Visibilidad por paciente (Ola 3).
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

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const path = String(body?.path ?? "");
  const originalName = String(body?.name ?? "").trim().slice(0, 120) || "estudio";

  if (!path) return NextResponse.json({ error: "Falta el path" }, { status: 400 });
  if (!SAFE_PATH.test(path) || path.includes("..")) {
    return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  }

  // La extensión sale del PATH (que lo generó el servidor al firmar), no del
  // nombre que manda el cliente: así el tipo y la carpeta no se pueden divorciar.
  const ext = extOfName(path);
  if (!isStudyExt(ext)) return NextResponse.json({ error: "Path inválido" }, { status: 400 });

  // El path debe caer EXACTAMENTE en la carpeta de esta clínica + paciente + tipo.
  // Sin esto, conociendo un path ajeno se podría registrar el archivo de otra
  // clínica dentro del expediente propio.
  if (!path.startsWith(studyPathPrefix(ctx.clinicId, params.id, ext))) {
    return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  }

  // Idempotencia: si /confirm se repite (reintento del cliente, doble clic), se
  // devuelve la fila que ya existe en vez de duplicar el estudio.
  const existing = await prisma.patientFile.findFirst({
    where: { patientId: params.id, clinicId: ctx.clinicId, url: path, deletedAt: null },
    select: { id: true, name: true, url: true, size: true, mimeType: true, createdAt: true },
  });
  if (existing) {
    const signedUrl = await signMaybeUrl(existing.url).catch(() => "");
    return NextResponse.json({ ...existing, url: signedUrl, webUrl: "", alreadyRegistered: true });
  }

  // ---------------------------------------------------------------------------
  // Tamaño REAL, medido en Storage. Nunca el que dice el cliente.
  // ---------------------------------------------------------------------------
  const realSize = await sizeWithRetry(path);
  if (realSize == null) {
    // No se borra el objeto: puede ser una subida legítima de 2 GB y un fallo
    // transitorio al listar. El cliente puede reintentar /confirm con el mismo
    // path. Si nunca lo hace, queda huérfano → lo limpia /uploads/abort o el
    // barrido de huérfanos (documentado como follow-up).
    console.warn("[uploads/confirm] sin tamaño real del objeto; no se registra", { path });
    return NextResponse.json(
      {
        error: "No pudimos verificar el archivo subido. Vuelve a intentarlo.",
        code: "SIZE_UNVERIFIED",
      },
      { status: 409 },
    );
  }

  const supabase = getAdminSupabase();

  // Cuota del plan con el tamaño REAL. Si no cabe, el objeto se borra: ya está
  // en el bucket y sin fila que lo contabilice sería espacio fantasma.
  let quotaErr: Awaited<ReturnType<typeof storageQuotaError>> = null;
  try {
    quotaErr = await storageQuotaError(ctx.clinicId, realSize);
  } catch (e) {
    console.error("[uploads/confirm] no se pudo evaluar la cuota, se deja pasar:", e);
  }
  if (quotaErr) {
    await removeFileFromStorage(path).catch((e) =>
      console.error("[uploads/confirm] no se pudo borrar el objeto sobre cuota:", e),
    );
    return quotaErr;
  }

  // ---------------------------------------------------------------------------
  // Inspección + conversión: sólo si el archivo es lo bastante chico.
  // ---------------------------------------------------------------------------
  const inspected = realSize <= MAX_SERVER_INSPECT_BYTES;
  let bytes: ArrayBuffer | null = null;

  if (inspected) {
    const dl = await supabase.storage.from(BUCKETS.PATIENT_FILES).download(path);
    if (dl.error || !dl.data) {
      // No se pudo leer para validar. Se deja pasar (el objeto está subido y la
      // cuota ya se cobró con el tamaño real); sólo se pierde la validación de
      // contenido, igual que en los archivos grandes.
      console.warn("[uploads/confirm] no se pudo descargar para validar:", dl.error);
    } else {
      bytes = await dl.data.arrayBuffer();
    }
  }

  if (bytes) {
    // Firma real del contenido: frena un ejecutable/imagen renombrado a .stl o
    // .dcm. Es la MISMA validación que hacía el POST multipart viejo. Para el
    // .zip se usa el validador tolerante (firma PK + veto de ejecutables): el
    // camino viejo de CBCT no validaba nada, y aquí un rechazo BORRA el archivo
    // — inventar rechazos nuevos sobre sets legítimos sería peor que el hueco.
    const magicError = isCbctZipExt(ext)
      ? validateCbctZip(bytes)
      : await validateModel3D(bytes, ext);
    if (magicError) {
      await removeFileFromStorage(path).catch((e) =>
        console.error("[uploads/confirm] no se pudo borrar el objeto inválido:", e),
      );
      return NextResponse.json(
        {
          error: "Archivo no válido: el contenido no coincide con la extensión",
          detalle: magicError,
        },
        { status: 400 },
      );
    }
  }

  const contentType = mimeForStudyExt(ext);

  // Se guarda SOLO el path interno; la signed URL se firma bajo demanda.
  const record = await prisma.patientFile.create({
    data: {
      patientId: params.id,
      clinicId: ctx.clinicId,
      uploadedBy: ctx.userId,
      name: originalName,
      url: path,
      size: realSize,
      mimeType: contentType,
      category: "SCAN_STL" as any,
    },
    select: { id: true, name: true, url: true, size: true, mimeType: true, createdAt: true },
  });

  // GLB web-optimizado hermano (best-effort) para que el visor cargue rápido. Si
  // falla, la respuesta sigue OK con webUrl vacío y el visor usa el original.
  let webUrl = "";
  if (bytes && isMeshExt(ext)) {
    try {
      const { convertMeshToWebGlb } = await import("@/lib/mesh-to-glb");
      const glb = await convertMeshToWebGlb(bytes, ext as "stl" | "ply" | "obj");
      const webPath = `${path}${WEB_GLB_SUFFIX}`;
      const { error: webErr } = await supabase.storage
        .from(BUCKETS.PATIENT_FILES)
        .upload(webPath, glb, { contentType: GLB_CONTENT_TYPE, upsert: true });
      if (webErr) console.error("[uploads/confirm] web GLB upload error:", webErr);
      else webUrl = await signMaybeUrl(webPath).catch(() => "");
    } catch (e) {
      console.error("[uploads/confirm] mesh→GLB conversion skipped:", (e as Error)?.message ?? e);
    }
  }

  const signedUrl = await signMaybeUrl(record.url).catch(() => "");
  return NextResponse.json(
    {
      ...record,
      url: signedUrl,
      webUrl,
      // Le dice a la UI si este archivo pasó por el procesamiento automático.
      // `false` NO es un error: es un estudio grande guardado tal cual.
      inspected,
    },
    { status: 201 },
  );
}
