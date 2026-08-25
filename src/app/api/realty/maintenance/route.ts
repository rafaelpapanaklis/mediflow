// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/maintenance → la bandeja de incidencias del panel
// POST /api/realty/maintenance → alta de una incidencia
//
// El POST también lo va a usar el PORTAL DEL INQUILINO (T9), que NO tiene
// sesión de la inmobiliaria: cuando esa ola llegue, expone su propio
// endpoint público y llama a createMaintenance con el accountId que ya
// verificó de su token. Esta ruta es la del PANEL y exige sesión.
//
// `reportedBy` es texto libre a propósito: casi siempre lo reporta el
// inquilino, que no tiene usuario del panel.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  createMaintenance,
  listMaintenance,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  type MaintenanceInput,
} from "@/lib/realty/leases";
import type { RealtyMaintenanceStatus } from "@/lib/realty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["ABIERTO", "EN_PROCESO", "RESUELTO"]);

export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.maintenance !== true) return realtyForbidden("maintenance");
  try {
    assertRealtyPermission(ctx, "maintenance.manage");
  } catch {
    return realtyForbidden("maintenance.manage");
  }

  try {
    const sp = req.nextUrl.searchParams;
    const raw = sp.get("status") ?? "";
    const rows = await listMaintenance(ctx, {
      status: STATUSES.has(raw) ? (raw as RealtyMaintenanceStatus) : "TODOS",
      propertyId: sp.get("propertyId") ?? undefined,
      leaseId: sp.get("leaseId") ?? undefined,
    });
    return NextResponse.json({ rows, count: rows.length });
  } catch (err) {
    return realtyApiError(err, "maintenance:list");
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.maintenance !== true) return realtyForbidden("maintenance");
  try {
    assertRealtyPermission(ctx, "maintenance.manage");
  } catch {
    return realtyForbidden("maintenance.manage");
  }

  try {
    const body = await readJson(req);
    const id = await createMaintenance(ctx, body as unknown as MaintenanceInput);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return realtyApiError(err, "maintenance:create");
  }
}
