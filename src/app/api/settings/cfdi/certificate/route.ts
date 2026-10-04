import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { uploadCertificate } from "@/lib/facturapi";
import { logMutation } from "@/lib/audit";
import { avisosDelEmisor } from "@/lib/cfdi/emisor";
import { textoFacturacionNoDisponible } from "@/lib/cfdi/mensajes";
import { leerCertificadoCsd } from "@/lib/cfdi/csd-certificado.server";
import { rfcDeLaOrganizacion } from "@/lib/cfdi/facturapi-extra.server";

export const runtime = "nodejs"; // Buffer / multipart hacia Facturapi

// POST /api/settings/cfdi/certificate
// Sube el CSD (.cer + .key + contraseña) de la clínica a su organización en
// Facturapi. Admin, aislado por clinicId. Recibe los archivos en base64 (mismo
// patrón que /api/signature/cert) para viajar en un JSON simple.
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 10, 60 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // EQ-07: subir el CSD es configuración fiscal → "Editar configuración"
  // (antes `requireAdmin`; mismos roles por default).
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;

  if (!process.env.FACTURAPI_USER_KEY) {
    // C-57: la variable que falta va al log; a la clínica, qué hacer.
    console.error("[settings/cfdi/certificate] falta FACTURAPI_USER_KEY en el entorno");
    return NextResponse.json({ error: textoFacturacionNoDisponible() }, { status: 500 });
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
    select: {
      facturApiOrgId: true, locale: true, rfcEmisor: true, cfdiTaxMode: true,
      csdUploaded: true, csdValidUntil: true,
    },
  });
  if (!clinic?.facturApiOrgId) {
    return NextResponse.json({ error: "Primero configura tu RFC en Facturación; eso crea tu organización fiscal antes de subir el CSD." }, { status: 400 });
  }

  const cerBuffer = Buffer.from(String(cerBase64), "base64");
  const keyBuffer = Buffer.from(String(keyBase64), "base64");
  if (cerBuffer.length === 0 || keyBuffer.length === 0) {
    return NextResponse.json({ error: "Los archivos están vacíos o corruptos." }, { status: 400 });
  }

  // ws1-t8 (F-15): el RFC y la vigencia del .cer se leen aquí mismo (es el certificado público,
  // no la llave) para la bitácora y para compararlo con el RFC del panel.
  const delCer = leerCertificadoCsd(cerBuffer);

  try {
    const status = await uploadCertificate(clinic.facturApiOrgId, cerBuffer, keyBuffer, String(password));

    await prisma.clinic.update({
      where: { id: ctx!.clinicId },
      data: {
        csdUploaded: true,
        // Solo se escribe la vigencia si Facturapi la reportó: antes un response
        // sin expires_at borraba una fecha válida que ya estaba guardada.
        ...(status.validUntil ? { csdValidUntil: new Date(status.validUntil) } : {}),
      },
    });

    const vigencia = status.validUntil ?? delCer?.validoHasta?.toISOString() ?? null;
    // RFC del CSD: el que asignó Facturapi (legal.tax_id) y, si no contesta, el del .cer.
    const rfcDelCsd = (await rfcDeLaOrganizacion(clinic.facturApiOrgId, { refresh: true })) ?? delCer?.rfc ?? null;

    // Subir el CSD queda en Movimientos (antes no dejaba rastro: auditoría CFDI §0.1). Solo datos
    // públicos del certificado: número de serie, RFC y vigencia. Nada de la llave ni la contraseña.
    await logMutation({
      texto: "Subió el certificado de sello digital (CSD) para facturar",
      req,
      clinicId:   ctx!.clinicId,
      userId:     ctx!.userId,
      entityType: "clinic",
      entityId:   ctx!.clinicId,
      action:     "update",
      before: { csd: { cargado: clinic.csdUploaded, vigencia: clinic.csdValidUntil?.toISOString() ?? null } },
      after:  { csd: { cargado: true, vigencia, numeroDeSerie: status.serialNumber ?? null, rfc: rfcDelCsd } },
    });

    const avisos = avisosDelEmisor({
      rfcEmisor: clinic.rfcEmisor,
      cfdiTaxMode: clinic.cfdiTaxMode,
      csdUploaded: true,
      csdValidUntil: vigencia,
      rfcDelCsd,
      ahora: new Date(),
      locale: clinic.locale,
    });

    return NextResponse.json({
      success:       true,
      csdUploaded:   true,
      csdValidUntil: status.validUntil,
      serialNumber:  status.serialNumber,
      avisos,
    });
  } catch (err: any) {
    console.error("CSD upload error:", err);
    // Errores típicos de Facturapi: contraseña incorrecta, .cer/.key no coinciden,
    // certificado no es CSD (es FIEL), o RFC del cert distinto al de la organización.
    return NextResponse.json({ error: err.message ?? "Error subiendo el certificado CSD" }, { status: 400 });
  }
}
