import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import {
  barberApiError,
  barberUnauthorized,
  readBranchCookie,
  resolveBranchScope,
} from "@/lib/barber/branches";
import { createBarberProfile, getBarberSeatLimit, listBarbers } from "@/lib/barber/team";

// /api/barber/team/barbers — fichas de barbero (el profesional).
// El route solo resuelve sesión, parsea y delega en src/lib/barber/team.ts,
// que es quien llama assertBarberPermission("barbers.manage"). El alcance de
// sedes NUNCA sale del body: se resuelve con resolveBranchScope sobre lo que
// getAccessibleBranchIds permite.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const requested = req.nextUrl.searchParams.get("branch") ?? readBranchCookie();
    const scope = await resolveBranchScope(ctx, requested);
    const [barbers, seat] = await Promise.all([
      listBarbers(ctx, scope.branchIds),
      getBarberSeatLimit(ctx),
    ]);
    return NextResponse.json({ barbers, seat, scope });
  } catch (err) {
    return barberApiError(err, "team/barbers:GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    const barber = await createBarberProfile(ctx, body);
    return NextResponse.json({ barber }, { status: 201 });
  } catch (err) {
    return barberApiError(err, "team/barbers:POST");
  }
}
