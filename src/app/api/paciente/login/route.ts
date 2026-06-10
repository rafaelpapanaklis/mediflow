// POST /api/paciente/login — Implementa A1. CONTRATO FIJO.
// Body: LoginBody { email, password }.
// · rateLimit(req, 8).
// · email lowercase. Cuenta inexistente o password mal → 401 { error } genérico
//   (mismo mensaje, sin enumeración). verifyPassword SIEMPRE que haya cuenta.
// · Cuenta sin verificar → 403 { error, needsVerification: true } (la UI manda
//   a /paciente/verificar).
// · Éxito: createPatientSession + Set-Cookie patient_session + lastLoginAt +
//   autoLinkPatientsByEmail (best-effort, por si hay expedientes nuevos)
//   → 200 { ok: true }.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { verifyPassword } from "@/lib/patient-portal/crypto";
import { createPatientSession, sessionCookieOptions } from "@/lib/patient-portal/session";
import { autoLinkPatientsByEmail } from "@/lib/patient-portal/link";
import { PATIENT_SESSION_COOKIE } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(req, 8);
    if (limited) return limited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // Mensaje genérico idéntico (sin enumeración) para cualquier credencial mala.
    if (!email || !password) {
      return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
    }

    const account = await prisma.patientAccount.findUnique({ where: { email } });
    if (!account) {
      return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
    }

    const passwordOk = await verifyPassword(password, account.passwordHash);
    if (!passwordOk) {
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

    const res = NextResponse.json({ ok: true });
    res.cookies.set(PATIENT_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return res;
  } catch (err) {
    console.error("[paciente/login] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
