import { NextRequest, NextResponse } from "next/server";
import { authenticator } from "otplib";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const { step, password, totp } = await req.json();

  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminTotp     = process.env.ADMIN_TOTP_SECRET;
  const adminToken    = process.env.ADMIN_SECRET_TOKEN;

  if (!adminPassword || !adminTotp || !adminToken) {
    return NextResponse.json({ error: "Admin no configurado. Agrega las variables de entorno." }, { status: 500 });
  }

  if (step === "password") {
    if (password !== adminPassword) {
      // Delay to prevent brute force
      await new Promise(r => setTimeout(r, 1000));
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  if (step === "totp") {
    if (password !== adminPassword) {
      return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
    }

    const isValid = authenticator.verify({ token: totp, secret: adminTotp });
    if (!isValid) {
      return NextResponse.json({ error: "Código 2FA incorrecto o expirado" }, { status: 401 });
    }

    // Set admin cookie valid for 8 hours
    const cookieStore = cookies();
    cookieStore.set("admin_token", adminToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge:   60 * 60 * 8,
      path:     "/",
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Paso inválido" }, { status: 400 });
}
