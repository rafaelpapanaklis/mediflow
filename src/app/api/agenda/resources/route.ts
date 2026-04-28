import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchResources } from "@/lib/agenda/server";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";

export const dynamic = "force-dynamic";

const RESOURCE_KIND = z.enum(["CHAIR", "ROOM", "EQUIPMENT"]);

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: RESOURCE_KIND,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6,8}$/, "color must be a hex code")
    .nullable()
    .optional(),
});

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const resources = await fetchResources(session.clinic.id);
  return NextResponse.json({ resources });
}

export async function POST(req: Request) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const guard = requireRole(session, ["SUPER_ADMIN", "ADMIN"]);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const last = await prisma.resource.findFirst({
    where: { clinicId: session.clinic.id, isActive: true },
    orderBy: { orderIndex: "desc" },
    select: { orderIndex: true },
  });
  const nextIndex = (last?.orderIndex ?? -1) + 1;

  const created = await prisma.resource.create({
    data: {
      clinicId: session.clinic.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color ?? null,
      orderIndex: nextIndex,
    },
    select: { id: true, name: true, kind: true, color: true, orderIndex: true },
  });

  return NextResponse.json({ resource: created }, { status: 201 });
}
