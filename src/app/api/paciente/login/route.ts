// POST /api/paciente/login — Implementa A1. CONTRATO FIJO.
// Body: LoginBody { email, password }.
// · rateLimit anti-flood (15/60s); el lockout (5.º fallo) corta antes.
// · email lowercase. Cuenta inexistente o password mal → 401 { error } genérico
//   (mismo mensaje, sin enumeración). verifyPassword SIEMPRE que haya cuenta.
// · Cuenta sin verificar → 403 { error, needsVerification: true } (la UI manda
//   a /paciente/verificar).
// · Éxito: createPatientSession + Set-Cookie patient_session + lastLoginAt +
//   autoLinkPatientsByEmail (best-effort, por si hay expedientes nuevos)
//   → 200 { ok: true }.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit, failbanGuard, recordAuthFailure, recordAuthSuccess, AUTH_FLOOD_RATE_LIMIT } from "@/lib/failban";
import { verifyPassword } from "@/lib/patient-portal/crypto";
import { createPatientSession, sessionCookieOptions } from "@/lib/patient-portal/session";
import { autoLinkPatientsByEmail } from "@/lib/patient-portal/link";
import { PATIENT_SESSION_COOKIE } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Anti-flood GENEROSO: el lockout (5.º fallo + backoff) corta antes que esto.
    const limited = await persistentRateLimit(req, AUTH_FLOOD_RATE_LIMIT);
    if (limited) return limited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // Lockout por fallos: bloquea por IP y por cuenta (email) ANTES de validar.
    const locked = await failbanGuard(req, { scope: "paciente-login", account: email });
    if (locked) return locked;

    // Mensaje genérico idéntico (sin enumeración) para cualquier credencial mala.
    if (!email || !password) {
      await recordAuthFailure(req, { scope: "paciente-login", account: email });
      return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
    }

    const account = await prisma.patientAccount.findUnique({ where: { email } });
    if (!account) {
      await recordAuthFailure(req, { scope: "paciente-login", account: email });
      return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
    }

    // Cuenta INVITADA por la clínica que aún no fija su contraseña (passwordHash
    // null). NO es una credencial inválida: damos un mensaje claro para que
    // active desde el correo de invitación. No cuenta como fallo (no bump) —
    // evita que se pueda lockear una cuenta que ni siquiera tiene contraseña.
    if (account.passwordHash === null) {
      return NextResponse.json(
        {
          error:
            "Aún no activas tu cuenta. Revisa el correo de invitación de tu clínica o pide que te reenvíen el acceso.",
          needsActivation: true,
        },
        { status: 403 },
      );
    }

    const passwordOk = await verifyPassword(password, account.passwordHash);
    if (!passwordOk) {
      await recordAuthFailure(req, { scope: "paciente-login", account: email });
      return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
    }

    if (!account.emailVerified) {
      return NextResponse.json(
        { error: "Confirma tu correo para continuar", needsVerification: true },
        { status: 403 }
      );
    }

    const { token, expiresAt } = await createPatientSession(account.id);

    await prisma.patientAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });

    // Best-effort: vincula expedientes nuevos que coincidan con el email verificado.
    try {
      await autoLinkPatientsByEmail(account.id, account.email);
    } catch (err) {
      console.error("[paciente/login] autoLinkPatientsByEmail error:", err);
    }

    // Éxito → resetea contadores de fallo (IP + cuenta).
    await recordAuthSuccess(req, { scope: "paciente-login", account: email });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(PATIENT_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return res;
  } catch (err) {
    console.error("[paciente/login] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
