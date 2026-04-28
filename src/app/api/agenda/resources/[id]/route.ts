import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";

export const dynamic = "force-dynamic";

const RESOURCE_KIND = z.enum(["CHAIR", "ROOM", "EQUIPMENT"]);

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    kind: RESOURCE_KIND.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6,8}$/, "color must be a hex code")
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");

interface Params {
  params: { id: string };
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const guard = requireRole(session, ["SUPER_ADMIN", "ADMIN"]);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await prisma.resource.findFirst({
    where: { id: params.id, clinicId: session.clinic.id, isActive: true },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.resource.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
    },
    select: { id: true, name: true, kind: true, color: true, orderIndex: true },
  });

  return NextResponse.json({ resource: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const guard = requireRole(session, ["SUPER_ADMIN", "ADMIN"]);
  if (guard) return guard;

  const existing = await prisma.resource.findFirst({
    where: { id: params.id, clinicId: session.clinic.id, isActive: true },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.resource.update({
    where: { id: params.id },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
