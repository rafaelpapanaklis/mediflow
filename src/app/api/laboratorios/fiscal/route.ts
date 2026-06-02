import { type NextRequest, NextResponse } from "next/server";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import type { DentalLabFiscalDataDTO } from "@/lib/laboratorios/types";

export const dynamic = "force-dynamic";

// Serializa DentalLabFiscalData (columnas planas) al DTO de red, que anida
// {code,label} para régimen fiscal y uso CFDI. Helper local — sin compartir.
function serializeFiscal(f: any): DentalLabFiscalDataDTO {
  return {
    legalName: f.legalName,
    rfc: f.rfc,
    taxRegime: { code: f.taxRegimeCode, label: f.taxRegimeLabel },
    zipCode: f.zipCode,
    cfdiUse: { code: f.cfdiUseCode, label: f.cfdiUseLabel },
    state: f.state ?? null,
    certificateUrl: f.certificateUrl ?? null,
    certificateValidUntil: f.certificateValidUntil ? f.certificateValidUntil.toISOString() : null,
  };
}

// ── GET /api/laboratorios/fiscal ─────────────────────────────────────────
// Datos fiscales del laboratorio en sesión (null si aún no se capturan).
export async function GET() {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const fiscal = await prisma.dentalLabFiscalData.findUnique({ where: { labId: ctx.labId } });

  return NextResponse.json(fiscal ? serializeFiscal(fiscal) : null, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

// ── PUT /api/laboratorios/fiscal ─────────────────────────────────────────
// Upsert 1:1 de los datos fiscales del laboratorio en sesión. Mapea el shape
// del cliente (planas: taxRegimeCode/Label, cfdiUseCode/Label) a las columnas.
export async function PUT(req: NextRequest) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
    return NextResponse.json(
      { error: "No tienes permiso para editar los datos fiscales." },
      { status: 403 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  const legalName = str(body?.legalName);
  if (!legalName) return NextResponse.json({ error: "La razón social es requerida." }, { status: 400 });

  const rfc = str(body?.rfc).toUpperCase();
  if (rfc.length < 12 || rfc.length > 13) {
    return NextResponse.json({ error: "El RFC debe tener 12 o 13 caracteres." }, { status: 400 });
  }

  const taxRegimeCode = str(body?.taxRegimeCode);
  const taxRegimeLabel = str(body?.taxRegimeLabel);
  if (!taxRegimeCode || !taxRegimeLabel) {
    return NextResponse.json({ error: "El régimen fiscal es requerido." }, { status: 400 });
  }

  const cfdiUseCode = str(body?.cfdiUseCode);
  const cfdiUseLabel = str(body?.cfdiUseLabel);
  if (!cfdiUseCode || !cfdiUseLabel) {
    return NextResponse.json({ error: "El uso de CFDI es requerido." }, { status: 400 });
  }

  const zipCode = str(body?.zipCode);
  if (!/^\d{5}$/.test(zipCode)) {
    return NextResponse.json({ error: "El código postal debe tener 5 dígitos." }, { status: 400 });
  }

  const stateRaw = str(body?.state);
  const state = stateRaw || null;

  // El certificado es opcional y el form actual no lo envía. Solo se
  // sobrescribe cuando la llave viene presente en el body (update parcial),
  // para no borrar valores ya persistidos por otra vía (migración/admin/futuro
  // uploader). Si la llave no viene, las columnas se preservan en el update.
  const certPatch: { certificateUrl?: string | null; certificateValidUntil?: Date | null } = {};
  if (body?.certificateUrl !== undefined) {
    certPatch.certificateUrl = str(body.certificateUrl) || null;
  }
  if (body?.certificateValidUntil !== undefined) {
    if (body.certificateValidUntil) {
      const d = new Date(body.certificateValidUntil);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "La fecha del certificado no es válida." }, { status: 400 });
      }
      certPatch.certificateValidUntil = d;
    } else {
      certPatch.certificateValidUntil = null;
    }
  }

  const fields = {
    legalName: legalName.slice(0, 200),
    rfc: rfc.slice(0, 13),
    taxRegimeCode: taxRegimeCode.slice(0, 10),
    taxRegimeLabel: taxRegimeLabel.slice(0, 200),
    zipCode,
    cfdiUseCode: cfdiUseCode.slice(0, 10),
    cfdiUseLabel: cfdiUseLabel.slice(0, 200),
    state,
  };

  const fiscal = await prisma.dentalLabFiscalData.upsert({
    where: { labId: ctx.labId },
    create: { labId: ctx.labId, ...fields, ...certPatch },
    update: { ...fields, ...certPatch },
  });

  return NextResponse.json(serializeFiscal(fiscal));
}
