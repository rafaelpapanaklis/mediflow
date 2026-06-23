import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  TWO_FA_COOKIE,
  TWO_FA_PENDING_COOKIE,
  TWO_FA_OK_MAX_AGE_SECONDS,
  TWO_FA_PENDING_MAX_AGE_SECONDS,
} from "./two-factor-constants";
import { packTwoFactorToken, unpackTwoFactorToken } from "./two-factor-core";

// Helpers de cookies del 2FA, lado servidor (Node):
//  - lectura para el LAYOUT / páginas del reto (hasValidTwoFactorCookie)
//  - escritura sobre la NextResponse de los route handlers (set/clear)
//  - applyTwoFactorLoginCookies: lo llaman post-login y el callback OAuth.
// No importa otplib/bcrypt/qrcode (eso vive en two-factor.ts), así el layout
// solo paga la verificación de firma.

const isProd = process.env.NODE_ENV === "production";

// Solo dependemos de `.cookies` (ResponseCookies). Pick evita acoplar al body
// genérico de NextResponse y matchea tanto NextResponse.json como .redirect.
type ResLike = Pick<NextResponse, "cookies">;

// ── Lectura (server components / route handlers) ──────────────────
// true ⇔ df_2fa presente, bien firmada, atada a ESTA (persona, clínica) y
// dentro de la vigencia. Es la prueba de "2FA superado en esta ventana".
export function hasValidTwoFactorCookie(supabaseId: string, clinicId: string): boolean {
  let raw: string | undefined;
  try {
    raw = cookies().get(TWO_FA_COOKIE)?.value;
  } catch {
    return false;
  }
  const data = unpackTwoFactorToken(raw);
  if (!data) return false;
  if (data.supabaseId !== supabaseId || data.clinicId !== clinicId) return false;
  const ageMs = Date.now() - data.iatMs;
  if (ageMs < 0 || ageMs > TWO_FA_OK_MAX_AGE_SECONDS * 1000) return false;
  return true;
}

// ── Escritura sobre la respuesta (route handlers) ─────────────────
export function setTwoFactorOkCookie(res: ResLike, supabaseId: string, clinicId: string): void {
  const token = packTwoFactorToken(supabaseId, clinicId, Date.now());
  res.cookies.set({
    name: TWO_FA_COOKIE,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: TWO_FA_OK_MAX_AGE_SECONDS,
  });
  // Superar el reto limpia el flag pendiente en la MISMA respuesta — así
  // df_2fa y df_2fa_pending nunca quedan desincronizados (evita loops).
  clearTwoFactorPending(res);
}

export function setTwoFactorPendingCookie(res: ResLike): void {
  res.cookies.set({
    name: TWO_FA_PENDING_COOKIE,
    value: "1",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: TWO_FA_PENDING_MAX_AGE_SECONDS,
  });
}

export function clearTwoFactorPending(res: ResLike): void {
  res.cookies.set({ name: TWO_FA_PENDING_COOKIE, value: "", path: "/", maxAge: 0 });
}

export function clearTwoFactorOk(res: ResLike): void {
  res.cookies.set({ name: TWO_FA_COOKIE, value: "", path: "/", maxAge: 0 });
}

export function clearAllTwoFactorCookies(res: ResLike): void {
  clearTwoFactorOk(res);
  clearTwoFactorPending(res);
}

// ── Cierre de login (post-login + callback OAuth) ─────────────────
// Tras resolver la clínica activa: si la membresía (supabaseId, clinicId) tiene
// 2FA o la clínica lo exige, marca df_2fa_pending y BORRA df_2fa (fuerza
// re-reto este login). Si no, limpia ambas. Es el fast-path del middleware; el
// layout (autoritativo) hace el gate igual aunque esto no corra.
export async function applyTwoFactorLoginCookies(
  res: ResLike,
  supabaseId: string,
  clinicId: string,
): Promise<void> {
  try {
    // Import dinámico para no arrastrar prisma a quien solo lea/escriba cookies.
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findFirst({
      where: { supabaseId, clinicId, isActive: true },
      select: { totpEnabled: true, clinic: { select: { require2fa: true } } },
    });
    const needs2fa = !!u && (u.totpEnabled || !!u.clinic?.require2fa);
    if (needs2fa) {
      setTwoFactorPendingCookie(res);
      clearTwoFactorOk(res);
    } else {
      clearAllTwoFactorCookies(res);
    }
  } catch {
    // DB no disponible (build/prerender) — no bloqueamos el login: el layout
    // hará el gate en el primer render con BD. Limpiamos pending por las dudas.
    clearTwoFactorPending(res);
  }
}
