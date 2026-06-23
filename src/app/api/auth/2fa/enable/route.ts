import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getTwoFactorActor, verifyTotp, generateRecoveryCodes } from "@/lib/auth/two-factor";
import { setTwoFactorOkCookie } from "@/lib/auth/two-factor-cookie";
import { prisma } from "@/lib/prisma";

// POST /api/auth/2fa/enable — confirma el enrolamiento.
// Valida un código contra el secret pendiente, marca totpEnabled=true, genera
// los recovery codes (devuelve plano UNA vez, guarda hashes) y deja la sesión
// como "2FA superado" (cookie df_2fa) para no auto-bloquear al recién enrolado.
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 8, 15 * 60 * 1000);
  if (rl) return rl;

  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "");
  const secret = actor.user.totpSecret as string | null;

  // Errores genéricos (sin distinguir "no hay secret" vs "código malo").
  if (!secret || actor.user.totpEnabled || !verifyTotp(code, secret)) {
    return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });
  }

  const { plain, hashes } = await generateRecoveryCodes();
  await prisma.user.update({
    where: { id: actor.user.id },
    data: { totpEnabled: true, recoveryCodes: hashes },
  });

  const res = NextResponse.json({ ok: true, recoveryCodes: plain });
  setTwoFactorOkCookie(res, actor.supabaseId, actor.user.clinicId);
  return res;
}
