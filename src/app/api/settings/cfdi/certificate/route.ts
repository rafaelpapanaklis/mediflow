import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { uploadCertificate } from "@/lib/facturapi";

export const runtime = "nodejs"; // Buffer / multipart hacia Facturapi

// POST /api/settings/cfdi/certificate
// Sube el CSD (.cer + .key + contraseña) de la clínica a su organización en
// Facturapi. Admin, aislado por clinicId. Recibe los archivos en base64 (mismo
// patrón que /api/signature/cert) para viajar en un JSON simple.
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 10, 60 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  if (!process.env.FACTURAPI_USER_KEY) {
    return NextResponse.json({ error: "Facturapi no está configurado. Agrega FACTURAPI_USER_KEY en las variables de entorno." }, { status: 500 });
  }

  const { cerBase64, keyBase64, password } = await req.json().catch(() => ({}));

  if (!cerBase64 || !keyBase64) {
    return NextResponse.json({ error: "Sube ambos archivos: el certificado (.cer) y la llave privada (.key)." }, { status: 400 });
  }
  if (!password || !String(password).trim()) {
    return NextResponse.json({ error: "La contraseña de la llave privada es requerida." }, { status: 400 });
  }

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx!.clinicId },
    select: { facturApiOrgId: true },
  });
  if (!clinic?.facturApiOrgId) {
    return NextResponse.json({ error: "Primero configura tu RFC en Facturación; eso crea tu organización fiscal antes de subir el CSD." }, { status: 400 });
  }

  const cerBuffer = Buffer.from(String(cerBase64), "base64");
  const keyBuffer = Buffer.from(String(keyBase64), "base64");
  if (cerBuffer.length === 0 || keyBuffer.length === 0) {
    return NextResponse.json({ error: "Los archivos están vacíos o corruptos." }, { status: 400 });
  }

  try {
    const status = await uploadCertificate(clinic.facturApiOrgId, cerBuffer, keyBuffer, String(password));

    await prisma.clinic.update({
      where: { id: ctx!.clinicId },
      data: {
        csdUploaded:   true,
        csdValidUntil: status.validUntil ? new Date(status.validUntil) : null,
      },
    });

    return NextResponse.json({
      success:       true,
      csdUploaded:   true,
      csdValidUntil: status.validUntil,
      serialNumber:  status.serialNumber,
    });
  } catch (err: any) {
    console.error("CSD upload error:", err);
    // Errores típicos de Facturapi: contraseña incorrecta, .cer/.key no coinciden,
    // certificado no es CSD (es FIEL), o RFC del cert distinto al de la organización.
    return NextResponse.json({ error: err.message ?? "Error subiendo el certificado CSD" }, { status: 400 });
  }
}
