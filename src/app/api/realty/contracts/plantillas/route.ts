// ═══════════════════════════════════════════════════════════════════════
// GET    /api/realty/contracts/plantillas       → las cuatro de la cuenta
// PUT    /api/realty/contracts/plantillas       → guardar una
// DELETE /api/realty/contracts/plantillas?kind= → volver a la base
//
// El segmento se llama "plantillas" (estático) y convive con [id]
// (dinámico): Next resuelve lo estático primero. Un contrato jamás se
// llama así — los ids los genera newId() y empiezan por "c" + base36.
//
// 🔴 GUARDAR VALIDA LAS VARIABLES. Toda `{{x}}` del texto tiene que existir
// en el catálogo de ESE tipo de contrato (CONTRACT_VARIABLES en shared.ts).
// Un dedazo —`{{inquilino.nombr}}`— se rechaza diciendo su nombre, en vez
// de guardarse y salir impreso con la llave cruda en medio de una cláusula.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { listTemplates, resetTemplate, saveTemplate } from "@/lib/realty/contracts";
import { isContractKind } from "@/components/realty/contracts/shared";
import { contractsApiError, gateContracts, readJson } from "../_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json({ templates: await listTemplates(gate.ctx.accountId) });
  } catch (e) {
    return contractsApiError(e, "plantillas:list");
  }
}

export async function PUT(req: NextRequest) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  const body = await readJson(req);
  if (!isContractKind(body.kind)) {
    return NextResponse.json({ error: "Tipo de contrato no válido." }, { status: 400 });
  }
  try {
    const template = await saveTemplate(
      gate.ctx,
      body.kind,
      typeof body.name === "string" ? body.name : "",
      typeof body.body === "string" ? body.body : "",
    );
    return NextResponse.json({ template });
  } catch (e) {
    return contractsApiError(e, "plantillas:save");
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  const kind = req.nextUrl.searchParams.get("kind");
  if (!isContractKind(kind)) {
    return NextResponse.json({ error: "Tipo de contrato no válido." }, { status: 400 });
  }
  try {
    const template = await resetTemplate(gate.ctx.accountId, kind);
    return NextResponse.json({ template });
  } catch (e) {
    return contractsApiError(e, "plantillas:reset");
  }
}
