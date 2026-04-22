import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { rateLimit } from "@/lib/rate-limit";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Minimal TOTP verification without otplib (avoids Edge/serverless compatibility issues).
 * Implements RFC 6238 TOTP with a 30-second step and ±1 window.
 */
function verifyTOTP(token: string, secret: string): boolean {
  try {
    const epoch = Math.floor(Date.now() / 1000);
    const step = 30;
    // Decode base32 secret
    const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const cleanSecret = secret.replace(/[\s=-]+/g, "").toUpperCase();
    let bits = "";
    for (const c of cleanSecret) {
      const val = base32Chars.indexOf(c);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substring(i, i + 8), 2));
    }
    const keyBuf = Buffer.from(bytes);

    // Check current time ± 1 window
    for (let w = -1; w <= 1; w++) {
      const counter = Math.floor(epoch / step) + w;
      const counterBuf = Buffer.alloc(8);
      counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
      counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

      const hmac = createHmac("sha1", keyBuf).update(counterBuf).digest();
      const offset = hmac[hmac.length - 1] & 0x0f;
      const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
      const codeStr = code.toString().padStart(6, "0");

      if (codeStr === token) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(req, 3, 15 * 60 * 1000);
    if (rl) return rl;

    const { step, password, totp } = await req.json();
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminTotp     = process.env.ADMIN_TOTP_SECRET;
    const adminToken    = process.env.ADMIN_SECRET_TOKEN;

    if (!adminPassword || !adminTotp || !adminToken) {
      return NextResponse.json({ error: "Admin no configurado. Agrega ADMIN_PASSWORD, ADMIN_TOTP_SECRET y ADMIN_SECRET_TOKEN en Vercel." }, { status: 500 });
    }

    if (step === "password") {
      if (!safeEqual(String(password ?? ""), adminPassword)) {
        await new Promise(r => setTimeout(r, 1000));
        return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
      }
      return NextResponse.json({ ok: true });
    }

    if (step === "totp") {
      if (!safeEqual(String(password ?? ""), adminPassword)) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

      const isValid = verifyTOTP(totp, adminTotp);

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
  } catch (err: any) {
    console.error("Admin auth error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno de autenticación" }, { status: 500 });
  }
}
