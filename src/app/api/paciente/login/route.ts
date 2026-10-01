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

// B3 (auditoría 30-sep-2026): una cuenta inexistente, una invitada sin contraseña
// y una contraseña mala responden IGUAL (mismo código, mismo texto, mismo costo
// de bcrypt y mismo conteo de fallos): ni el mensaje ni el tiempo dicen si el
// correo tiene cuenta. El texto incluye la salida para quien fue invitado por su
// clínica y aún no activa (usar «Olvidé mi contraseña»), sin confirmar que lo sea.
const CREDENCIALES_MALAS =
  "Correo o contraseña incorrectos. Si tu clínica te invitó y aún no activas tu cuenta, usa «Olvidé mi contraseña».";

// Hash bcrypt (costo 10) de un valor al azar: se compara contra él cuando no hay
// hash real, para que el login de un correo inexistente cueste lo mismo.
const HASH_DE_RELLENO = "$2b$10$N7h0KQjkJEnolSrcY7b52eIaO0rHo4xIzE9Ef8YrNU.Zg0OcBa5ti";

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
      return NextResponse.json({ error: CREDENCIALES_MALAS }, { status: 401 });
    }

    const account = await prisma.patientAccount.findUnique({ where: { email } });
    if (!account || account.passwordHash === null) {
      // Inexistente, o invitada por la clínica que aún no fija contraseña: misma
      // respuesta que una contraseña mala, con el mismo costo de bcrypt.
      await verifyPassword(password, HASH_DE_RELLENO).catch(() => false);
      await recordAuthFailure(req, { scope: "paciente-login", account: email });
      return NextResponse.json({ error: CREDENCIALES_MALAS }, { status: 401 });
    }

    const passwordOk = await verifyPassword(password, account.passwordHash);
    if (!passwordOk) {
      await recordAuthFailure(req, { scope: "paciente-login", account: email });
      return NextResponse.json({ error: CREDENCIALES_MALAS }, { status: 401 });
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
