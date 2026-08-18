import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getTwoFactorActor, verifyTotp, consumeRecoveryCode } from "@/lib/auth/two-factor";
import { setTwoFactorOkCookie } from "@/lib/auth/two-factor-cookie";
import { propagarDosFactores } from "@/lib/auth/two-factor-identity";

// POST /api/auth/2fa/verify — reto de login (segundo factor).
// Valida TOTP o un recovery code (de un solo uso). En éxito emite df_2fa (2FA
// superado) y limpia el flag pendiente. Errores genéricos + rate limit estricto
// (anti fuerza bruta). El gate del layout depende de la cookie df_2fa, no de
// este endpoint, así que no se puede "saltar" sin pasar por aquí.
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 15 * 60 * 1000);
  if (rl) return rl;

  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const secret = actor.user.totpSecret as string | null;
  // Sin 2FA activo no hay nada que verificar — respuesta genérica.
  if (!actor.user.totpEnabled || !secret) {
    return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "");

  let ok = verifyTotp(code, secret);
  if (!ok) {
    const r = await consumeRecoveryCode(code, actor.user.recoveryCodes ?? []);
    if (r.ok) {
      ok = true;
      // EQ-02: el código de recuperación es de UN SOLO USO, y eso tiene que
      // valer para la persona entera. Consumirlo solo en la fila activa dejaba
      // el mismo código intacto en sus otras sedes, listo para reutilizarse.
      await propagarDosFactores(actor.supabaseId, { recoveryCodes: r.remaining });
    }
  }
  if (!ok) return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  setTwoFactorOkCookie(res, actor.supabaseId, actor.user.clinicId);
  return res;
}
