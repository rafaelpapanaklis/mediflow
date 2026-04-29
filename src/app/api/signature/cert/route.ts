import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptPrivateKey } from "@/lib/signature/envelope";
import { parseCer } from "@/lib/signature/fiel";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/signature/cert — registra el certificado FIEL del doctor.
 *
 * Body (JSON):
 *   {
 *     cerBase64: string,   // .cer DER en base64
 *     keyBase64: string,   // .key DER cifrada (PKCS#8 EncryptedPrivateKeyInfo) en base64
 *     keyPassword: string, // password de la llave privada SAT
 *   }
 *
 * Operaciones:
 *  1. Parsea .cer → extrae serial, issuer, validFrom, validUntil, RFC.
 *  2. Cifra la .key (raw DER bytes) con AES-256-GCM usando
 *     SIGNATURE_MASTER_KEY del env.
 *  3. Persiste cer y key cifrada como base64 en cerFileUrl/keyFileUrl
 *     (campos TEXT — para producción real, subir a Supabase Storage
 *     bucket "doctor-certs" y guardar la URL firmada).
 *  4. Crea/actualiza DoctorSignatureCert (1 cert activo por doctor).
 *
 * Multi-tenant: el cert es del User, hereda clinicId vía relation.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["DOCTOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { cerBase64?: string; keyBase64?: string; keyPassword?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.cerBase64 || !body.keyBase64 || !body.keyPassword) {
    return NextResponse.json({ error: "cerBase64_keyBase64_keyPassword_required" }, { status: 400 });
  }

  let cerBuf: Buffer;
  let keyBuf: Buffer;
  try {
    cerBuf = Buffer.from(body.cerBase64, "base64");
    keyBuf = Buffer.from(body.keyBase64, "base64");
  } catch {
    return NextResponse.json({ error: "invalid_base64" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseCer(cerBuf);
  } catch (e) {
    return NextResponse.json({ error: "cer_parse_failed", detail: String(e) }, { status: 400 });
  }

  // Cifrar la .key con master key (env). NUNCA persistas en claro.
  let encrypted;
  try {
    encrypted = encryptPrivateKey(keyBuf);
  } catch (e) {
    return NextResponse.json({ error: "encryption_failed", detail: String(e) }, { status: 500 });
  }

  // TODO: subir cerBuf y encrypted.ciphertext a Supabase Storage bucket
  // "doctor-certs". Por ahora persistimos como base64 en TEXT — funcional
  // pero no escalable para certs grandes. Migración a Storage es trivial.
  const cerStored = cerBuf.toString("base64");
  const keyEncStored = encrypted.ciphertext.toString("base64");

  const cert = await prisma.doctorSignatureCert.upsert({
    where: { userId: user.id },
    create: {
      userId:        user.id,
      cerFileUrl:    `inline:base64:${cerStored}`,
      keyFileUrl:    `inline:base64:${keyEncStored}`,
      keyEncIv:      encrypted.iv,
      keyEncAuthTag: encrypted.authTag,
      cerSerial:     parsed.serial,
      cerIssuer:     parsed.issuer.slice(0, 200),
      validFrom:     parsed.validFrom,
      validUntil:    parsed.validUntil,
      rfc:           parsed.rfc.slice(0, 13),
      isActive:      true,
    },
    update: {
      cerFileUrl:    `inline:base64:${cerStored}`,
      keyFileUrl:    `inline:base64:${keyEncStored}`,
      keyEncIv:      encrypted.iv,
      keyEncAuthTag: encrypted.authTag,
      cerSerial:     parsed.serial,
      cerIssuer:     parsed.issuer.slice(0, 200),
      validFrom:     parsed.validFrom,
      validUntil:    parsed.validUntil,
      rfc:           parsed.rfc.slice(0, 13),
      isActive:      true,
    },
  });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "user",
    entityId: user.id,
    action: "update",
    after: { signatureCertSerial: cert.cerSerial, validUntil: cert.validUntil, rfc: cert.rfc },
  });

  return NextResponse.json({
    id: cert.id,
    cerSerial: cert.cerSerial,
    cerIssuer: cert.cerIssuer,
    validFrom: cert.validFrom,
    validUntil: cert.validUntil,
    rfc: cert.rfc,
  }, { status: 201 });
}

/**
 * GET /api/signature/cert — info del cert activo del doctor logueado.
 */
export async function GET() {
  const user = await getCurrentUser();
  const cert = await prisma.doctorSignatureCert.findUnique({
    where: { userId: user.id },
    select: {
      id: true, cerSerial: true, cerIssuer: true,
      validFrom: true, validUntil: true, rfc: true, isActive: true, createdAt: true,
    },
  });
  if (!cert) return NextResponse.json({ cert: null });
  return NextResponse.json({ cert });
}
