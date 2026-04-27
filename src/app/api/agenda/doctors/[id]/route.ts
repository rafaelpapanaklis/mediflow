import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";

export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6,8}$/, "color must be a hex code")
      .optional(),
    activeInAgenda: z.boolean().optional(),
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

  const target = await prisma.user.findFirst({
    where: {
      id: params.id,
      clinicId: session.clinic.id,
      role: "DOCTOR",
      isActive: true,
    },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
      ...(parsed.data.activeInAgenda !== undefined
        ? { agendaActive: parsed.data.activeInAgenda }
        : {}),
    },
    select: {
      id: true,
      color: true,
      agendaActive: true,
    },
  });

  return NextResponse.json({ doctor: updated });
}
