import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { esRfcValido, MENSAJE_RFC_INVALIDO } from "@/lib/clinic-fields";
import { createOrganization, updateOrgLegal, getOrganizationStatus } from "@/lib/facturapi";
import { errorDeRegimenEmisor, avisosDelEmisor, datosFiscalesParaBitacora } from "@/lib/cfdi/emisor";
import { rfcDeLaOrganizacion } from "@/lib/cfdi/facturapi-extra.server";

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
  if (!esRfcValido(rfcEmisor)) return NextResponse.json({ error: MENSAJE_RFC_INVALIDO }, { status:400 });
  if (!cpEmisor?.trim() || cpEmisor.length !== 5) return NextResponse.json({ error:"Código postal debe tener 5 dígitos" }, { status:400 });
  if (!razonSocial?.trim()) return NextResponse.json({ error:"Razón social es requerida" }, { status:400 });
  // ws1-t8 (F-15): el régimen tiene que existir en c_RegimenFiscal y aplicar al tipo de persona
  // del RFC (12 = moral, 13 = física). Antes llegaba cualquier cosa a Facturapi.
  const errorRegimen = errorDeRegimenEmisor(rfcEmisor, regimenFiscal);
  if (errorRegimen) return NextResponse.json({ error: errorRegimen }, { status:400 });

  // Validate FACTURAPI_USER_KEY exists
  if (!process.env.FACTURAPI_USER_KEY) {
    return NextResponse.json({ error:"Facturapi no está configurado. Agrega FACTURAPI_USER_KEY en las variables de entorno." }, { status:500 });
  }

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx!.clinicId },
    select: {
      facturApiOrgId:true, name:true, locale:true,
      // Para la bitácora (antes / después) y los avisos del emisor (ws1-t8, F-15).
      rfcEmisor:true, regimenFiscal:true, cpEmisor:true, cfdiTaxMode:true, csdUploaded:true, csdValidUntil:true,
    },
  });

  if (!clinic) return NextResponse.json({ error:"Clínica no encontrada" }, { status:404 });
  const fiscalesAntes = datosFiscalesParaBitacora(clinic);

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
    const guardada = await prisma.clinic.update({
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
      select: { rfcEmisor:true, regimenFiscal:true, cpEmisor:true, cfdiTaxMode:true, csdUploaded:true, csdValidUntil:true },
    });

    // ws1-t8 (F-15): cambiar los datos fiscales queda en Movimientos (antes no dejaba rastro).
    // La razón social no se guarda en nuestra base (va a Facturapi), así que va solo en «después».
    await logMutation({
      texto: "Cambió los datos fiscales de facturación (CFDI)",
      req,
      clinicId:   ctx!.clinicId,
      userId:     ctx!.userId,
      entityType: "clinic",
      entityId:   ctx!.clinicId,
      action:     "update",
      before: { ...fiscalesAntes, razonSocial: null },
      after:  datosFiscalesParaBitacora({ ...guardada, razonSocial: razonSocial.trim().toUpperCase() }),
    });

    // Avisos que NO bloquean: persona moral + «exento», RFC distinto al del CSD, CSD por vencer.
    const avisos = avisosDelEmisor({
      ...guardada,
      rfcDelCsd: guardada.csdUploaded ? await rfcDeLaOrganizacion(orgId, { refresh: true }) : null,
      ahora: new Date(),
      locale: clinic.locale,
    });

    return NextResponse.json({ success:true, orgId, avisos });

  } catch (err: any) {
    console.error("Facturapi setup error:", err);
    return NextResponse.json({ error: err.message ?? "Error configurando Facturapi" }, { status:500 });
  }
}
