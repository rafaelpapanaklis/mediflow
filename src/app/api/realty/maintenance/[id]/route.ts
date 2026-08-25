// ═══════════════════════════════════════════════════════════════════════
// PATCH /api/realty/maintenance/[id] → abierto → en proceso → resuelto
//
// Al RESOLVER con costo, `createExpense: true` crea el gasto del inmueble
// en el mismo acto. Es lo que hace que la rentabilidad real del inmueble no
// dependa de que alguien se acuerde de capturar el gasto aparte.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  updateMaintenance,
} from "@/lib/realty/leases";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import type { RealtyMaintenanceStatus } from "@/lib/realty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

    // Crear el gasto es otra cosa que atender el mantenimiento: quien no
    // tiene expenses.manage resuelve la incidencia, pero no mete dinero a
    // los gastos del inmueble. Sin este recorte, maintenance.manage sería
    // un permiso de gastos por la puerta de atrás (ASSISTANT lo tiene y
    // expenses.manage NO).
    const puedeGastos = hasRealtyPermission(
      { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
      "expenses.manage",
    );

    const result = await updateMaintenance(ctx, params.id, {
      status: body.status as RealtyMaintenanceStatus,
      vendorName: typeof body.vendorName === "string" ? body.vendorName : undefined,
      // undefined = no se tocó; null = bórralo. Convertir lo primero en lo
      // segundo borraba el costo al mover la incidencia de RESUELTO a EN_PROCESO.
      cost: "cost" in body ? (body.cost as number | string | null) : undefined,
      resolvedAt: typeof body.resolvedAt === "string" ? body.resolvedAt : null,
      createExpense: body.createExpense === true && puedeGastos,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      expenseSkippedByPermission: body.createExpense === true && !puedeGastos,
    });
  } catch (err) {
    return realtyApiError(err, "maintenance:update");
  }
}
