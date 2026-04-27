import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { liveCookieName, verifyLivePassword, LIVE_UNLOCK_TTL_HOURS } from "@/lib/floor-plan/live-config";

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

  cookies().set(liveCookieName(slug), "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/live/${slug}`,
    maxAge: LIVE_UNLOCK_TTL_HOURS * 3600,
  });

  return NextResponse.json({ ok: true });
}
