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

function opcionesDeLaCookie() {
  return {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 365,
  };
}

export function writeActiveClinicCookie(response: NextResponse, clinicId: string) {
  response.cookies.set(ACTIVE_CLINIC_COOKIE, packClinicCookie(clinicId), opcionesDeLaCookie());
}

/**
 * Corrige la cookie de clínica activa cuando ya no corresponde a la sesión
 * (ws1-t12). Pasa cuando la sesión cambia de persona sin pasar por
 * /api/auth/post-login: enlaces de /auth/confirm (invitación, recuperación,
 * confirmación de correo), lo que quedó de una suplantación o una sede
 * borrada. Sin esto la cookie vieja se quedaba un año y CADA petición caía al
 * fallback (y a su aviso en el log) hasta el siguiente login.
 *
 * Solo se puede escribir en un route handler o una server action; en un server
 * component `cookies().set` lanza y aquí se ignora: el armazón del panel pide
 * varias /api al abrir, y la primera la deja corregida. Devuelve si la escribió.
 */
export function resembrarActiveClinicCookie(clinicId: string): boolean {
  try {
    cookies().set(ACTIVE_CLINIC_COOKIE, packClinicCookie(clinicId), opcionesDeLaCookie());
    return true;
  } catch {
    return false;
  }
}

export function clearActiveClinicCookie(response: NextResponse) {
  response.cookies.set(ACTIVE_CLINIC_COOKIE, "", { path: "/", maxAge: 0 });
}

export function logClinicFallback(ctx: {
  supabaseId: string;
  requestedClinicId: string | null;
  actualClinicId: string;
  resembrada?: boolean;
}) {
  console.warn(
    "[auth] activeClinicId fallback triggered",
    JSON.stringify({
      supabaseId: ctx.supabaseId,
      requested: ctx.requestedClinicId,
      actual: ctx.actualClinicId,
      resembrada: ctx.resembrada ?? false,
    }),
  );
}
