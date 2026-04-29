import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

const VALID_STATUSES = new Set(["PENDING", "IN_PROGRESS", "RESOLVED", "REJECTED"]);

/**
 * GET /api/arco/[id] — admin de la clínica ve detalle de una solicitud ARCO.
 *
 * Multi-tenant:
 *  - Si la solicitud tiene clinicId, debe coincidir con ctx.clinicId.
 *  - Si la solicitud tiene clinicId NULL (anónima), solo SUPER_ADMIN.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!hasPermission(user.role, "arco.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const arco = await prisma.arcoRequest.findUnique({ where: { id: params.id } });
  if (!arco) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (arco.clinicId === null) {
    if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } else if (arco.clinicId !== user.clinicId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json(arco);
}

/**
 * PATCH /api/arco/[id] — actualiza status/resolvedNotes de una solicitud.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!hasPermission(user.role, "arco.update")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const arco = await prisma.arcoRequest.findUnique({ where: { id: params.id } });
  if (!arco) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Multi-tenant scope
  if (arco.clinicId === null) {
    if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } else if (arco.clinicId !== user.clinicId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { status?: string; resolvedNotes?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const data: { status?: "PENDING" | "IN_PROGRESS" | "RESOLVED" | "REJECTED"; resolvedAt?: Date | null; resolvedNotes?: string | null } = {};
  if (body.status !== undefined) {
    const status = String(body.status).toUpperCase();
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    data.status = status as "PENDING" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
    if (status === "RESOLVED" || status === "REJECTED") data.resolvedAt = new Date();
    if (status === "PENDING" || status === "IN_PROGRESS") data.resolvedAt = null;
  }
  if (body.resolvedNotes !== undefined) {
    data.resolvedNotes = body.resolvedNotes?.slice(0, 4000) ?? null;
  }

  const updated = await prisma.arcoRequest.update({
    where: { id: params.id },
    data,
  });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "consent", // reusamos consent — ARCO toca consent/datos
    entityId: params.id,
    action: "update",
    before: { status: arco.status, resolvedNotes: arco.resolvedNotes },
    after:  { status: updated.status, resolvedNotes: updated.resolvedNotes },
  });

  return NextResponse.json(updated);
}
