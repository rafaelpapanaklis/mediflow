import { authenticator } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { RECOVERY_CODE_COUNT } from "./two-factor-constants";

// Núcleo TOTP + recovery codes. Usa otplib/bcrypt/qrcode ⇒ SOLO route handlers
// (Node), nunca middleware (Edge). El admin (api/admin/auth) implementa TOTP a
// mano por Edge; aquí, al ser route handlers Node, otplib es seguro.

// Ventana ±1 step (±30 s) — tolera el desfase de reloj del teléfono.
authenticator.options = { window: 1 };

const ISSUER = "DaleControl";

export function generateTotpSecret(): string {
  return authenticator.generateSecret(); // base32
}

export function buildOtpauthUrl(secret: string, accountLabel: string): string {
  // otpauth://totp/DaleControl:<label>?secret=...&issuer=DaleControl
  return authenticator.keyuri(accountLabel || "usuario", ISSUER, secret);
}

export async function makeQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 224 });
}

// Valida un TOTP de 6 dígitos contra el secret. Genérico ante cualquier
// formato inválido (no lanza).
export function verifyTotp(token: string, secret: string): boolean {
  if (!secret) return false;
  const t = (token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  try {
    return authenticator.check(t, secret);
  } catch {
    return false;
  }
}

// ── Códigos de recuperación ───────────────────────────────────────
// Alfabeto sin caracteres ambiguos (0/1/l/o/i). Un código nunca colisiona con
// un TOTP (10 chars ≠ /^\d{6}$/), así el verify enruta bien TOTP vs recovery.
const RECOVERY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function rawRecoveryCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return s; // 10 chars, sin guion
}

export function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`; // xxxxx-xxxxx (presentación)
}

export function normalizeRecoveryCode(input: string): string {
  return (input || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Genera N códigos: devuelve los planos (mostrar UNA vez) y sus hashes bcrypt
// (lo único que se guarda en DB).
export async function generateRecoveryCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = rawRecoveryCode();
    plain.push(formatRecoveryCode(raw));
    hashes.push(await bcrypt.hash(raw, 10)); // hash del raw normalizado (sin guion)
  }
  return { plain, hashes };
}

// Verifica un recovery code contra los hashes. Si acierta, devuelve el set
// RESTANTE (consumido el usado) para que el caller lo persista (un solo uso).
export async function consumeRecoveryCode(
  input: string,
  hashes: string[],
): Promise<{ ok: boolean; remaining: string[] }> {
  const norm = normalizeRecoveryCode(input);
  if (norm.length < 8) return { ok: false, remaining: hashes };
  for (let i = 0; i < hashes.length; i++) {
    let match = false;
    try {
      match = await bcrypt.compare(norm, hashes[i]);
    } catch {
      match = false;
    }
    if (match) {
      return { ok: true, remaining: hashes.filter((_, j) => j !== i) };
    }
  }
  return { ok: false, remaining: hashes };
}

// ── Resolver de actor para route handlers (SIN gate 2FA) ──────────
// Devuelve la fila User de la clínica activa (misma resolución que
// getCurrentUser) pero SIN aplicar el gate — los endpoints de gestión/reto 2FA
// deben funcionar mientras el 2FA está pendiente. null ⇒ el caller responde 401.
export async function getTwoFactorActor(): Promise<{ supabaseId: string; user: any } | null> {
  const supabase = createClient();
  const {
    data: { user: sb },
  } = await supabase.auth.getUser();
  if (!sb) return null;

  const clinicId = readActiveClinicCookie();
  let user = clinicId
    ? await prisma.user.findFirst({
        where: { supabaseId: sb.id, clinicId, isActive: true },
        include: { clinic: true },
      })
    : null;
  if (!user) {
    user = await prisma.user.findFirst({
      where: { supabaseId: sb.id, isActive: true },
      include: { clinic: true },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!user) return null;
  return { supabaseId: sb.id, user };
}
