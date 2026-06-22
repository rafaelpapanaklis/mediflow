import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

// POST /api/auth/2fa/clinic-policy — exigir (o no) 2FA a todo el equipo.
// Solo ADMIN / SUPER_ADMIN. Cuando require2fa=true, el layout fuerza el
// enrolamiento de cualquier usuario sin 2FA al entrar al panel.
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 10, 15 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const require2fa = body?.require2fa;
  if (typeof require2fa !== "boolean") {
    return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
  }

  await prisma.clinic.update({ where: { id: ctx!.clinicId }, data: { require2fa } });
  return NextResponse.json({ ok: true, require2fa });
}
