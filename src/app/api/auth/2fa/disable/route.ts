import { NextRequest, NextResponse } from "next/server";
import {
  limitar2faPorIp,
  limitar2faPorCuenta,
  consumirTotp,
  MENSAJE_TOTP_REUSADO,
} from "@/lib/auth/two-factor-intentos";
import { getTwoFactorActor, consumeRecoveryCode } from "@/lib/auth/two-factor";
import { clearAllTwoFactorCookies } from "@/lib/auth/two-factor-cookie";
import { propagarDosFactores } from "@/lib/auth/two-factor-identity";

// POST /api/auth/2fa/disable — desactiva el 2FA del usuario.
// Exige un código actual (TOTP o recovery). Bloqueado si la clínica exige 2FA
// (require2fa): primero un admin debe quitar la política (clinic-policy).
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
  // EQ-02: apagar el 2FA lo apaga en TODAS sus sedes, así que la política de
  // CUALQUIERA de ellas lo bloquea. Mirar solo la clínica activa dejaba una
  // salida: quien tiene una sede con require2fa y otra sin él se cambiaba a la
  // segunda y desde ahí se quitaba el segundo factor de las dos.
  if (actor.persona.algunaClinicaLoExige) {
    return NextResponse.json(
      { error: "Una de tus clínicas exige 2FA; pide a un administrador que desactive la política primero." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "");

  // ws1-t8 · M3: TOTP de un solo uso, como en el reto.
  const totp = await consumirTotp(actor.supabaseId, code, secret);
  if (totp === "reusado") return NextResponse.json({ error: MENSAJE_TOTP_REUSADO }, { status: 400 });
  let ok = totp === "ok";
  if (!ok) ok = (await consumeRecoveryCode(code, actor.user.recoveryCodes ?? [])).ok;
  if (!ok) return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });

  await propagarDosFactores(actor.supabaseId, {
    totpEnabled: false, totpSecret: null, recoveryCodes: [],
  });

  const res = NextResponse.json({ ok: true });
  clearAllTwoFactorCookies(res);
  return res;
}
