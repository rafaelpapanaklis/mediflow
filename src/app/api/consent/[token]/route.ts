import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { rateLimit } from "@/lib/rate-limit";
import { BUCKETS, signMaybeUrl } from "@/lib/storage";

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

  // Upload signature to Supabase Storage. Persistimos sólo el path interno;
  // la signed URL se genera on-demand cuando alguien lee el form.
  let storedPath: string | null = null;
  try {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const base64 = signatureDataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");
    const path   = `signatures/${form.clinicId}/${form.id}.png`;
    await supabase.storage.from(BUCKETS.PATIENT_FILES).upload(path, buffer, { contentType: "image/png", upsert: true });
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
