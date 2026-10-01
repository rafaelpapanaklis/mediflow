import { NextRequest, NextResponse } from "next/server";
import {
  limitar2faPorIp,
  limitar2faPorCuenta,
  consumirTotp,
  MENSAJE_TOTP_REUSADO,
} from "@/lib/auth/two-factor-intentos";
import { getTwoFactorActor, consumeRecoveryCode } from "@/lib/auth/two-factor";
import { setTwoFactorOkCookie } from "@/lib/auth/two-factor-cookie";
import { propagarDosFactores } from "@/lib/auth/two-factor-identity";

// POST /api/auth/2fa/verify — reto de login (segundo factor).
// Valida TOTP o un recovery code (de un solo uso). En éxito emite df_2fa (2FA
// superado) y limpia el flag pendiente. Errores genéricos + rate limit estricto
// (anti fuerza bruta). El gate del layout depende de la cookie df_2fa, no de
// este endpoint, así que no se puede "saltar" sin pasar por aquí.
export async function POST(req: NextRequest) {
  // ws1-t8 · M3: límite PERSISTENTE (no en memoria por IP e instancia):
  // anti-ráfaga por IP antes de la sesión y presupuesto por CUENTA después,
  // compartido con las demás rutas que validan códigos.
  const rlIp = await limitar2faPorIp(req);
  if (rlIp) return rlIp;

  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rlCuenta = await limitar2faPorCuenta(req, actor.supabaseId);
  if (rlCuenta) return rlCuenta;

  const secret = actor.user.totpSecret as string | null;
  // Sin 2FA activo no hay nada que verificar — respuesta genérica.
  if (!actor.user.totpEnabled || !secret) {
    return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "");

  // ws1-t8 · M3: el TOTP es de UN SOLO USO por persona.
  const totp = await consumirTotp(actor.supabaseId, code, secret);
  if (totp === "reusado") return NextResponse.json({ error: MENSAJE_TOTP_REUSADO }, { status: 400 });
  let ok = totp === "ok";
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
