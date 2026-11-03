// POST /api/paciente/verify — Implementa A3.
// Body: VerifyBody { email, code, password }.
// · rateLimit anti-flood (15/60s); el lockout (5.º fallo) corta antes.
// · Buscar cuenta por email lowercase. Si no existe o ya verificada sin código
//   pendiente → 400 genérico { error: "Código inválido o expirado" }.
// · Validar: verifyAttempts < VERIFY_MAX_ATTEMPTS (si excede → 429 y pedir
//   reenviar), verifyCodeExpiry > ahora, sha256(code) === verifyCodeHash.
//   Código incorrecto → incrementar verifyAttempts y 400.
// · La contraseña de la cuenta tiene que ser la que se manda (pre-secuestro,
//   auditoría ola 3): quien verifica es quien fijó la credencial, no cualquiera
//   que haya vuelto a registrar el correo.
// · Éxito: emailVerified=true, limpiar verify*, autoLinkPatientsByEmail(),
//   createPatientSession() + Set-Cookie patient_session (auto-login) → 200 { ok: true }.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit, failbanGuard, recordAuthFailure, recordAuthSuccess, AUTH_FLOOD_RATE_LIMIT } from "@/lib/failban";
import { sha256, verifyPassword } from "@/lib/patient-portal/crypto";
import { createPatientSession, sessionCookieOptions } from "@/lib/patient-portal/session";
import { autoLinkPatientsByEmail } from "@/lib/patient-portal/link";
import { PATIENT_SESSION_COOKIE, VERIFY_MAX_ATTEMPTS } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Anti-flood GENEROSO: el lockout (5.º fallo) + el gate de verifyAttempts
    // cortan antes que esto.
    const rl = await persistentRateLimit(req, AUTH_FLOOD_RATE_LIMIT);
    if (rl) return rl;

    const body = await req.json().catch(() => null);
    const email =
      body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = body && typeof body.code === "string" ? body.code.trim() : "";
    const password = body && typeof body.password === "string" ? body.password : "";
    if (!email || !code || !password) {
      return NextResponse.json({ error: "Código inválido o expirado" }, { status: 400 });
    }

    // Lockout por fallos (IP + cuenta), antes de tocar la BD.
    const locked = await failbanGuard(req, { scope: "paciente-verify", account: email });
    if (locked) return locked;

    const account = await prisma.patientAccount.findUnique({ where: { email } });
    if (!account) {
      return NextResponse.json({ error: "Código inválido o expirado" }, { status: 400 });
    }
    if (account.emailVerified) {
      return NextResponse.json(
        { error: "Esta cuenta ya está verificada. Inicia sesión." },
        { status: 400 },
      );
    }
    if (!account.verifyCodeHash) {
      return NextResponse.json({ error: "Código inválido o expirado" }, { status: 400 });
    }
    if (account.verifyAttempts >= VERIFY_MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "Demasiados intentos. Pide un código nuevo." },
        { status: 429 },
      );
    }
    if (!account.verifyCodeExpiry || account.verifyCodeExpiry.getTime() < Date.now()) {
      return NextResponse.json({ error: "Código inválido o expirado" }, { status: 400 });
    }
    // Seguridad (auditoría ola 3, ALTA «pre-secuestro»): el código solo prueba el
    // BUZÓN. Antes bastaba con él, así que quien volvía a registrar el correo de
    // la víctima con SU contraseña se quedaba con la cuenta en cuanto la víctima
    // tecleaba el código. Ahora la verificación también exige la contraseña de la
    // cuenta: verifica quien la fijó. Las dos cosas se comprueban siempre (mismo
    // bcrypt) y fallan con el mismo mensaje, que no dice cuál de las dos falló.
    const codigoOk = sha256(code) === account.verifyCodeHash;
    const passwordOk = account.passwordHash
      ? await verifyPassword(password, account.passwordHash).catch(() => false)
      : false;
    if (!codigoOk || !passwordOk) {
      await prisma.patientAccount.update({
        where: { id: account.id },
        data: { verifyAttempts: { increment: 1 } },
      });
      await recordAuthFailure(req, { scope: "paciente-verify", account: email });
      return NextResponse.json(
        {
          error:
            "El código o la contraseña no son correctos. Usa la contraseña con la que te registraste; " +
            "si no la recuerdas, entra a «Olvidé mi contraseña».",
        },
        { status: 400 },
      );
    }

    // Éxito: marcar verificada y limpiar el estado de verificación.
    await prisma.patientAccount.update({
      where: { id: account.id },
      data: {
        emailVerified: true,
        verifyCodeHash: null,
        verifyCodeExpiry: null,
        verifyAttempts: 0,
      },
    });

    // Verificación correcta → resetea contadores de fallo (IP + cuenta).
    await recordAuthSuccess(req, { scope: "paciente-verify", account: email });

    // Auto-link de expedientes por email verificado (best-effort, no rompe).
    await autoLinkPatientsByEmail(account.id, account.email);

    // Auto-login: sesión nueva + cookie httpOnly.
    const { token, expiresAt } = await createPatientSession(account.id);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(PATIENT_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return res;
  } catch (err) {
    console.error("[paciente/verify] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
