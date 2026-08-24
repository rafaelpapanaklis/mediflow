import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import {
  barberApiError,
  barberUnauthorized,
  readBranchCookie,
  resolveBranchScope,
} from "@/lib/barber/branches";
import { getTeamContext, inviteMember, listMembers } from "@/lib/barber/team";

// /api/barber/team/members — usuarios del panel.
// GET  -> { members, team, scope }   (exige team.manage en el service)
// POST -> alta con contraseña temporal; la contraseña se devuelve UNA vez y
//         solo a quien dio de alta, igual que en el equipo del dental.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const requested = req.nextUrl.searchParams.get("branch") ?? readBranchCookie();
    const scope = await resolveBranchScope(ctx, requested);
    const [members, team] = await Promise.all([
      listMembers(ctx, scope.branchIds),
      getTeamContext(ctx),
    ]);
    return NextResponse.json({ members, team, scope });
  } catch (err) {
    return barberApiError(err, "team/members:GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const { member, tempPassword } = await inviteMember(ctx, body);
    return NextResponse.json({ member, tempPassword }, { status: 201 });
  } catch (err) {
    return barberApiError(err, "team/members:POST");
  }
}
