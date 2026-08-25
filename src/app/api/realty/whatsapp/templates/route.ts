import { NextRequest, NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../_server";
import { listRealtyTemplates, provisionRealtyTemplates } from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";

/** Estado REAL de las plantillas, preguntándoselo a Meta. */
export async function GET() {
  const gate = await openRealtyWaGate("whatsapp.view");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const result = await listRealtyTemplates(gate.ctx.accountId);
  return NextResponse.json(result);
}

/**
 * "Crear mis plantillas". Las de MARKETING (el aviso de coincidencias) solo
 * si la persona lo pide expresamente: cuestan ~4× más y le escriben a quien
 * no preguntó.
 */
export async function POST(req: NextRequest) {
  const gate = await openRealtyWaGate("settings.edit");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const body = await req.json().catch(() => ({}));
  const result = await provisionRealtyTemplates(gate.ctx.accountId, {
    includeMarketing: body?.includeMarketing === true,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
