// POST /api/paciente/logout — Implementa A1.
// · Lee cookie patient_session; si existe, destroySessionByToken (best-effort).
// · Limpia la cookie (maxAge 0) y responde 200 { ok: true } SIEMPRE.
import { NextRequest, NextResponse } from "next/server";
import { destroySessionByToken } from "@/lib/patient-portal/session";
import { PATIENT_SESSION_COOKIE } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(PATIENT_SESSION_COOKIE)?.value;
    if (token) {
      try {
        await destroySessionByToken(token);
      } catch (err) {
        console.error("[paciente/logout] destroySessionByToken error:", err);
      }
    }
  } catch (err) {
    console.error("[paciente/logout] error:", err);
  }

  // Siempre 200 + cookie limpia, haya o no sesión.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PATIENT_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
