import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { liveCookieName, verifyLivePassword, LIVE_UNLOCK_TTL_HOURS } from "@/lib/floor-plan/live-config";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  password: z.string().min(1).max(200),
});

interface Params { params: { slug: string } }

/**
 * POST /api/live/[slug]/unlock
 * Verifica el password contra el bcrypt hash de la clínica. Si coincide,
 * setea cookie httpOnly de 12h que el endpoint público lee como llave.
 */
export async function POST(req: NextRequest, { params }: Params) {
  // Endpoint publico (sin auth) que verifica password contra bcrypt hash —
  // vulnerable a brute force. Limita a 10 intentos por IP cada 5 minutos.
  // Es generoso para typos legitimos pero detiene ataques automatizados.
  const rl = rateLimit(req, 10, 5 * 60 * 1000);
  if (rl) return rl;

  const slug = (params.slug ?? "").toLowerCase();
  if (!slug) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const clinic = await prisma.clinic.findUnique({
    where: { liveModeSlug: slug },
    select: {
      id: true,
      liveModeEnabled: true,
      liveModePassword: true,
    },
  });
  if (!clinic || !clinic.liveModeEnabled || !clinic.liveModePassword) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ok = await verifyLivePassword(parsed.data.password, clinic.liveModePassword);
  if (!ok) {
    // Constant-time-ish: bcrypt.compare ya usa timing-safe.
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });

  // Cleanup defensive: si quedaba una cookie legacy con path
  // /live/<slug> (versión anterior del código), la matamos antes de
  // setear la nueva. Sin esto el browser termina con 2 cookies con el
  // mismo name y comportamiento ambiguo entre paths.
  res.cookies.set(liveCookieName(slug), "", {
    path: `/live/${slug}`,
    maxAge: 0,
  });

  // path: "/" para que el browser envíe el cookie tanto a /live/<slug>
  // (page server) como a /api/live/<slug> (fetch del cliente). El name
  // del cookie incluye el slug, así que múltiples clínicas mantienen
  // sesiones independientes.
  res.cookies.set(liveCookieName(slug), "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LIVE_UNLOCK_TTL_HOURS * 3600,
  });

  return res;
}
