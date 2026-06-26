import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import {
  BUCKETS,
  signMaybeUrl,
  signMaybeUrls,
  extractStoragePath,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/storage";
import { validateModel3D } from "@/lib/validate-upload";
import { CBCT_LITE_SUFFIX } from "@/components/patient-3d/cbct-lite-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Subir + convertir una malla a GLB puede tardar; damos margen (Vercel Pro).
export const maxDuration = 300;

// Mallas (stl/ply/obj) + tomografías DICOM (dcm/dicom). DICOM no se renderiza
// como malla todavía: se almacena, valida y permite descargar.
const ALLOWED_EXT = ["stl", "ply", "obj", "dcm", "dicom"] as const;
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

// Mallas hasta este tamaño se convierten a GLB web DENTRO del request. Por
// encima se sube solo el original (la conversión quedaría para un job aparte)
// para no agotar memoria/tiempo de la función. La subida del original NUNCA se
// bloquea por la conversión.
const MAX_CONVERT_SIZE = 60 * 1024 * 1024; // 60 MB
// El GLB web vive JUNTO al original (mismo folder por clinicId): path + sufijo.
const WEB_GLB_SUFFIX = ".web.glb";
const GLB_CONTENT_TYPE = "model/gltf-binary";

function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

function mimeForExt(ext: string, fallback: string): string {
  switch (ext) {
    case "stl":
      return "model/stl";
    case "obj":
      return "model/obj";
    case "dcm":
    case "dicom":
      return "application/dicom";
    case "ply":
    default:
      return fallback || "application/octet-stream";
  }
}

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// Solo estas mallas se convierten a GLB web. DICOM (.dcm/.dicom) NO se toca.
function isMeshExt(ext: string): boolean {
  const e = ext.toLowerCase();
  return e === "stl" || e === "ply" || e === "obj";
}

// Firma en UN batch las URLs del GLB web hermano (mismo path + sufijo) de cada
// malla. Devuelve "" donde no aplica (DICOM/legacy) o el objeto no existe
// (subida vieja / conversión fallida). Silencioso: no lanza ni ensucia logs.
async function signWebGlbUrls(
  urls: Array<string | null | undefined>,
  names: Array<string | null | undefined>,
): Promise<string[]> {
  const result: string[] = new Array(urls.length).fill("");
  const idxs: number[] = [];
  const paths: string[] = [];
  urls.forEach((u, i) => {
    if (!isMeshExt(extOf(names[i] || u || ""))) return;
    const p = extractStoragePath(u);
    if (!p) return;
    idxs.push(i);
    paths.push(`${p}${WEB_GLB_SUFFIX}`);
  });
  if (paths.length === 0) return result;
  try {
    const { data, error } = await getAdminSupabase()
      .storage.from(BUCKETS.PATIENT_FILES)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return result;
    data.forEach((row, k) => {
      if (!row.error && row.signedUrl) result[idxs[k]] = row.signedUrl;
    });
  } catch {
    // best-effort: si la firma batch falla, todas quedan "".
  }
  return result;
}

// Firma en UN batch el CBCT lite hermano (`<path>.lite.bin`) de cada set CBCT
// (.zip). Es el volumen reducido que carga el MÓVIL. Devuelve "" donde no aplica
// (no es .zip) o el lite aún no se generó → el visor móvil lo pide bajo demanda.
async function signCbctLiteUrls(
  urls: Array<string | null | undefined>,
  names: Array<string | null | undefined>,
): Promise<string[]> {
  const result: string[] = new Array(urls.length).fill("");
  const idxs: number[] = [];
  const paths: string[] = [];
  urls.forEach((u, i) => {
    if (!/\.zip$/i.test(names[i] || u || "")) return; // solo sets CBCT
    const p = extractStoragePath(u);
    if (!p) return;
    idxs.push(i);
    paths.push(`${p}${CBCT_LITE_SUFFIX}`);
  });
  if (paths.length === 0) return result;
  try {
    const { data, error } = await getAdminSupabase()
      .storage.from(BUCKETS.PATIENT_FILES)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return result;
    data.forEach((row, k) => {
      if (!row.error && row.signedUrl) result[idxs[k]] = row.signedUrl;
    });
  } catch {
    // best-effort: si la firma batch falla, todas quedan "".
  }
  return result;
}

// GET /api/patients/[id]/models-3d — lista los modelos 3D del paciente con
// signed URL fresca por archivo. Multi-tenant: clinicId SIEMPRE de la sesión.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const files = await prisma.patientFile.findMany({
    where: {
      patientId: params.id,
      clinicId: ctx.clinicId,
      deletedAt: null, // NOM-024 §7 — oculta modelos 3D borrados lógicamente
      OR: [
        { category: "SCAN_STL" as any },
        { name: { endsWith: ".stl" } },
        { name: { endsWith: ".ply" } },
        { name: { endsWith: ".obj" } },
        { name: { endsWith: ".dcm" } },
        { name: { endsWith: ".dicom" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      url: true,
      size: true,
      mimeType: true,
      createdAt: true,
      doctorNotes: true,
      annotations: true,
    },
  });

  // Firma todas las URLs en UN round-trip (createSignedUrls) en vez de N×.
  const urls = await signMaybeUrls(files.map((f) => f.url));
  // webUrl: GLB web-optimizado hermano (carga rápida en el visor). Vacío para
  // DICOM/legacy/sin convertir → el visor cae al original (`url`).
  const webUrls = await signWebGlbUrls(
    files.map((f) => f.url),
    files.map((f) => f.name),
  );
  // liteUrl: CBCT reducido hermano (`.lite.bin`) para MÓVIL. Vacío si aún no existe
  // → el visor móvil lo genera bajo demanda (POST .../dicom-set/[fileId]/lite).
  const liteUrls = await signCbctLiteUrls(
    files.map((f) => f.url),
    files.map((f) => f.name),
  );
  const signed = files.map((f, i) => ({
    ...f,
    url: urls[i],
    webUrl: webUrls[i],
    liteUrl: liteUrls[i],
  }));
  return NextResponse.json(signed);
}

// POST /api/patients/[id]/models-3d — sube un modelo 3D (STL/PLY/OBJ) o una
// tomografía DICOM (.dcm/.dicom) tal cual (sin sharp). Valida extensión y
// tamaño. Crea un PatientFile con category SCAN_STL. Para mallas, además genera
// best-effort un GLB web-optimizado hermano (Meshopt + decimación) para el visor.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  const originalName = ((file as File).name || "modelo").trim();
  const ext = extOf(originalName);
  if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
    return NextResponse.json(
      { error: "Formato no permitido. Solo STL, PLY, OBJ o DICOM (.dcm)." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Archivo demasiado grande (máx 100 MB)." }, { status: 413 });
  }

  // Nombre seguro para el path del bucket (conserva la extensión real).
  const safeName =
    originalName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(-80) ||
    `modelo.${ext}`;
  const path = `${ctx.clinicId}/models-3d/${params.id}/${randomUUID()}-${safeName}`;
  const contentType = mimeForExt(ext, (file as File).type);

  const bytes = await file.arrayBuffer();

  // Blindaje: valida la FIRMA real del contenido, no solo la extensión. Frena
  // un ejecutable/imagen/zip renombrado a .stl/.obj/.dcm. STL/PLY/OBJ no tienen
  // firma estándar, así que el helper solo rechaza lo que positivamente NO es
  // una malla (no rompe modelos legítimos).
  const magicError = await validateModel3D(bytes, ext);
  if (magicError) {
    return NextResponse.json(
      { error: "Archivo no válido: el contenido no coincide con la extensión", detalle: magicError },
      { status: 400 },
    );
  }

  const supabase = getAdminSupabase();
  const { error: uploadError } = await supabase.storage
    .from(BUCKETS.PATIENT_FILES)
    .upload(path, bytes, { contentType, upsert: false });
  if (uploadError) {
    console.error("[models-3d] storage upload error:", uploadError);
    return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
  }

  // Persistimos SOLO el path interno; la signed URL se genera bajo demanda.
  const record = await prisma.patientFile.create({
    data: {
      patientId: params.id,
      clinicId: ctx.clinicId,
      uploadedBy: ctx.userId,
      name: originalName,
      url: path,
      size: file.size,
      mimeType: contentType,
      category: "SCAN_STL" as any,
    },
    select: { id: true, name: true, url: true, size: true, mimeType: true, createdAt: true },
  });

  // Best-effort: genera y sube un GLB web-optimizado HERMANO (mismo folder por
  // clinicId) para que el visor cargue rápido. El original se conserva intacto.
  // Si la conversión o su subida fallan, la respuesta sigue OK (webUrl = "").
  let webUrl = "";
  if (isMeshExt(ext) && file.size <= MAX_CONVERT_SIZE) {
    try {
      const { convertMeshToWebGlb } = await import("@/lib/mesh-to-glb");
      const glb = await convertMeshToWebGlb(bytes, ext as "stl" | "ply" | "obj");
      const webPath = `${path}${WEB_GLB_SUFFIX}`;
      const { error: webErr } = await supabase.storage
        .from(BUCKETS.PATIENT_FILES)
        .upload(webPath, glb, { contentType: GLB_CONTENT_TYPE, upsert: true });
      if (webErr) {
        console.error("[models-3d] web GLB upload error:", webErr);
      } else {
        webUrl = await signMaybeUrl(webPath).catch(() => "");
      }
    } catch (e) {
      console.error("[models-3d] mesh→GLB conversion skipped:", (e as Error)?.message ?? e);
    }
  }

  const signedUrl = await signMaybeUrl(record.url).catch(() => "");
  return NextResponse.json({ ...record, url: signedUrl, webUrl }, { status: 201 });
}
