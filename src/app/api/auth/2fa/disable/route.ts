import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getTwoFactorActor, verifyTotp, consumeRecoveryCode } from "@/lib/auth/two-factor";
import { clearAllTwoFactorCookies } from "@/lib/auth/two-factor-cookie";
import { prisma } from "@/lib/prisma";

// POST /api/auth/2fa/disable — desactiva el 2FA del usuario.
// Exige un código actual (TOTP o recovery). Bloqueado si la clínica exige 2FA
// (require2fa): primero un admin debe quitar la política (clinic-policy).
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 8, 15 * 60 * 1000);
  if (rl) return rl;

  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const secret = actor.user.totpSecret as string | null;
  if (!actor.user.totpEnabled || !secret) {
    return NextResponse.json({ error: "El 2FA no está activo." }, { status: 400 });
  }
  if (actor.user.clinic?.require2fa) {
    return NextResponse.json(
      { error: "Tu clínica exige 2FA; pide a un administrador que desactive la política primero." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "");

  let ok = verifyTotp(code, secret);
  if (!ok) ok = (await consumeRecoveryCode(code, actor.user.recoveryCodes ?? [])).ok;
  if (!ok) return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });

  await prisma.user.update({
    where: { id: actor.user.id },
    data: { totpEnabled: false, totpSecret: null, recoveryCodes: [] },
  });

  const res = NextResponse.json({ ok: true });
  clearAllTwoFactorCookies(res);
  return res;
}
