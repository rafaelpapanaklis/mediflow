import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptPrivateKey } from "@/lib/signature/envelope";
import { signDetached, requestTsaTimestamp } from "@/lib/signature/fiel";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_DOC_TYPES = new Set(["PRESCRIPTION", "MEDICAL_RECORD", "CONSENT", "OTHER"]);

/**
 * POST /api/signature/sign — firma electrónica avanzada de un documento.
 *
 * Body:
 *   {
 *     docType: "PRESCRIPTION"|"MEDICAL_RECORD"|"CONSENT"|"OTHER",
 *     docId: string,
 *     content: object | string,   // JSON canónico del doc
 *     keyPassword: string,        // password de la .key SAT
 *   }
 *
 * Multi-tenant:
 *  - clinicId siempre del User (getCurrentUser), nunca del body.
 *  - El doc referenciado (docId) DEBE pertenecer a la misma clinicId
 *    si es PRESCRIPTION o MEDICAL_RECORD; lo validamos antes de firmar.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["DOCTOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { docType?: string; docId?: string; content?: unknown; keyPassword?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const docType = String(body.docType ?? "").toUpperCase();
  if (!VALID_DOC_TYPES.has(docType)) {
    return NextResponse.json({ error: "invalid_docType" }, { status: 400 });
  }
  if (!body.docId || typeof body.docId !== "string") {
    return NextResponse.json({ error: "docId_required" }, { status: 400 });
  }
  if (body.content === undefined || body.content === null) {
    return NextResponse.json({ error: "content_required" }, { status: 400 });
  }
  if (!body.keyPassword) {
    return NextResponse.json({ error: "keyPassword_required" }, { status: 400 });
  }

  // Validación multi-tenant del doc referenciado.
  if (docType === "PRESCRIPTION") {
    const rx = await prisma.prescription.findFirst({
      where: { id: body.docId, clinicId: user.clinicId },
      select: { id: true },
    });
    if (!rx) return NextResponse.json({ error: "prescription_not_found" }, { status: 404 });
  } else if (docType === "MEDICAL_RECORD") {
    const rec = await prisma.medicalRecord.findFirst({
      where: { id: body.docId, clinicId: user.clinicId },
      select: { id: true },
    });
    if (!rec) return NextResponse.json({ error: "record_not_found" }, { status: 404 });
  } else if (docType === "CONSENT") {
    const c = await prisma.consentForm.findFirst({
      where: { id: body.docId, clinicId: user.clinicId },
      select: { id: true },
    });
    if (!c) return NextResponse.json({ error: "consent_not_found" }, { status: 404 });
  }

  // Cargar el cert activo del doctor.
  const cert = await prisma.doctorSignatureCert.findUnique({
    where: { userId: user.id },
  });
  if (!cert || !cert.isActive) {
    return NextResponse.json({ error: "no_active_cert" }, { status: 422 });
  }
  if (cert.validUntil < new Date()) {
    return NextResponse.json({ error: "cert_expired", validUntil: cert.validUntil }, { status: 422 });
  }

  // Recuperar cer + key. cerFileUrl/keyFileUrl tienen prefijo "inline:base64:".
  // Para producción Storage real, agregar branch fetch desde Supabase.
  if (!cert.cerFileUrl.startsWith("inline:base64:") || !cert.keyFileUrl.startsWith("inline:base64:")) {
    return NextResponse.json({ error: "cert_storage_unsupported" }, { status: 500 });
  }
  const cerDer = Buffer.from(cert.cerFileUrl.replace("inline:base64:", ""), "base64");
  const keyEnc = Buffer.from(cert.keyFileUrl.replace("inline:base64:", ""), "base64");

  let keyDer: Buffer;
  try {
    keyDer = decryptPrivateKey({
      ciphertext: keyEnc,
      iv: cert.keyEncIv,
      authTag: cert.keyEncAuthTag,
    });
  } catch (e) {
    return NextResponse.json({ error: "key_decrypt_failed", detail: String(e) }, { status: 500 });
  }

  // Calcular sha256 del content canónico.
  const contentStr = typeof body.content === "string"
    ? body.content
    : JSON.stringify(body.content);
  const contentBuffer = Buffer.from(contentStr, "utf8");
  const sha256 = createHash("sha256").update(contentBuffer).digest("hex");

  // Firmar.
  let signature: string;
  try {
    signature = signDetached({
      contentBuffer,
      cerDer,
      keyDer,
      keyPassword: body.keyPassword,
    });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("invalid_key_password")) {
      return NextResponse.json({ error: "invalid_key_password" }, { status: 401 });
    }
    return NextResponse.json({ error: "sign_failed", detail: msg }, { status: 500 });
  } finally {
    // Borrar key descifrada de memoria — best effort
    keyDer.fill(0);
  }

  // Solicitar timestamp TSA (best effort)
  let tsaTimestamp: string | null = null;
  try {
    tsaTimestamp = await requestTsaTimestamp(sha256);
  } catch (e) {
    console.warn("TSA timestamp request failed:", e);
  }

  const signed = await prisma.signedDocument.create({
    data: {
      clinicId: user.clinicId,
      docType: docType as "PRESCRIPTION" | "MEDICAL_RECORD" | "CONSENT" | "OTHER",
      docId: body.docId,
      signerUserId: user.id,
      sha256,
      signature,
      tsaTimestamp,
    },
  });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: docType === "PRESCRIPTION" ? "prescription" : docType === "MEDICAL_RECORD" ? "record" : "consent",
    entityId: body.docId,
    action: "update",
    after: { signed: true, signatureId: signed.id, sha256 },
  });

  return NextResponse.json({
    signatureId: signed.id,
    sha256,
    signedAt: signed.signedAt,
    tsaTimestamp: !!tsaTimestamp,
  }, { status: 201 });
}
