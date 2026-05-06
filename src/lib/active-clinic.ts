import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  ACTIVE_CLINIC_COOKIE,
  packClinicCookie,
  unpackClinicCookie,
} from "./active-clinic-core";

export { pickActiveClinicId, ACTIVE_CLINIC_COOKIE } from "./active-clinic-core";

export function readActiveClinicCookie(): string | null {
  try {
    const raw = cookies().get(ACTIVE_CLINIC_COOKIE)?.value;
    return unpackClinicCookie(raw);
  } catch {
    return null;
  }
}

export function writeActiveClinicCookie(response: NextResponse, clinicId: string) {
  response.cookies.set(ACTIVE_CLINIC_COOKIE, packClinicCookie(clinicId), {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function clearActiveClinicCookie(response: NextResponse) {
  response.cookies.set(ACTIVE_CLINIC_COOKIE, "", { path: "/", maxAge: 0 });
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
