// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/contracts → el listado, con filtros por querystring
// POST /api/realty/contracts → generar un contrato desde su origen
//
// Las tres rejas (sesión, plan, permiso) las pone gateContracts. El
// accountId sale SIEMPRE de la sesión: no hay un solo parámetro de entrada
// que pueda cambiar de cuenta.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  createContract,
  listContracts,
  type ListContractsFilters,
} from "@/lib/realty/contracts";
import { isContractKind, isContractStatus } from "@/components/realty/contracts/shared";
import { contractsApiError, gateContracts, readJson } from "./_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  const q = req.nextUrl.searchParams;
  const filters: ListContractsFilters = {};

  const status = q.get("status");
  if (status === "TODOS" || isContractStatus(status)) filters.status = status;

  const kind = q.get("kind");
  if (kind === "TODOS" || isContractKind(kind)) filters.kind = kind;

  const propertyId = q.get("propertyId");
  if (propertyId) filters.propertyId = propertyId;

  const contactId = q.get("contactId");
  if (contactId) filters.contactId = contactId;

  const expiring = Number(q.get("expiringInDays"));
  if (Number.isFinite(expiring) && expiring > 0) filters.expiringInDays = expiring;

  try {
    return NextResponse.json({ contracts: await listContracts(gate.ctx, filters) });
  } catch (e) {
    return contractsApiError(e, "list");
  }
}

export async function POST(req: NextRequest) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  const body = await readJson(req);
  const kind = body.kind;
  if (!isContractKind(kind)) {
    return NextResponse.json({ error: "Elige el tipo de contrato." }, { status: 400 });
  }

  // `manual` llega como objeto libre desde el formulario. NO se pasa tal
  // cual: se recorta a pares string→string aquí, y allá dentro la reja del
  // catálogo descarta cualquier llave que no sea una variable del tipo.
  const manual: Record<string, string> = {};
  if (body.manual && typeof body.manual === "object" && !Array.isArray(body.manual)) {
    for (const [k, v] of Object.entries(body.manual as Record<string, unknown>)) {
      if (typeof v === "string") manual[k] = v;
    }
  }

  try {
    const id = await createContract(gate.ctx, {
      kind,
      leaseId: typeof body.leaseId === "string" ? body.leaseId : null,
      exclusiveId: typeof body.exclusiveId === "string" ? body.exclusiveId : null,
      dealId: typeof body.dealId === "string" ? body.dealId : null,
      propertyId: typeof body.propertyId === "string" ? body.propertyId : null,
      title: typeof body.title === "string" ? body.title : null,
      manual,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return contractsApiError(e, "create");
  }
}
