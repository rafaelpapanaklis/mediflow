import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { rateLimit } from "@/lib/rate-limit";
import { BUCKETS, signMaybeUrl } from "@/lib/storage";
import { validateMagicNumber } from "@/lib/validate-upload";

// GET /api/consent/[token] — public, get form content for patient to read
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 20); // 20 requests per minute per IP
  if (rl) return rl;

  const form = await prisma.consentForm.findUnique({
    where:   { token: params.token },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      clinic:  { select: { name: true, phone: true, logoUrl: true } },
    },
  });

  if (!form) return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });
  if (new Date() > form.expiresAt) return NextResponse.json({ error: "El enlace ha expirado" }, { status: 410 });

  // Si ya está firmado, firmamos la URL de la imagen on-demand para que
  // el paciente pueda ver su firma sin depender de un signed URL legacy.
  const signedSignatureUrl = form.signatureUrl
    ? await signMaybeUrl(form.signatureUrl).catch(() => "")
    : null;

  return NextResponse.json({ ...form, signatureUrl: signedSignatureUrl });
}

// POST /api/consent/[token] — patient signs the form
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 5);
  if (rl) return rl;

  const form = await prisma.consentForm.findUnique({ where: { token: params.token } });

  if (!form) return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });
  if (new Date() > form.expiresAt) return NextResponse.json({ error: "El enlace ha expirado" }, { status: 410 });
  if (form.signedAt) return NextResponse.json({ error: "Ya fue firmado" }, { status: 409 });

  const { signatureDataUrl } = await req.json();
  if (!signatureDataUrl) return NextResponse.json({ error: "Firma requerida" }, { status: 400 });

  // La firma llega como data URL (canvas → PNG). Validamos forma, tamaño y, sobre
  // todo, la FIRMA real de los bytes: que sea de verdad una imagen y no un
  // archivo disfrazado (ej. un ejecutable codificado en base64).
  if (typeof signatureDataUrl !== "string" || !signatureDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }
  const signatureBuffer = Buffer.from(signatureDataUrl.split(",")[1] ?? "", "base64");
  const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024; // una firma son unos KB; 5 MB frena abusos.
  if (signatureBuffer.length === 0) {
    return NextResponse.json({ error: "Firma vacía" }, { status: 400 });
  }
  if (signatureBuffer.length > MAX_SIGNATURE_BYTES) {
    return NextResponse.json({ error: "La firma excede el tamaño permitido (máx 5 MB)." }, { status: 413 });
  }
  const magicError = await validateMagicNumber(signatureBuffer, ["image/png", "image/jpeg", "image/webp"]);
  if (magicError) {
    return NextResponse.json(
      { error: "Archivo no válido: el contenido no coincide con la extensión", detalle: magicError },
      { status: 400 },
    );
  }

  // Upload signature to Supabase Storage. Persistimos sólo el path interno;
  // la signed URL se genera on-demand cuando alguien lee el form.
  let storedPath: string | null = null;
  try {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const path   = `signatures/${form.clinicId}/${form.id}.png`;
    await supabase.storage.from(BUCKETS.PATIENT_FILES).upload(path, signatureBuffer, { contentType: "image/png", upsert: true });
    storedPath = path;
  } catch (e) {
    console.error("Signature upload error:", e);
  }

  await prisma.consentForm.update({
    where: { id: form.id },
    data:  { signedAt: new Date(), signatureUrl: storedPath },
  });

  // NO audit-log a tabla audit_logs aquí: el firmante es el paciente
  // (no autenticado contra users) y AuditLog tiene FK estricta a userId.
  // El timestamp de la firma ya queda persistido en consent_forms.signedAt
  // y la creación del form sí está auditada en POST /api/consent.

  return NextResponse.json({ success: true });
}
