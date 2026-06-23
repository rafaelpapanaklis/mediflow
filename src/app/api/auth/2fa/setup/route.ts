import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  getTwoFactorActor,
  generateTotpSecret,
  buildOtpauthUrl,
  makeQrDataUrl,
} from "@/lib/auth/two-factor";
import { prisma } from "@/lib/prisma";

// POST /api/auth/2fa/setup — inicia el enrolamiento.
// Genera un secret nuevo y lo guarda (totpEnabled SIGUE false → el gate no se
// activa todavía). Devuelve QR + secret para registrar en la app. Activar
// requiere /enable con un código válido.
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 8, 15 * 60 * 1000);
  if (rl) return rl;

  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (actor.user.totpEnabled) {
    return NextResponse.json(
      { error: "El 2FA ya está activo. Desactívalo antes de volver a configurarlo." },
      { status: 400 },
    );
  }

  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: actor.user.id }, data: { totpSecret: secret } });

  const otpauth = buildOtpauthUrl(secret, actor.user.email);
  const qrDataUrl = await makeQrDataUrl(otpauth);
  return NextResponse.json({ secret, qrDataUrl });
}
