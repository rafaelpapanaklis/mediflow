"use server";
// Orthodontics — createOrthoLabOrder. DrawerLabOrder G18: crea una
// LabOrder genérica con module="orthodontics" y spec con catálogo + lab.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { idDeLaBase } from "@/lib/validation/id";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  patientId: idDeLaBase(),
  /** Etiqueta del catálogo seleccionada (ej. "Retenedor Hawley sup"). */
  catalog: z.string().min(1).max(120),
  description: z.string().max(500),
  /** Texto libre del lab. */
  lab: z.string().max(120),
  /** Laboratorio real de la clínica (lab_partners); opcional. */
  labPartnerId: z.string().min(1).nullable().optional(),
  expectedDate: z
    .string()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
});

export async function createOrthoLabOrder(
  input: unknown,
): Promise<ActionResult<{ labOrderId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForOrtho({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  // H52/H53: si se eligió un laboratorio de la clínica, debe ser de ESTA clínica.
  let partnerId: string | null = null;
  if (parsed.data.labPartnerId) {
    const partner = await prisma.labPartner.findFirst({
      where: { id: parsed.data.labPartnerId, clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true },
    });
    if (!partner) return fail("Laboratorio inválido");
    partnerId = partner.id;
  }

  try {
    const created = await prisma.labOrder.create({
      data: {
        clinicId: ctx.clinicId,
        partnerId,
        patientId: patient.data.id,
        module: "orthodontics",
        authorId: ctx.userId,
        // OrderType genérico — el catálogo va en spec para no acoplar al
        // enum legacy (que no incluye Hawley/Essix/expansores).
        orderType: "other",
        spec: {
          catalog: parsed.data.catalog,
          description: parsed.data.description,
          lab: parsed.data.lab,
        },
        dueDate: parsed.data.expectedDate ?? undefined,
        notes: parsed.data.description,
        status: "draft",
      },
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.LAB_ORDER_CREATED,
      entityType: "LabOrder",
      entityId: created.id,
      patientId: parsed.data.patientId,
      after: {
        catalog: parsed.data.catalog,
        lab: parsed.data.lab,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${patient.data.id}`);
    return ok({ labOrderId: created.id });
  } catch (e) {
    console.error("[ortho] createOrthoLabOrder failed:", e);
    return fail("No se pudo crear la orden de laboratorio");
  }
}
