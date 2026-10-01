import { NextRequest, NextResponse } from "next/server";
import { limitar2faPorIp, limitar2faSetup } from "@/lib/auth/two-factor-intentos";
import {
  getTwoFactorActor,
  generateTotpSecret,
  buildOtpauthUrl,
  makeQrDataUrl,
} from "@/lib/auth/two-factor";
import { propagarDosFactores } from "@/lib/auth/two-factor-identity";

// POST /api/auth/2fa/setup — inicia el enrolamiento.
// Genera un secret nuevo y lo guarda (totpEnabled SIGUE false → el gate no se
// activa todavía). Devuelve QR + secret para registrar en la app. Activar
// requiere /enable con un código válido.
export async function POST(req: NextRequest) {
  // ws1-t8 · M3: límite persistente por IP y por persona (no en memoria).
  const rlIp = await limitar2faPorIp(req);
  if (rlIp) return rlIp;

  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rlSetup = await limitar2faSetup(req, actor.supabaseId);
  if (rlSetup) return rlSetup;

  if (actor.user.totpEnabled) {
    return NextResponse.json(
      { error: "El 2FA ya está activo. Desactívalo antes de volver a configurarlo." },
      { status: 400 },
    );
  }

  const secret = generateTotpSecret();
  // EQ-02: a TODAS sus sedes. El segundo factor protege la identidad, que es
  // global (una contraseña de Supabase para todas sus filas User); guardarlo
  // solo en la fila de la clínica activa dejaba a las hermanas sin él.
  await propagarDosFactores(actor.supabaseId, { totpSecret: secret });

  const otpauth = buildOtpauthUrl(secret, actor.user.email);
  const qrDataUrl = await makeQrDataUrl(otpauth);
  return NextResponse.json({ secret, qrDataUrl });
}
