// POST /api/paciente/password/forgot — Implementa A1.
// Body: { email }. SIEMPRE 200 { ok: true } (sin enumeración).
// · rateLimit(req, 3).
// · Si la cuenta existe (verificada o no): generateResetToken(), guardar
//   sha256 + expiry 60 min, sendEmail(buildResetPasswordEmail({ resetUrl })).
//   resetUrl = `${origin}/paciente/recuperar?token=${token}` — origin del
//   request (req.nextUrl.origin) o NEXT_PUBLIC_APP_URL si existe.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { generateResetToken, sha256 } from "@/lib/patient-portal/crypto";
import { buildResetPasswordEmail } from "@/lib/patient-portal/emails";
import { RESET_TOKEN_TTL_MIN } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(req, 3);
    if (limited) return limited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (email) {
      const account = await prisma.patientAccount.findUnique({ where: { email } });
      if (account) {
        const token = generateResetToken();
        await prisma.patientAccount.update({
          where: { id: account.id },
          data: {
            resetTokenHash: sha256(token),
            resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000),
          },
        });

        const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, "");
        const resetUrl = `${origin}/paciente/recuperar?token=${token}`;

        try {
          const content = buildResetPasswordEmail({ name: account.name, resetUrl });
          await sendEmail({
            to: account.email,
            subject: content.subject,
            html: content.html,
            text: content.text,
          });
        } catch (err) {
          console.error("[paciente/password/forgot] sendEmail error:", err);
        }
      }
    }

    // SIEMPRE 200 (sin enumeración de cuentas).
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[paciente/password/forgot] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
