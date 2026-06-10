// POST /api/paciente/register — Implementa A3.
// Body: RegisterBody { name, email, phone, password (≥8) }.
// · rateLimit(req, 5) (mismo helper de src/lib/rate-limit.ts).
// · email → trim().toLowerCase(). Validar shape a mano (typeof) como los
//   registros de laboratorios/proveedores.
// · Si existe cuenta con emailVerified=true → 409 { error }.
// · Si existe SIN verificar → actualizar name/phone/passwordHash + código nuevo.
// · Si no existe → crear PatientAccount (emailVerified false).
// · Generar código 6 dígitos (crypto.ts), guardar sha256 + expiry 15 min +
//   verifyAttempts=0, enviar con sendEmail(buildVerifyCodeEmail(...)).
// · 200 { ok: true, email } (la UI navega a /paciente/verificar?email=...&next=...).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { hashPassword, generateVerifyCode, sha256 } from "@/lib/patient-portal/crypto";
import { buildVerifyCodeEmail } from "@/lib/patient-portal/emails";
import { VERIFY_CODE_TTL_MIN } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(req, 5);
    if (rl) return rl;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phoneRaw = typeof body.phone === "string" ? body.phone : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (name.length < 2 || name.length > 120) {
      return NextResponse.json(
        { error: "El nombre debe tener entre 2 y 120 caracteres" },
        { status: 400 },
      );
    }
    if (!/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: "Correo inválido" }, { status: 400 });
    }
    const cleanPhone = phoneRaw.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      return NextResponse.json(
        { error: "Teléfono inválido — mínimo 10 dígitos" },
        { status: 400 },
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 8 caracteres" },
        { status: 400 },
      );
    }

    const existing = await prisma.patientAccount.findUnique({ where: { email } });
    if (existing && existing.emailVerified) {
      return NextResponse.json(
        { error: "Este correo ya tiene una cuenta. Inicia sesión." },
        { status: 409 },
      );
    }

    const code = generateVerifyCode();
    const passwordHash = await hashPassword(password);
    const accountData = {
      name,
      phone: cleanPhone,
      passwordHash,
      verifyCodeHash: sha256(code),
      verifyCodeExpiry: new Date(Date.now() + VERIFY_CODE_TTL_MIN * 60_000),
      verifyAttempts: 0,
    };

    if (existing) {
      // Cuenta sin verificar: se re-registra con datos y código nuevos.
      await prisma.patientAccount.update({ where: { id: existing.id }, data: accountData });
    } else {
      try {
        await prisma.patientAccount.create({
          data: { email, emailVerified: false, ...accountData },
        });
      } catch (err: any) {
        if (err && err.code === "P2002") {
          // Carrera: otra petición creó la cuenta entre el check y el create.
          const raced = await prisma.patientAccount.findUnique({ where: { email } });
          if (!raced || raced.emailVerified) {
            return NextResponse.json(
              { error: "Este correo ya tiene una cuenta. Inicia sesión." },
              { status: 409 },
            );
          }
          await prisma.patientAccount.update({ where: { id: raced.id }, data: accountData });
        } else {
          throw err;
        }
      }
    }

    // Si el email falla igual respondemos 200 (sendEmail ya degrada a stub).
    try {
      const mail = buildVerifyCodeEmail({ name, code });
      await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
    } catch (err) {
      console.error("[paciente/register] sendEmail failed:", err);
    }

    return NextResponse.json({ ok: true, email });
  } catch (err) {
    console.error("[paciente/register] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
