import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { createOrganization, updateOrgLegal, getOrganizationStatus } from "@/lib/facturapi";

// POST /api/settings/cfdi — configure clinic's RFC for invoicing
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // EQ-07: los datos fiscales del emisor son configuración → "Editar
  // configuración" (antes `requireAdmin`; mismos roles por default).
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;

  const { rfcEmisor, regimenFiscal, cpEmisor, razonSocial, cfdiTaxMode } = await req.json();

  if (!rfcEmisor?.trim()) return NextResponse.json({ error:"RFC es requerido" }, { status:400 });
  if (!cpEmisor?.trim() || cpEmisor.length !== 5) return NextResponse.json({ error:"Código postal debe tener 5 dígitos" }, { status:400 });
  if (!razonSocial?.trim()) return NextResponse.json({ error:"Razón social es requerida" }, { status:400 });

  // Validate FACTURAPI_USER_KEY exists
  if (!process.env.FACTURAPI_USER_KEY) {
    return NextResponse.json({ error:"Facturapi no está configurado. Agrega FACTURAPI_USER_KEY en las variables de entorno." }, { status:500 });
  }

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx!.clinicId },
    select: { facturApiOrgId:true, name:true },
  });

  if (!clinic) return NextResponse.json({ error:"Clínica no encontrada" }, { status:404 });

  try {
    let orgId = clinic.facturApiOrgId;

    // La org registrada puede haber desaparecido de Facturapi (borrada desde su
    // panel): actualizarle los datos fiscales fallaría para siempre. Si ya no
    // existe, se descarta y se crea una nueva. Un fallo al consultar (red, 500)
    // NO la descarta — solo un 404 explícito.
    const previousOrgId = orgId;
    if (orgId) {
      const prev = await getOrganizationStatus(orgId, { refresh: true }).catch(() => null);
      if (prev && !prev.exists) orgId = null;
    }

    // Create Facturapi organization if first time
    if (!orgId) {
      orgId = await createOrganization(clinic.name);
      // Se persiste APENAS se crea. Antes se guardaba hasta el final: si
      // updateOrgLegal fallaba, la organización quedaba huérfana en Facturapi y
      // cada reintento creaba otra.
      //
      // Todo el estado que pertenecía a la org ANTERIOR se limpia en el MISMO
      // update: su llave Live no sirve para esta org, y la org nueva no tiene
      // certificado (dejar csdUploaded=true pintaría "CSD activo" en falso y
      // saltaría el respaldo del gate de producción).
      await prisma.clinic.update({
        where: { id: ctx!.clinicId },
        data: {
          facturApiOrgId:   orgId,
          facturApiLiveKey: null,
          ...(previousOrgId ? { csdUploaded: false, csdValidUntil: null } : {}),
        },
      });
      // Reemplazar una organización es destructivo (los CFDI viejos viven en la
      // anterior): queda en el audit log con el orgId anterior para poder volver.
      if (previousOrgId) {
        await logMutation({
          req,
          clinicId:   ctx!.clinicId,
          userId:     ctx!.userId,
          entityType: "clinic",
          entityId:   ctx!.clinicId,
          action:     "update",
          before: { facturApiOrgId: previousOrgId },
          after:  { facturApiOrgId: orgId, reason: "org inexistente en Facturapi (404) — recreada" },
        });
      }
    }

    // Update legal data on Facturapi. El RFC capturado se guarda solo en nuestra
    // BD: Facturapi lo toma del CSD (en TEST usa su certificado de prueba).
    await updateOrgLegal(orgId, {
      name:       razonSocial.trim().toUpperCase(),
      legal_name: razonSocial.trim().toUpperCase(),
      tax_system: regimenFiscal,
      address:    { zip: cpEmisor.trim() },
    });

    // Save to our DB
    await prisma.clinic.update({
      where: { id: ctx!.clinicId },
      data: {
        facturApiOrgId:   orgId,
        rfcEmisor:        rfcEmisor.trim().toUpperCase(),
        regimenFiscal,
        cpEmisor:         cpEmisor.trim(),
        facturApiEnabled: true,
        // Impuestos con los que se pre-llena el timbrado de esta clínica. Solo se
        // toca si el cliente mandó un valor válido; el modal de timbrado sigue
        // pudiendo sobreescribirlo por factura.
        ...(cfdiTaxMode === "exempt" || cfdiTaxMode === "iva16" ? { cfdiTaxMode } : {}),
      },
    });

    return NextResponse.json({ success:true, orgId });

  } catch (err: any) {
    console.error("Facturapi setup error:", err);
    return NextResponse.json({ error: err.message ?? "Error configurando Facturapi" }, { status:500 });
  }
}
