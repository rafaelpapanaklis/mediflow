// API PÚBLICA de la carta de consentimiento — la usa /consentimiento/[token].
//
// Sin sesión: el token ES la credencial, así que aquí no hay getAuthContext y
// todo va con rate limit. Vive bajo `public/` porque Next.js no admite dos
// segmentos dinámicos distintos al mismo nivel (`[id]` y `[token]` serían un
// error de build) y las rutas del panel necesitan `[id]`.
//
// Qué añade esta versión sobre la anterior:
//   · GET marca `viewedAt` la primera vez — evidencia de que el documento se
//     abrió ANTES de firmarlo, que es la diferencia entre un consentimiento
//     informado y una firma a ciegas;
//   · POST guarda IP y navegador junto a la firma (Código de Comercio art. 89
//     bis: la fiabilidad de la firma electrónica se sostiene en su evidencia);
//   · un documento ya firmado se puede seguir consultando aunque la liga haya
//     vencido: lo que caduca es la posibilidad de FIRMAR, no el derecho del
//     paciente a ver su propia copia.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { signMaybeUrl } from "@/lib/storage";
import { signaturePath, uploadSignature, validateSignatureDataUrl } from "@/lib/consent/signature";

/** Lo que ve el paciente. Nunca salen ids internos ni el resto del expediente. */
const PUBLIC_SELECT = {
  id: true,
  clinicId: true,
  deletedAt: true,
  procedure: true,
  content: true,
  expiresAt: true,
  viewedAt: true,
  signedAt: true,
  signatureUrl: true,
  signerName: true,
  signerRelation: true,
  revokedAt: true,
  witness1Name: true,
  witness1SignedAt: true,
  witness2Name: true,
  witness2SignedAt: true,
  patient: { select: { firstName: true, lastName: true } },
  clinic: { select: { name: true, phone: true, logoUrl: true } },
} as const;

// GET /api/consent/public/[token] — el paciente lee su carta.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 20); // 20 por minuto por IP
  if (rl) return rl;

  const form = await prisma.consentForm.findUnique({
    where: { token: params.token },
    select: PUBLIC_SELECT,
  });

  if (!form || form.deletedAt) {
    return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });
  }
  // La liga caduca para FIRMAR. Si ya está firmado, el paciente sigue pudiendo
  // ver su copia: negársela sería esconderle su propio documento.
  if (!form.signedAt && new Date() > form.expiresAt) {
    return NextResponse.json({ error: "El enlace ha expirado" }, { status: 410 });
  }

  // Evidencia de lectura previa. `updateMany` con el guard `viewedAt: null`
  // escribe UNA sola vez y sin condición de carrera; y es best-effort porque
  // fallar aquí no puede impedirle al paciente leer su consentimiento.
  if (!form.viewedAt) {
    await prisma.consentForm
      .updateMany({ where: { id: form.id, viewedAt: null }, data: { viewedAt: new Date() } })
      .catch(() => undefined);
  }

  // Firma de vida corta generada al vuelo: en la fila solo se guarda el path
  // privado del bucket.
  const signedSignatureUrl = form.signatureUrl
    ? await signMaybeUrl(form.signatureUrl).catch(() => "")
    : null;

  return NextResponse.json({
    procedure: form.procedure,
    content: form.content,
    expiresAt: form.expiresAt,
    signedAt: form.signedAt,
    signatureUrl: signedSignatureUrl,
    signerName: form.signerName,
    signerRelation: form.signerRelation,
    revokedAt: form.revokedAt,
    witness1Name: form.witness1Name,
    witness1SignedAt: form.witness1SignedAt,
    witness2Name: form.witness2Name,
    witness2SignedAt: form.witness2SignedAt,
    patient: form.patient,
    clinic: form.clinic,
  });
}

// POST /api/consent/public/[token] — el paciente (o su representante) firma.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 5);
  if (rl) return rl;

  const form = await prisma.consentForm.findUnique({
    where: { token: params.token },
    select: { id: true, clinicId: true, expiresAt: true, signedAt: true, revokedAt: true, deletedAt: true },
  });

  if (!form || form.deletedAt) {
    return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });
  }
  if (new Date() > form.expiresAt) {
    return NextResponse.json({ error: "El enlace ha expirado" }, { status: 410 });
  }
  if (form.signedAt) return NextResponse.json({ error: "Ya fue firmado" }, { status: 409 });
  if (form.revokedAt) {
    return NextResponse.json({ error: "Este consentimiento fue revocado." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const check = await validateSignatureDataUrl(body.signatureDataUrl);
  if (check.error) {
    return NextResponse.json(
      check.detail ? { error: check.error, detalle: check.detail } : { error: check.error },
      { status: check.status },
    );
  }

  // Best-effort a propósito: si el guardado de la imagen falla, se registra el
  // consentimiento igual. Perder la imagen es malo; perder la aceptación que el
  // paciente acaba de dar —y pedirle que vuelva a firmar— es peor.
  const storedPath = await uploadSignature(
    signaturePath(form.clinicId, form.id, "patient"),
    check.buffer,
  );

  const xff = req.headers.get("x-forwarded-for");
  const ip =
    (xff ? xff.split(",")[0]!.trim() : null) ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null;

  const now = new Date();
  const res = await prisma.consentForm.updateMany({
    // `signedAt: null` en el where: dos toques seguidos en la tableta no
    // sobrescriben la hora de la primera firma.
    where: { id: form.id, signedAt: null, revokedAt: null, deletedAt: null },
    data: {
      signedAt: now,
      signatureUrl: storedPath,
      signedIp: ip,
      signedUserAgent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
    },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Ya fue firmado" }, { status: 409 });
  }

  // NO se escribe en audit_logs: el firmante es el paciente, no un usuario de
  // la clínica, y AuditLog.userId es FK estricta a users. La evidencia de la
  // firma vive en la propia fila (signedAt/signedIp/signedUserAgent) y el alta
  // del documento sí quedó auditada en POST /api/consent.
  return NextResponse.json({ success: true, signedAt: now.toISOString() });
}
