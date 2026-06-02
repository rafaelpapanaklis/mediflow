import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { validateMagicNumber } from "@/lib/validate-upload";
import {
  DENTAL_LAB_FILES_BUCKET,
  DENTAL_LAB_FILE_ACCEPT,
  DENTAL_LAB_FILE_MAX_MB,
  type DentalLabOrderFileDTO,
} from "@/lib/laboratorios/types";

export const dynamic = "force-dynamic";

const MAX_BYTES = DENTAL_LAB_FILE_MAX_MB * 1024 * 1024;

// TTL de la signed URL persistida. El bucket es PRIVADO (datos clínicos); el
// detalle de pedido (lado lab) renderiza url directo, así que no puede expirar
// a corto plazo. signMaybeUrl() puede re-firmar desde el path embebido si más
// adelante se migra a firmar on-demand con TTL corto.
const FILE_URL_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 año

// Extensiones aceptadas (lowercase) derivadas del contrato. jpeg ≡ jpg.
const ACCEPT_EXT = DENTAL_LAB_FILE_ACCEPT.map((e) => e.toLowerCase()).concat("jpeg");

// PDF/JPG/PNG sí tienen magic number que `file-type` reconoce → validamos que
// el contenido REAL coincida con uno de estos MIME (el MIME del browser miente).
const RASTER_DOC_EXT = ["pdf", "jpg", "jpeg", "png"];
const VERIFIABLE_MIME = ["application/pdf", "image/jpeg", "image/png"];

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// STL/PLY/DCM no los reconoce `file-type`; validamos su firma a mano.
// Devuelve null si OK, o un mensaje de error.
function validateDesignSignature(ext: string, buf: Buffer): string | null {
  if (ext === "dcm") {
    // DICOM Parte-10: preámbulo de 128 bytes + marca "DICM".
    const ok = buf.length >= 132 && buf.toString("latin1", 128, 132) === "DICM";
    return ok ? null : "El archivo no parece un DICOM (.dcm) válido";
  }
  if (ext === "ply") {
    // Todo PLY (ASCII o binario) abre con "ply".
    const ok = buf.toString("latin1", 0, 3).toLowerCase() === "ply";
    return ok ? null : "El archivo no parece un PLY (.ply) válido";
  }
  // STL: ASCII abre con "solid"; binario = 80 bytes de header + uint32 de
  // triángulos + 50 bytes por triángulo.
  const head = buf.toString("latin1", 0, 5).toLowerCase();
  if (head === "solid") {
    // Anti-polyglot: un STL ASCII real es texto. Si los primeros bytes traen
    // un NUL es binario disfrazado de "solid…" → rechazar.
    const probe = buf.subarray(0, Math.min(buf.length, 512));
    if (probe.indexOf(0x00) === -1) return null;
    return "El archivo .stl no parece un STL ASCII válido";
  }
  if (buf.length >= 84) {
    const triangles = buf.readUInt32LE(80);
    if (buf.length === 84 + triangles * 50) return null;
  }
  return "El archivo no parece un STL (.stl) válido";
}

// POST /api/dental-labs/[labId]/ordenes/[orderId]/files
// Sube un archivo de diseño/escaneo a una orden ya creada y registra el
// DentalLabOrderFile. Multipart: campo "file".
//
// SEGURIDAD MULTI-TENANT:
//   - clinicId SIEMPRE de sesión (getAuthContext) — NUNCA del body.
//   - labId + orderId del path; la orden DEBE ser de ese lab y de esa clínica.
export async function POST(
  req: NextRequest,
  { params }: { params: { labId: string; orderId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { labId, orderId } = params;

  // La orden debe existir, pertenecer a ESTE lab y a la clínica en sesión.
  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: orderId, labId, clinicId: ctx.clinicId },
    select: { id: true, labId: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!ext || !ACCEPT_EXT.includes(ext)) {
    return NextResponse.json(
      { error: `Tipo de archivo no permitido. Usa ${DENTAL_LAB_FILE_ACCEPT.join(", ")}.` },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `El archivo supera el máximo de ${DENTAL_LAB_FILE_MAX_MB} MB.` },
      { status: 400 },
    );
  }

  const bytes = await file.arrayBuffer();

  // Validación de contenido real (no confiar en file.type del browser).
  if (RASTER_DOC_EXT.includes(ext)) {
    const magicError = await validateMagicNumber(bytes, VERIFIABLE_MIME);
    if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });
  } else {
    const sigError = validateDesignSignature(ext, Buffer.from(bytes));
    if (sigError) return NextResponse.json({ error: sigError }, { status: 400 });
  }

  // Path multi-tenant en el storage. Nombre con UUID (no enumerable por
  // timestamp/clinicId). El bucket DEBE ser PRIVADO: son archivos clínicos
  // (escaneos, DICOM, radiografías) → nunca URL pública.
  const safeExt = ext === "jpeg" ? "jpg" : ext;
  const path = `${order.labId}/${orderId}/${randomUUID()}.${safeExt}`;

  const supabase = getAdminSupabase();
  const { error: uploadError } = await supabase.storage
    .from(DENTAL_LAB_FILES_BUCKET)
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) {
    console.error("[dental-labs/ordenes/files] upload error:", uploadError);
    return NextResponse.json({ error: "Error al subir el archivo." }, { status: 500 });
  }

  // NO guardamos una public URL: son archivos clínicos (escaneos, DICOM,
  // radiografías) y el bucket DEBE ser PRIVADO. Guardamos una SIGNED URL —
  // el detalle de pedido del lab la renderiza directo (href={file.url}). Si
  // se migra a firmar on-demand, signMaybeUrl() extrae el path embebido.
  let storedUrl = path;
  const { data: signed, error: signError } = await supabase.storage
    .from(DENTAL_LAB_FILES_BUCKET)
    .createSignedUrl(path, FILE_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    // No fatal: el archivo ya se subió. Guardamos el path como fallback
    // (re-firmable luego con signMaybeUrl).
    console.warn("[dental-labs/ordenes/files] signed url (no fatal):", signError);
  } else {
    storedUrl = signed.signedUrl;
  }

  const created = await prisma.dentalLabOrderFile.create({
    data: {
      orderId,
      url: storedUrl,
      name: file.name.slice(0, 200),
      fileType: safeExt.toUpperCase(),
      sizeBytes: file.size,
    },
  });

  const dto: DentalLabOrderFileDTO = {
    id: created.id,
    url: created.url,
    name: created.name,
    fileType: created.fileType,
    sizeBytes: created.sizeBytes,
    uploadedAt: created.uploadedAt.toISOString(),
  };
  return NextResponse.json(dto, { status: 201 });
}
