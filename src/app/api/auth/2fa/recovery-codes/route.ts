import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  getTwoFactorActor,
  verifyTotp,
  consumeRecoveryCode,
  generateRecoveryCodes,
} from "@/lib/auth/two-factor";
import { prisma } from "@/lib/prisma";

// POST /api/auth/2fa/recovery-codes — regenera los códigos de recuperación.
// Invalida los anteriores. Exige un código actual (TOTP o un recovery vigente).
// Devuelve los nuevos en plano UNA vez.
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5, 15 * 60 * 1000);
  if (rl) return rl;

  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const secret = actor.user.totpSecret as string | null;
  if (!actor.user.totpEnabled || !secret) {
    return NextResponse.json({ error: "El 2FA no está activo." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "");

  let ok = verifyTotp(code, secret);
  if (!ok) ok = (await consumeRecoveryCode(code, actor.user.recoveryCodes ?? [])).ok;
  if (!ok) return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });

  const { plain, hashes } = await generateRecoveryCodes();
  await prisma.user.update({ where: { id: actor.user.id }, data: { recoveryCodes: hashes } });
  return NextResponse.json({ ok: true, recoveryCodes: plain });
}
