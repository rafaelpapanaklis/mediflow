import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import {
  BARBER_BRANCH_ALL,
  BARBER_BRANCH_COOKIE,
  barberApiError,
  barberUnauthorized,
  resolveBranchScope,
} from "@/lib/barber/branches";

// POST /api/barber/branches/switch — body { branchId: "<id>" | "all" }
//
// Solo escribe la cookie del selector. NO es un permiso: cambiar de sede es
// moverse entre lo que getAccessibleBranchIds ya autoriza, y resolveBranchScope
// vuelve a validar la cookie en CADA lectura (si le retiran el acceso, la
// cookie vieja se degrada sola a su sede propia).
//
// El cliente hace una navegación DURA después de esto (window.location), no un
// router.refresh(): en el dental, refrescar dejaba estado del cliente de la
// sede anterior en pantalla y el usuario creía estar viendo otra sede.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    const body = await req.json().catch(() => null);
    const requested = typeof body?.branchId === "string" ? body.branchId : null;

    const scope = await resolveBranchScope(ctx, requested);
    const value = scope.isConsolidated ? BARBER_BRANCH_ALL : scope.activeId ?? ctx.barbershopId;

    const res = NextResponse.json({ ok: true, branchId: value, scope });
    res.cookies.set(BARBER_BRANCH_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
    return res;
  } catch (err) {
    return barberApiError(err, "branches/switch:POST");
  }
}
