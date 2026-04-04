import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createOrganization, updateOrgLegal, getOrgApiKey } from "@/lib/facturapi";

// POST /api/settings/cfdi — configure clinic's RFC for invoicing
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const { rfcEmisor, regimenFiscal, cpEmisor, razonSocial } = await req.json();

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

    // Create Facturapi organization if first time
    if (!orgId) {
      orgId = await createOrganization(clinic.name);
    }

    // Update legal data on Facturapi
    await updateOrgLegal(orgId, {
      name:          razonSocial.trim().toUpperCase(),
      rfc:           rfcEmisor.trim().toUpperCase(),
      regimen_fiscal:regimenFiscal,
      address:       { zip: cpEmisor.trim(), country:"MEX" },
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
      },
    });

    return NextResponse.json({ success:true, orgId });

  } catch (err: any) {
    console.error("Facturapi setup error:", err);
    return NextResponse.json({ error: err.message ?? "Error configurando Facturapi" }, { status:500 });
  }
}
