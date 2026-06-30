// POST /api/patients/[id]/dicom-set/[fileId]/lite
// Genera (o devuelve si ya existe) el CBCT "lite": una versión reducida del estudio
// que un MÓVIL sí puede cargar. El estudio original (300-600 MB) no cabe en la RAM
// de un iPhone; aquí el SERVIDOR lo descomprime+decodifica+reduce UNA vez y guarda
// un binario hermano `<path>.lite.bin` (~10-25 MB). Bajo demanda + cacheado en
// storage: la primera apertura en móvil lo genera; las siguientes lo reusan.
//
// Patrón análogo al GLB web de models-3d. Multi-tenant: clinicId SIEMPRE de la
// sesión; el PatientFile debe pertenecer a (clínica, paciente) o 404.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { BUCKETS, extractStoragePath, SIGNED_URL_TTL_SECONDS } from "@/lib/storage";
import { CBCT_LITE_SUFFIX, CBCT_LITE_HI_SUFFIX, CBCT_LITE_CONTENT_TYPE } from "@/components/patient-3d/cbct-lite-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Descomprimir + decodificar + reducir un CBCT grande puede tardar; damos margen.
export const maxDuration = 300;

function getAdminSupabase() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// ¿Existe ya el objeto en el bucket? `list` con search filtra por nombre dentro de
// la carpeta; comprobamos coincidencia exacta. Más fiable que asumir que
// createSignedUrl falla para inexistentes.
async function objectExists(
  supabase: ReturnType<typeof getAdminSupabase>,
  path: string,
): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const fname = slash >= 0 ? path.slice(slash + 1) : path;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .list(folder, { search: fname, limit: 100 });
    if (error || !data) return false;
    return data.some((o) => o.name === fname);
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; fileId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

  // Multi-tenant: el archivo debe ser de esta clínica y este paciente.
  const file = await prisma.patientFile.findFirst({
    where: { id: params.fileId, patientId: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, name: true, url: true },
  });
  if (!file) return NextResponse.json({ error: "Estudio no encontrado" }, { status: 404 });

  // Solo sets CBCT (.zip). Las mallas/DICOM sueltos no aplican.
  if (!/\.zip$/i.test(file.name)) {
    return NextResponse.json({ error: "El archivo no es un set CBCT (.zip)" }, { status: 400 });
  }

  const zipPath = extractStoragePath(file.url);
  if (!zipPath) return NextResponse.json({ error: "Ruta de estudio inválida" }, { status: 400 });
  // ?res=hi → variante de alta resolución (384²). Default = lite normal (256²).
  const hi = req.nextUrl.searchParams.get("res") === "hi";
  const litePath = `${zipPath}${hi ? CBCT_LITE_HI_SUFFIX : CBCT_LITE_SUFFIX}`;

  const supabase = getAdminSupabase();
  const force = req.nextUrl.searchParams.get("force") === "1";

  // 1) ¿Ya está generado? Devuelve su signed URL sin reprocesar.
  if (!force && (await objectExists(supabase, litePath))) {
    const { data, error } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .createSignedUrl(litePath, SIGNED_URL_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      return NextResponse.json({ liteUrl: data.signedUrl, cached: true });
    }
    // Si la firma falla pese a existir, seguimos a regenerar (defensivo).
  }

  // 2) Descarga el .zip original desde storage (al servidor, con sus ~3 GB / 300 s).
  const dl = await supabase.storage.from(BUCKETS.PATIENT_FILES).download(zipPath);
  if (dl.error || !dl.data) {
    console.error("[cbct-lite] download error:", dl.error);
    return NextResponse.json({ error: "No se pudo leer el estudio original" }, { status: 500 });
  }

  // 3) Genera el lite (descomprime + decodifica + reduce). Import dinámico para no
  //    cargar JSZip/decode en bundles que no lo usan.
  let bytes: Uint8Array;
  let info: { count: number; rows: number; cols: number; sourceSlices: number };
  try {
    const { buildCbctLite } = await import("@/lib/cbct-lite");
    const result = await buildCbctLite(dl.data, hi ? 384 : 256, 180);
    bytes = result.bytes;
    info = {
      count: result.meta.count,
      rows: result.meta.rows,
      cols: result.meta.cols,
      sourceSlices: result.sourceSlices,
    };
  } catch (e) {
    const detail = (e as Error)?.message ?? String(e);
    console.error("[cbct-lite] build error:", detail, (e as Error)?.stack);
    return NextResponse.json(
      { error: "No se pudo generar la versión ligera del estudio", detail },
      { status: 500 },
    );
  }

  // 4) Sube el binario lite hermano (upsert: regenera si se forzó).
  const up = await supabase.storage
    .from(BUCKETS.PATIENT_FILES)
    .upload(litePath, bytes, { contentType: CBCT_LITE_CONTENT_TYPE, upsert: true });
  if (up.error) {
    console.error("[cbct-lite] upload error:", up.error);
    return NextResponse.json({ error: "No se pudo guardar la versión ligera" }, { status: 500 });
  }

  const signed = await supabase.storage
    .from(BUCKETS.PATIENT_FILES)
    .createSignedUrl(litePath, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ error: "No se pudo firmar la versión ligera" }, { status: 500 });
  }

  return NextResponse.json({ liteUrl: signed.data.signedUrl, cached: false, ...info });
}
