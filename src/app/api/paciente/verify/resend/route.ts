// POST /api/paciente/verify/resend — Implementa A3.
// Body: { email }. SIEMPRE responde 200 { ok: true } (sin enumeración de cuentas).
// · rateLimit(req, 3) — es envío de email, límite agresivo.
// · Si existe cuenta NO verificada: código nuevo (sha256 + expiry 15 min,
//   verifyAttempts=0) + sendEmail(buildVerifyCodeEmail(...)).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { generateVerifyCode, sha256 } from "@/lib/patient-portal/crypto";
import { buildVerifyCodeEmail } from "@/lib/patient-portal/emails";
import { VERIFY_CODE_TTL_MIN } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(req, 3);
    if (rl) return rl;

    const body = await req.json().catch(() => null);
    const email =
      body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (email) {
      const account = await prisma.patientAccount.findUnique({ where: { email } });
      if (account && !account.emailVerified) {
        const code = generateVerifyCode();
        await prisma.patientAccount.update({
          where: { id: account.id },
          data: {
            verifyCodeHash: sha256(code),
            verifyCodeExpiry: new Date(Date.now() + VERIFY_CODE_TTL_MIN * 60_000),
            verifyAttempts: 0,
          },
        });
        try {
          const mail = buildVerifyCodeEmail({ name: account.name, code });
          await sendEmail({
            to: account.email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          });
        } catch (err) {
          console.error("[paciente/verify/resend] sendEmail failed:", err);
        }
      }
    }

    // SIEMPRE 200 — sin enumeración de cuentas.
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Mismo shape de éxito también ante error interno (contrato: 200 siempre).
    console.error("[paciente/verify/resend] error:", err);
    return NextResponse.json({ ok: true });
  }
}
