// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/contracts/vista-previa → cómo queda la plantilla llena
//
// Sirve para DOS cosas en el editor:
//   · sin origen  → se pinta con los valores que resuelva la cuenta y
//     guiones bajos donde no hay dato, que es como sale en papel;
//   · con origen  → se pinta con los datos REALES de esa renta / exclusiva
//     / operación, para ver el contrato antes de generarlo.
//
// 🔴 NO GUARDA NADA Y NO GENERA FOLIO. Una vista previa que consumiera
// folio dejaría huecos en el consecutivo cada vez que alguien mira sin
// generar. Aquí el folio es el de ejemplo.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { previewTemplate } from "@/lib/realty/contracts";
import { isContractKind } from "@/components/realty/contracts/shared";
import { contractsApiError, gateContracts, readJson } from "../_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  const body = await readJson(req);
  if (!isContractKind(body.kind)) {
    return NextResponse.json({ error: "Tipo de contrato no válido." }, { status: 400 });
  }

  const leaseId = typeof body.leaseId === "string" ? body.leaseId : null;
  const exclusiveId = typeof body.exclusiveId === "string" ? body.exclusiveId : null;
  const dealId = typeof body.dealId === "string" ? body.dealId : null;
  const propertyId = typeof body.propertyId === "string" ? body.propertyId : null;
  const conOrigen = Boolean(leaseId || exclusiveId || dealId || propertyId);

  try {
    const preview = await previewTemplate(
      gate.ctx,
      body.kind,
      typeof body.body === "string" ? body.body : "",
      conOrigen ? { kind: body.kind, leaseId, exclusiveId, dealId, propertyId } : null,
    );
    return NextResponse.json({ preview });
  } catch (e) {
    return contractsApiError(e, "vista-previa");
  }
}
