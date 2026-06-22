import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, revokeAdminSessionByToken } from "@/lib/admin-auth";

export async function POST() {
  // Revoca la sesión en BD (no solo borra la cookie) para que el token no pueda
  // reusarse aunque el navegador lo conserve.
  const token = cookies().get(ADMIN_COOKIE)?.value;
  await revokeAdminSessionByToken(token);
  cookies().delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
