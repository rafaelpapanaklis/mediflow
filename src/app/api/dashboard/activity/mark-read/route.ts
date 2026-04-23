import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";

export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set("notifLastSeen", new Date().toISOString(), {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90,
  });
  return res;
}
