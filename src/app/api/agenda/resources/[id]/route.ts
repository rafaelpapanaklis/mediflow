import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

const RESOURCE_KIND = z.enum([
  // Legacy — tolerados en el API por si llegan payloads viejos durante el rollout.
  "CHAIR",
  "ROOM",
  "EQUIPMENT",
  // Vigentes — los únicos que ofrece la UI.
  "CONSULTORIO_DENTAL",
  "CONSULTORIO_GENERAL",
  "SILLA_DENTAL",
  "SALA_DE_ESPERA",
  "RADIOGRAFIA",
  "LABORATORIO",
]);

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    kind: RESOURCE_KIND.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6,8}$/, "color must be a hex code")
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");

interface Params {
  params: { id: string };
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "resources.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // No filtramos por isActive aquí: el PATCH puede usarse para restaurar
  // un recurso archivado (isActive: true desde la vista de archivados).
  const existing = await prisma.resource.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
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
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
    select: { id: true, name: true, kind: true, color: true, orderIndex: true },
  });

  revalidateAfter("resources");
  return NextResponse.json({ resource: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "resources.edit");
  if (denied) return denied;

  const existing = await prisma.resource.findFirst({
    where: { id: params.id, clinicId: session.clinic.id, isActive: true },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Guard 409: no permitir archivar un recurso con citas activas futuras.
  // Si las hay, el cliente debe reasignarlas antes (UI fase B).
  const ACTIVE_STATUSES: Prisma.AppointmentWhereInput["status"] = {
    in: ["PENDING", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"],
  };
  const activeWhere: Prisma.AppointmentWhereInput = {
    resourceId: params.id,
    clinicId: session.clinic.id,
    status: ACTIVE_STATUSES,
    endsAt: { gt: new Date() },
  };
  const [activeCount, activeSample] = await prisma.$transaction([
    prisma.appointment.count({ where: activeWhere }),
    prisma.appointment.findMany({
      where: activeWhere,
      select: { id: true, startsAt: true, patientId: true },
      orderBy: { startsAt: "asc" },
      take: 3,
    }),
  ]);
  if (activeCount > 0) {
    return NextResponse.json(
      {
        error: "resource_has_active_appointments",
        count: activeCount,
        sample: activeSample.map((a) => a.id),
      },
      { status: 409 },
    );
  }

  await prisma.resource.update({
    where: { id: params.id },
    data: { isActive: false },
  });

  revalidateAfter("resources");
  return NextResponse.json({ ok: true });
}
