import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import {
  barberApiError,
  barberUnauthorized,
  setBranchActive,
  updateBranch,
} from "@/lib/barber/branches";

// PATCH /api/barber/branches/[id]
//   { isActive } solo         -> abre / cierra la sede (la matriz nunca).
//   cualquier otro campo      -> edita datos de la sede.
// No hay DELETE a propósito: detrás de una sede hay citas, ventas y caja.

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    if (typeof body.isActive === "boolean" && Object.keys(body).length === 1) {
      await setBranchActive(ctx, params.id, body.isActive);
      return NextResponse.json({ ok: true });
    }
    const branch = await updateBranch(ctx, params.id, body);
    return NextResponse.json({ branch });
  } catch (err) {
    return barberApiError(err, "branches/[id]:PATCH");
  }
}
