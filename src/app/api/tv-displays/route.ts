import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

/**
 * /api/tv-displays
 *
 * GET    — lista TVDisplays de la clínica del usuario.
 * POST   — crea uno nuevo. Genera publicSlug único de 12 chars.
 *          Body: { name, mode: "OPERATIONAL"|"MARKETING"|"HYBRID", config }
 *
 * Multi-tenant: clinicId siempre desde getCurrentUser. Solo admin/owner.
 */

const VALID_MODES = new Set(["OPERATIONAL", "MARKETING", "HYBRID"]);

export async function GET() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const displays = await prisma.tVDisplay.findMany({
    where: { clinicId },
    select: {
      id: true,
      name: true,
      mode: true,
      config: true,
      publicSlug: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    displays: displays.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  let body: { name?: string; mode?: string; config?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (!body.mode || !VALID_MODES.has(body.mode)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }

  // Genera slug único 12 chars urlsafe. Retry hasta 5 veces si colisiona
  // (probabilidad astronómicamente baja con 62^12 = 3.2e21 combinaciones).
  let slug = "";
  for (let i = 0; i < 5; i++) {
    slug = generateSlug(12);
    const exists = await prisma.tVDisplay.findUnique({ where: { publicSlug: slug }, select: { id: true } });
    if (!exists) break;
  }

  const created = await prisma.tVDisplay.create({
    data: {
      clinicId,
      name: body.name.trim().slice(0, 120),
      mode: body.mode,
      config: (body.config ?? {}) as object,
      publicSlug: slug,
      active: true,
    },
  });

  return NextResponse.json({
    id: created.id,
    name: created.name,
    mode: created.mode,
    config: created.config,
    publicSlug: created.publicSlug,
    active: created.active,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
}

function generateSlug(len: number): string {
  // Base62 (a-z, A-Z, 0-9) urlsafe sin caracteres ambiguos.
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
