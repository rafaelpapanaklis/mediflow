import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { persistentRateLimit, failbanGuard, recordAuthFailure, recordAuthSuccess, AUTH_FLOOD_RATE_LIMIT } from "@/lib/failban";
import { extractAuditMeta } from "@/lib/audit";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  ensureSeedAdmin,
  findAdminByPassword,
  createAdminSession,
} from "@/lib/admin-auth";

/**
 * Minimal TOTP verification without otplib (avoids Edge/serverless compatibility
 * issues). Implements RFC 6238 TOTP with a 30-second step and ±1 window.
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

/**
 * WS2-T3 · Login admin contra AdminUser (BD) + sesión real.
 *
 * Mantiene el contrato de 2 pasos del formulario (step: "password" | "totp"),
 * el rate-limit anti-flood (15/60s), el lockout con backoff (al 5.º fallo) y el
 * delay anti-bruteforce. La UI no pide email: se
 * identifica al admin por contraseña (bcrypt) entre los admins activos. Al éxito
 * se crea una AdminSession y la cookie admin_token lleva el token ALEATORIO en
 * claro (httpOnly, 8h) — su sha256 vive en BD.
 */
export async function POST(req: NextRequest) {
  try {
    // Anti-flood GENEROSO: NO debe cortar antes que el lockout. La fuerza bruta
    // la frena el lockout de abajo (5.º fallo + backoff), no este límite.
    const rl = await persistentRateLimit(req, AUTH_FLOOD_RATE_LIMIT);
    if (rl) return rl;

    // Lockout por fallos. En el paso "password" el admin aún no está
    // identificado (la UI no pide usuario), así que el guard es por IP.
    const locked = await failbanGuard(req, { scope: "admin-auth" });
    if (locked) return locked;

    const { step, password, totp } = await req.json();
    const pwd = String(password ?? "");

    // Semilla idempotente: si no hay ningún AdminUser, crea el primero desde las
    // envs actuales (ADMIN_PASSWORD + ADMIN_TOTP_SECRET) para no perder acceso.
    const hasAdmin = await ensureSeedAdmin();
    if (!hasAdmin) {
      return NextResponse.json(
        { error: "Admin no configurado. Agrega ADMIN_PASSWORD (y ADMIN_TOTP_SECRET) en Vercel para crear el primer administrador." },
        { status: 500 },
      );
    }

    if (step === "password") {
      const admin = await findAdminByPassword(pwd);
      if (!admin) {
        await recordAuthFailure(req, { scope: "admin-auth" });
        await new Promise((r) => setTimeout(r, 1000)); // anti-bruteforce
        return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
      }
      return NextResponse.json({ ok: true });
    }

    if (step === "totp") {
      const admin = await findAdminByPassword(pwd);
      if (!admin) {
        await recordAuthFailure(req, { scope: "admin-auth" });
        return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
      }

      // TOTP por usuario: si el admin tiene 2FA habilitado es obligatorio.
      if (admin.totpEnabled) {
        if (!admin.totpSecret || !verifyTOTP(String(totp ?? ""), admin.totpSecret)) {
          // Ya conocemos al admin → cuenta el fallo por IP y por cuenta.
          await recordAuthFailure(req, { scope: "admin-auth", account: admin.id });
          return NextResponse.json({ error: "Código 2FA incorrecto o expirado" }, { status: 401 });
        }
      }

      const meta = extractAuditMeta(req);
      const { token } = await createAdminSession(admin.id, {
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      const response = NextResponse.json({ ok: true });
      response.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
      // Login completo OK → resetea contadores de fallo (IP + cuenta).
      await recordAuthSuccess(req, { scope: "admin-auth", account: admin.id });
      return response;
    }

    return NextResponse.json({ error: "Paso inválido" }, { status: 400 });
  } catch (err: any) {
    console.error("Admin auth error:", err);
    return NextResponse.json({ error: err?.message ?? "Error interno de autenticación" }, { status: 500 });
  }
}
