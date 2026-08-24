import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import {
  barberApiError,
  barberUnauthorized,
  createBranch,
  getBranchLimit,
  listBranches,
} from "@/lib/barber/branches";

// /api/barber/branches — sedes de la cadena.
// GET  -> { branches, limit }
// POST -> crea una sede hija. La feature multiBranch y el tope maxBranches se
//         validan en el SERVIDOR (src/lib/barber/branches.ts); la UI solo los
//         refleja.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const [branches, limit] = await Promise.all([listBranches(ctx), getBranchLimit(ctx)]);
    return NextResponse.json({ branches, limit });
  } catch (err) {
    return barberApiError(err, "branches:GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const branch = await createBranch(ctx, body);
    return NextResponse.json({ branch }, { status: 201 });
  } catch (err) {
    return barberApiError(err, "branches:POST");
  }
}
