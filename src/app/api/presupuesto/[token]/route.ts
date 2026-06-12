import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { BUCKETS, signMaybeUrl } from "@/lib/storage";
import { validateMagicNumber } from "@/lib/validate-upload";
import { toPublicView } from "@/lib/quotes/serialize";

export const dynamic = "force-dynamic";

interface Params { params: { token: string } }

function isExpired(validUntil: Date | null, status: string): boolean {
  if (status === "EXPIRED") return true;
  if (!validUntil) return false;
  return new Date().getTime() > new Date(validUntil).getTime();
}

/**
 * GET /api/presupuesto/[token] — vista pública (solo lectura) del presupuesto
 * para que el paciente lo revise antes de aceptar. Sin datos sensibles extra.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const rl = rateLimit(req, 20);
  if (rl) return rl;

  const quote = await prisma.quote.findUnique({
    where: { acceptToken: params.token },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      clinic: { select: { name: true, logoUrl: true } },
      patient: { select: { firstName: true } },
    },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  const expired = isExpired(quote.validUntil, quote.status);

  // Firma estampada (si ya aceptó): signed URL de corta vida para que la vea.
  const signatureUrl = quote.signatureUrl
    ? await signMaybeUrl(quote.signatureUrl, 300, BUCKETS.PATIENT_FILES).catch(() => "")
    : null;

  const view = toPublicView(quote, {
    clinicName: quote.clinic.name,
    clinicLogoUrl: quote.clinic.logoUrl ?? null,
    patientFirstName: quote.patient.firstName,
    signatureUrl: signatureUrl || null,
    expired,
  });

  return NextResponse.json(view);
}

/**
 * POST /api/presupuesto/[token] — el paciente ACEPTA con firma (canvas → PNG).
 * Valida forma, tamaño y magic bytes de la firma. Guarda el PNG en el bucket
 * privado y persiste solo el path (signed URL on-demand al leer).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const rl = rateLimit(req, 5);
  if (rl) return rl;

  const quote = await prisma.quote.findUnique({
    where: { acceptToken: params.token },
    select: { id: true, clinicId: true, status: true, validUntil: true, signatureUrl: true },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  if (quote.status === "ACCEPTED") {
    return NextResponse.json({ error: "Este presupuesto ya fue aceptado" }, { status: 409 });
  }
  if (quote.status === "REJECTED") {
    return NextResponse.json({ error: "Este presupuesto no está disponible" }, { status: 409 });
  }
  if (isExpired(quote.validUntil, quote.status)) {
    // Marca EXPIRED para que el panel lo refleje.
    if (quote.status !== "EXPIRED") {
      await prisma.quote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } }).catch(() => {});
    }
    return NextResponse.json({ error: "El enlace ha expirado" }, { status: 410 });
  }
  if (quote.status !== "PRESENTED") {
    return NextResponse.json({ error: "El presupuesto no está disponible para aceptar" }, { status: 409 });
  }

  let payload: { signatureDataUrl?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  const signatureDataUrl = payload.signatureDataUrl;

  if (typeof signatureDataUrl !== "string" || !signatureDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }
  const signatureBuffer = Buffer.from(signatureDataUrl.split(",")[1] ?? "", "base64");
  const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;
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

  // Sube la firma al bucket privado; persistimos solo el path.
  let storedPath: string | null = null;
  try {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const path = `signatures/${quote.clinicId}/quote-${quote.id}.png`;
    await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .upload(path, signatureBuffer, { contentType: "image/png", upsert: true });
    storedPath = path;
  } catch (e) {
    console.error("Quote signature upload error:", e);
    return NextResponse.json({ error: "No se pudo guardar la firma. Intenta de nuevo." }, { status: 500 });
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "ACCEPTED", acceptedAt: new Date(), signatureUrl: storedPath },
  });

  // NO audit-log aquí: el firmante es el paciente (no autenticado contra users)
  // y AuditLog tiene FK estricta a userId. El evento queda en quote.acceptedAt.

  return NextResponse.json({ success: true });
}
