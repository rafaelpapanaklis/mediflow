import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { setMemberBranchAccess } from "@/lib/barber/team";

// PUT /api/barber/team/members/[id]/branches — body { branchIds: string[] }
// Reparte acceso a otras sedes (BarberUserBranchAccess). Exige
// branches.manage (así lo fija el contrato) y plan con multiBranch.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const member = await setMemberBranchAccess(ctx, params.id, body.branchIds);
    return NextResponse.json({ member });
  } catch (err) {
    return barberApiError(err, "team/members/[id]/branches:PUT");
  }
}
