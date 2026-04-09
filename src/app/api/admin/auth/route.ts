import { NextRequest, NextResponse } from "next/server";
import { authenticator } from "otplib";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5); // 5 requests per minute per IP
  if (rl) return rl;

  const { step, password, totp } = await req.json();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminTotp     = process.env.ADMIN_TOTP_SECRET;
  const adminToken    = process.env.ADMIN_SECRET_TOKEN;

  if (!adminPassword || !adminTotp || !adminToken) {
    return NextResponse.json({ error: "Admin no configurado. Agrega las variables de entorno ADMIN_PASSWORD, ADMIN_TOTP_SECRET y ADMIN_SECRET_TOKEN en Vercel." }, { status: 500 });
  }

  if (step === "password") {
    if (password !== adminPassword) {
      await new Promise(r => setTimeout(r, 1000));
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  if (step === "totp") {
    if (password !== adminPassword) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    // Verify TOTP using otplib
    let isValid = false;
    try {
      authenticator.options = { window: 1 }; // Allow 30s window
      isValid = authenticator.verify({ token: totp, secret: adminTotp });
    } catch {
      isValid = false;
    }

    if (!isValid) return NextResponse.json({ error: "Código 2FA incorrecto o expirado" }, { status: 401 });

    const response = NextResponse.json({ ok: true });
    response.cookies.set("admin_token", adminToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 8,
      path: "/",
    });
    return response;
  }

  return NextResponse.json({ error: "Paso inválido" }, { status: 400 });
}
