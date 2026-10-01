import { NextRequest, NextResponse } from "next/server";
import {
  limitar2faPorIp,
  limitar2faPorCuenta,
  consumirTotp,
  MENSAJE_TOTP_REUSADO,
} from "@/lib/auth/two-factor-intentos";
import {
  getTwoFactorActor,
  consumeRecoveryCode,
  generateRecoveryCodes,
} from "@/lib/auth/two-factor";
import { propagarDosFactores } from "@/lib/auth/two-factor-identity";

// POST /api/auth/2fa/recovery-codes — regenera los códigos de recuperación.
// Invalida los anteriores. Exige un código actual (TOTP o un recovery vigente).
// Devuelve los nuevos en plano UNA vez.
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
  if (!actor.user.totpEnabled || !secret) {
    return NextResponse.json({ error: "El 2FA no está activo." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "");

  // ws1-t8 · M3: TOTP de un solo uso, como en el reto.
  const totp = await consumirTotp(actor.supabaseId, code, secret);
  if (totp === "reusado") return NextResponse.json({ error: MENSAJE_TOTP_REUSADO }, { status: 400 });
  let ok = totp === "ok";
  if (!ok) ok = (await consumeRecoveryCode(code, actor.user.recoveryCodes ?? [])).ok;
  if (!ok) return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });

  const { plain, hashes } = await generateRecoveryCodes();
  // EQ-02: regenerar invalida los anteriores en TODAS sus sedes. Si no, los
  // códigos viejos seguirían sirviendo en las otras filas de la misma persona,
  // que es justo lo que "invalida los anteriores" promete que no pasa.
  await propagarDosFactores(actor.supabaseId, { recoveryCodes: hashes });
  return NextResponse.json({ ok: true, recoveryCodes: plain });
}
