import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.enum(["PENDING", "DONE", "DISMISSED"]).optional(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(5_000).nullable().optional(),
  dueAt: z.string().datetime().optional(),
  assignedToId: z.string().min(1).optional(),
}).refine((v) => Object.keys(v).length > 0, "no fields to update");

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí (Supabase + prisma a
// mano), pero pasando por los gates de 2FA y de plan vencido que la copia se
// saltaba. ctx.user es la fila User con permissionsOverride normalizado, así
// que sirve tal cual para denyIfMissingPermission.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

interface Params { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const existing = await prisma.reminder.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true, status: true, patientId: true },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Visibilidad por paciente: el recordatorio devuelve el paciente en la
    // respuesta; no permitir editarlo a quien no puede ver a ese paciente.
    if (existing.patientId) {
      const denied = await assertPatientVisible(existing.patientId, { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId });
      if (denied) return denied;
    }

    if (parsed.data.assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: { id: parsed.data.assignedToId, clinicId: dbUser.clinicId, isActive: true },
        select: { id: true },
      });
      if (!assignee) return NextResponse.json({ error: "assignee_not_found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.body !== undefined) data.body = parsed.data.body;
    if (parsed.data.dueAt !== undefined) data.dueAt = new Date(parsed.data.dueAt);
    if (parsed.data.assignedToId !== undefined) data.assignedToId = parsed.data.assignedToId;
    if (parsed.data.status !== undefined) {
      data.status = parsed.data.status;
      if (parsed.data.status === "DONE" && existing.status !== "DONE") {
        data.completedAt = new Date();
        data.completedById = dbUser.id;
      } else if (parsed.data.status === "PENDING") {
        data.completedAt = null;
        data.completedById = null;
      }
    }

    const updated = await prisma.reminder.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        title: true,
        body: true,
        dueAt: true,
        status: true,
        completedAt: true,
        threadId: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({ reminder: updated });
  } catch (err) {
    console.error("[PATCH /api/reminders/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Visibilidad por paciente (barrido Ola 3): el PATCH de arriba ya asserta;
    // borrar el recordatorio de un paciente restringido exige poder verlo.
    // Un id inexistente conserva el ok idempotente que ya daba el deleteMany.
    const existing = await prisma.reminder.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true, patientId: true },
    });
    if (!existing) return NextResponse.json({ ok: true });
    if (existing.patientId) {
      const visDenied = await assertPatientVisible(existing.patientId, {
        userId: dbUser.id,
        role: dbUser.role,
        clinicId: dbUser.clinicId,
      });
      if (visDenied) return visDenied;
    }
    await prisma.reminder.deleteMany({
      where: { id: params.id, clinicId: dbUser.clinicId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/reminders/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
