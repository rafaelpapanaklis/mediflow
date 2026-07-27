// POST /api/paciente/password/reset — Implementa A1.
// Body: ResetPasswordBody { token, password (≥8) }.
// · rateLimit(req, 5).
// · Buscar cuenta por resetTokenHash = sha256(token) Y resetTokenExpiry > ahora.
//   No encontrada → 400 { error: "El enlace expiró o no es válido" }.
// · Éxito: passwordHash nuevo, limpiar resetToken*, destroyAllSessions(accountId)
//   (cierra sesiones viejas) → 200 { ok: true }. La UI manda a login.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { hashPassword, sha256 } from "@/lib/patient-portal/crypto";
import { destroyAllSessions } from "@/lib/patient-portal/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(req, 5);
    if (limited) return limited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
    }

    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!token) {
      return NextResponse.json({ error: "El enlace expiró o no es válido" }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 8 caracteres" },
        { status: 400 }
      );
    }

    const account = await prisma.patientAccount.findFirst({
      where: {
        resetTokenHash: sha256(token),
        resetTokenExpiry: { gt: new Date() },
      },
      select: { id: true, passwordHash: true },
    });

    if (!account) {
      return NextResponse.json({ error: "El enlace expiró o no es válido" }, { status: 400 });
    }

    // Si la cuenta venía INVITADA (sin contraseña), al fijarla el paciente probó
    // que controla el email → la verificamos y limpiamos la marca de invitación.
    // En un reset normal (passwordHash ya seteado) NO tocamos esos campos.
    const wasInvited = account.passwordHash === null;

    const passwordHash = await hashPassword(password);
    await prisma.patientAccount.update({
      where: { id: account.id },
      data: {
        passwordHash,
        resetTokenHash: null,
        resetTokenExpiry: null,
        ...(wasInvited ? { emailVerified: true, invitedAt: null } : {}),
      },
    });

    // Cierra todas las sesiones viejas; la UI manda a login.
    await destroyAllSessions(account.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[paciente/password/reset] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
