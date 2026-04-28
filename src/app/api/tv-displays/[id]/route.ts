import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_MODES = new Set(["OPERATIONAL", "MARKETING", "HYBRID"]);

/**
 * /api/tv-displays/[id]
 *
 * PATCH — actualiza un TV display. Body: { name?, mode?, config?, active? }.
 * DELETE — elimina (cascade soft no aplica, FK clinicId cascade en DB pero
 *          aquí es delete directo del display; vista pública 404 después).
 *
 * Multi-tenant: validamos que el display pertenezca a la clinic del user
 * con findFirst({ id, clinicId }) ANTES de update/delete.
 */

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  let body: { name?: string; mode?: string; config?: unknown; active?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Tenant scope: validar ownership ANTES de update.
  const existing = await prisma.tVDisplay.findFirst({
    where: { id: params.id, clinicId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const data: { name?: string; mode?: string; config?: object; active?: boolean } = {};
  if (typeof body.name === "string") {
    if (!body.name.trim()) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    data.name = body.name.trim().slice(0, 120);
  }
  if (typeof body.mode === "string") {
    if (!VALID_MODES.has(body.mode)) return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
    data.mode = body.mode;
  }
  if (body.config !== undefined) {
    if (typeof body.config !== "object" || body.config === null) {
      return NextResponse.json({ error: "invalid_config" }, { status: 400 });
    }
    data.config = body.config as object;
  }
  if (typeof body.active === "boolean") {
    data.active = body.active;
  }

  const updated = await prisma.tVDisplay.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    mode: updated.mode,
    config: updated.config,
    publicSlug: updated.publicSlug,
    active: updated.active,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  // Validación tenant antes de delete.
  const result = await prisma.tVDisplay.deleteMany({
    where: { id: params.id, clinicId },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
