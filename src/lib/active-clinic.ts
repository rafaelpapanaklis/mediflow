import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const COOKIE_NAME = "activeClinicId";

function secret() {
  return process.env.COOKIE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "mediflow-cookie-fallback-dev-only";
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex").slice(0, 32);
}

function pack(clinicId: string) {
  return `${clinicId}.${sign(clinicId)}`;
}

function unpack(raw: string | undefined): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 1) return null;
  const value = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(value);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return value;
}

export function readActiveClinicCookie(): string | null {
  try {
    const raw = cookies().get(COOKIE_NAME)?.value;
    return unpack(raw);
  } catch {
    return null;
  }
}

export function writeActiveClinicCookie(response: NextResponse, clinicId: string) {
  response.cookies.set(COOKIE_NAME, pack(clinicId), {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function logClinicFallback(ctx: { supabaseId: string; requestedClinicId: string | null; actualClinicId: string }) {
  console.warn(
    "[auth] activeClinicId fallback triggered",
    JSON.stringify({
      supabaseId: ctx.supabaseId,
      requested: ctx.requestedClinicId,
      actual: ctx.actualClinicId,
    }),
  );
}
