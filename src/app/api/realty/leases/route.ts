// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/leases → lista de contratos de arrendamiento
// POST /api/realty/leases → alta de un contrato (nace en BORRADOR)
//
// accountId SIEMPRE de la sesión (getRealtyContext). El endpoint NO acepta
// un accountId por ningún lado: ni body, ni query, ni cabecera.
//
// Tres rejas, en este orden: sesión → plan (feature `rentals`) → permiso
// del rol. Esconder el item del menú NO es control de acceso: quien escriba
// la URL a mano llega igual.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  createLease,
  listLeases,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  type LeaseInput,
  type ListLeasesFilters,
} from "@/lib/realty/leases";
import type { RealtyLeaseStatus } from "@/lib/realty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["BORRADOR", "ACTIVO", "VENCIDO", "TERMINADO"]);

export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    const sp = req.nextUrl.searchParams;
    const rawStatus = sp.get("status") ?? "";
    const filters: ListLeasesFilters = {
      status: STATUSES.has(rawStatus) ? (rawStatus as RealtyLeaseStatus) : "TODOS",
      propertyId: sp.get("propertyId") ?? undefined,
      q: sp.get("q") ?? undefined,
    };
    const expiring = parseInt(sp.get("expiringInDays") ?? "", 10);
    if (Number.isFinite(expiring) && expiring > 0) filters.expiringInDays = expiring;

    const leases = await listLeases(ctx, filters);
    return NextResponse.json({ leases, count: leases.length });
  } catch (err) {
    return realtyApiError(err, "leases:list");
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    const body = await readJson(req);
    const id = await createLease(ctx, body as unknown as LeaseInput);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return realtyApiError(err, "leases:create");
  }
}
