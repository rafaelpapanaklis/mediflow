// Periodontics — server actions: órdenes de laboratorio perio. SPEC §8, COMMIT 5.

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  PERIO_LAB_ORDER_KIND,
  PERIO_LAB_ORDER_TYPE_TO_SCHEMA,
  getPerioLabSpecSchema,
  type PerioLabOrderKind,
} from "@/lib/periodontics/lab-order-types";
import {
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  loadPatientForPerio,
  ok,
  type ActionResult,
} from "./_helpers";

const LAB_ORDER_STATUS = ["draft", "sent", "in_progress", "received", "cancelled"] as const;

const createSchema = z.object({
  patientId: z.string().min(1),
  kind: z.enum(PERIO_LAB_ORDER_KIND),
  spec: z.unknown(),
  partnerId: z.string().min(1).optional(),
  dueDate: z.coerce.date().optional(),
  shadeGuide: z.string().max(8).optional(),
  toothFdi: z.number().int().optional(),
  notes: z.string().max(1000).optional(),
});

export async function createPerioLabOrder(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const patient = await loadPatientForPerio({
    ctx,
    patientId: parsed.data.patientId,
  });
  if (isFailure(patient)) return patient;

  const kind: PerioLabOrderKind = parsed.data.kind;
  const specSchema = getPerioLabSpecSchema(kind);
  const specParsed = specSchema.safeParse(parsed.data.spec);
  if (!specParsed.success) {
    return fail(
      `Spec inválido para ${kind}: ${specParsed.error.issues[0]?.message ?? "datos incompletos"}`,
    );
  }

  if (parsed.data.partnerId) {
    const partner = await prisma.labPartner.findFirst({
      where: {
        id: parsed.data.partnerId,
        clinicId: ctx.clinicId,
        deletedAt: null,
      },
      select: { id: true, isActive: true },
    });
    if (!partner || !partner.isActive) {
      return fail("Laboratorio inválido o desactivado");
    }
  }

  try {
    const created = await prisma.labOrder.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        module: "periodontics",
        partnerId: parsed.data.partnerId ?? null,
        authorId: ctx.userId,
        orderType: PERIO_LAB_ORDER_TYPE_TO_SCHEMA[kind],
        spec: specParsed.data,
        toothFdi: parsed.data.toothFdi ?? null,
        shadeGuide: parsed.data.shadeGuide ?? null,
        dueDate: parsed.data.dueDate ?? null,
        notes: parsed.data.notes ?? null,
      },
      select: { id: true },
    });

    await auditPerio({
      ctx,
      action: "perio.labOrder.created",
      entityType: "LabOrder",
      entityId: created.id,
      after: {
        kind,
        orderType: PERIO_LAB_ORDER_TYPE_TO_SCHEMA[kind],
        partnerId: parsed.data.partnerId ?? null,
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id });
  } catch (e) {
    console.error("[perio lab-orders] create failed:", e);
    return fail("No se pudo crear la orden de laboratorio");
  }
}

const updateStatusSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(LAB_ORDER_STATUS),
});

export async function updatePerioLabOrderStatus(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = updateStatusSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const existing = await prisma.labOrder.findFirst({
    where: {
      id: parsed.data.orderId,
      clinicId: ctx.clinicId,
      module: "periodontics",
      deletedAt: null,
    },
    select: { id: true, patientId: true, status: true },
  });
  if (!existing) return fail("Orden no encontrada");

  const now = new Date();
  try {
    await prisma.labOrder.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        sentAt: parsed.data.status === "sent" ? now : undefined,
        receivedAt: parsed.data.status === "received" ? now : undefined,
      },
    });
    await auditPerio({
      ctx,
      action: "perio.labOrder.statusChanged",
      entityType: "LabOrder",
      entityId: existing.id,
      before: { status: existing.status },
      after: { status: parsed.data.status },
    });
    revalidatePath(`/dashboard/specialties/periodontics/${existing.patientId}`);
    return ok({ id: existing.id });
  } catch (e) {
    console.error("[perio lab-orders] update status failed:", e);
    return fail("No se pudo actualizar el estado");
  }
}
