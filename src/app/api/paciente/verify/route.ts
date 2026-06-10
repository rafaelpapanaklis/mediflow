// POST /api/paciente/verify — Implementa A3.
// Body: VerifyBody { email, code }.
// · rateLimit(req, 10).
// · Buscar cuenta por email lowercase. Si no existe o ya verificada sin código
//   pendiente → 400 genérico { error: "Código inválido o expirado" }.
// · Validar: verifyAttempts < VERIFY_MAX_ATTEMPTS (si excede → 429 y pedir
//   reenviar), verifyCodeExpiry > ahora, sha256(code) === verifyCodeHash.
//   Código incorrecto → incrementar verifyAttempts y 400.
// · Éxito: emailVerified=true, limpiar verify*, autoLinkPatientsByEmail(),
//   createPatientSession() + Set-Cookie patient_session (auto-login) → 200 { ok: true }.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sha256 } from "@/lib/patient-portal/crypto";
import { createPatientSession, sessionCookieOptions } from "@/lib/patient-portal/session";
import { autoLinkPatientsByEmail } from "@/lib/patient-portal/link";
import { PATIENT_SESSION_COOKIE, VERIFY_MAX_ATTEMPTS } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(req, 10);
    if (rl) return rl;

    const body = await req.json().catch(() => null);
    const email =
      body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = body && typeof body.code === "string" ? body.code.trim() : "";
    if (!email || !code) {
      return NextResponse.json({ error: "Código inválido o expirado" }, { status: 400 });
    }

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
    if (sha256(code) !== account.verifyCodeHash) {
      await prisma.patientAccount.update({
        where: { id: account.id },
        data: { verifyAttempts: { increment: 1 } },
      });
      return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });
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
