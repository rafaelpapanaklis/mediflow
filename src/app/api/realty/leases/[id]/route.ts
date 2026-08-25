// ═══════════════════════════════════════════════════════════════════════
// GET    /api/realty/leases/[id] → el contrato completo (partes, cargos,
//                                  pagos, depósitos y el historial del tope)
// PATCH  /api/realty/leases/[id] → editar, o mover de estado con `action`:
//                                  activar | terminar | vencer | cargos
// DELETE /api/realty/leases/[id] → SOLO borradores sin dinero registrado
//
// El id del contrato SIEMPRE se busca con el accountId de la sesión: un
// contrato de otra cuenta se ve exactamente igual que uno que no existe.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  activateLease,
  deleteLease,
  generateCharges,
  getLeaseDetail,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  terminateLease,
  updateLease,
  type LeaseInput,
} from "@/lib/realty/leases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    const lease = await getLeaseDetail(ctx, params.id);
    if (!lease) {
      return NextResponse.json({ error: "No encontramos ese contrato." }, { status: 404 });
    }
    return NextResponse.json({ lease });
  } catch (err) {
    return realtyApiError(err, "leases:detail");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "activar") {
      const res = await activateLease(ctx, params.id);
      return NextResponse.json({ ok: true, ...res });
    }
    if (action === "terminar") {
      await terminateLease(ctx, params.id, "TERMINADO");
      return NextResponse.json({ ok: true });
    }
    if (action === "vencer") {
      await terminateLease(ctx, params.id, "VENCIDO");
      return NextResponse.json({ ok: true });
    }
    if (action === "cargos") {
      // Regenerar es idempotente: solo agrega los meses que faltan.
      const res = await generateCharges(ctx, params.id);
      return NextResponse.json({ ok: true, ...res });
    }

    await updateLease(ctx, params.id, body as unknown as LeaseInput);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return realtyApiError(err, "leases:update");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    await deleteLease(ctx, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return realtyApiError(err, "leases:delete");
  }
}
