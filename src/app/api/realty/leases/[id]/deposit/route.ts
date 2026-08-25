// ═══════════════════════════════════════════════════════════════════════
// POST  /api/realty/leases/[id]/deposit → registrar el depósito en garantía
// PATCH /api/realty/leases/[id]/deposit → resolverlo (devuelto / aplicado)
//
// El depósito es dinero del inquilino que hay que devolver, así que:
//   · se registra al activar el contrato (activateLease) o a mano aquí;
//   · resolverlo EXIGE una nota — sin ella la decisión no se defiende en la
//     conversación del final del contrato;
//   · el depósito NUNCA se borra: cambia de estado y guarda su resolución.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  createDeposit,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  resolveDeposit,
} from "@/lib/realty/leases";
import type { RealtyDepositStatus } from "@/lib/realty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
    const id = await createDeposit(ctx, params.id, body.amount as number | string);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return realtyApiError(err, "leases:deposit-create");
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
    const depositId = String(body.depositId ?? "").trim();
    if (!depositId) {
      return NextResponse.json({ error: "Falta el depósito que se va a resolver." }, { status: 400 });
    }
    // El depósito tiene que ser de ESTA cuenta Y de ESTE contrato: el
    // leaseId de la ruta también es reja, no solo contexto de pantalla.
    await resolveDeposit(
      ctx,
      depositId,
      {
        status: body.status as RealtyDepositStatus,
        note: typeof body.note === "string" ? body.note : null,
        amount: (body.amount as number | string | null) ?? null,
      },
      params.id,
    );
    return NextResponse.json({ ok: true, leaseId: params.id });
  } catch (err) {
    return realtyApiError(err, "leases:deposit-resolve");
  }
}
