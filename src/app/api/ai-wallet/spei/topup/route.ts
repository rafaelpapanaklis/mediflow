import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { fileTypeFromBuffer } from "file-type";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { BUCKETS } from "@/lib/storage";
import { SPEI_ACCOUNT } from "@/lib/spei/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Topes en centavos MXN: piso anti-recargas triviales, techo anti-typo.
const MIN_TOPUP_CENTS = 5_000; // $50 MXN
const MAX_TOPUP_CENTS = 50_000_000; // $500,000 MXN
const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_PROOF_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

// Cliente service-role (bypassa RLS) para escribir en el bucket privado. Mismo
// patron inline que usan xrays / dental-labs (no hay factory compartida).
function adminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * POST /api/ai-wallet/spei/topup
 * La clinica registra una recarga por transferencia SPEI: envia el monto y el
 * comprobante (imagen JPG/PNG o PDF). Se crea un AiTopup PENDING (method SPEI)
 * con el comprobante en el bucket privado; un admin lo confirma despues para
 * acreditar el saldo. Multipart form-data: { amountCents: string, file: File }.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Solicitud invalida" }, { status: 400 });
  }

  const amountCents = Number.parseInt(String(form.get("amountCents") ?? ""), 10);
  if (
    !Number.isInteger(amountCents) ||
    amountCents < MIN_TOPUP_CENTS ||
    amountCents > MAX_TOPUP_CENTS
  ) {
    return NextResponse.json(
      {
        error: `Monto invalido. Debe estar entre $${MIN_TOPUP_CENTS / 100} y $${
          MAX_TOPUP_CENTS / 100
        } MXN.`,
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Falta el comprobante (archivo)" }, { status: 400 });
  }
  if (file.size > MAX_PROOF_BYTES) {
    return NextResponse.json({ error: "El comprobante supera el limite de 10 MB" }, { status: 400 });
  }

  // Validacion por magic number (el MIME declarado por el browser es falseable).
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !(ALLOWED_PROOF_TYPES as readonly string[]).includes(detected.mime)) {
    return NextResponse.json(
      { error: "Tipo de archivo no permitido. Sube una imagen JPG/PNG o un PDF." },
      { status: 400 },
    );
  }

  // Bucket privado, prefijo dedicado, nombre aleatorio (no filtra info).
  const path = `ai-billing/spei-proofs/${ctx.clinicId}/${randomUUID()}.${detected.ext}`;
  const { error: upErr } = await adminSupabase()
    .storage.from(BUCKETS.PATIENT_FILES)
    .upload(path, buffer, { contentType: detected.mime, upsert: false });
  if (upErr) {
    console.error("[ai-wallet/spei/topup] upload error:", upErr.message);
    return NextResponse.json({ error: "No se pudo guardar el comprobante" }, { status: 500 });
  }

  // Guardamos el PATH (no una URL): se firma on-demand al leerlo (admin GET).
  const topup = await prisma.aiTopup.create({
    data: {
      clinicId: ctx.clinicId,
      amountCents,
      method: "SPEI",
      status: "PENDING",
      proofUrl: path,
    },
    select: { id: true, amountCents: true, method: true, status: true, createdAt: true },
  });

  return NextResponse.json(
    {
      topup,
      account: SPEI_ACCOUNT,
      message: "Recarga registrada. Acreditaremos tu saldo cuando confirmemos la transferencia.",
    },
    { status: 201 },
  );
}
