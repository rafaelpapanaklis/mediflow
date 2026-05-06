"use server";
// Clinical-shared — server actions para ClinicalEvolutionTemplate.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ClinicalModule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared } from "@/lib/clinical-shared/auth/guard";
import {
  isSoapTemplateBody,
  type EvolutionTemplateDTO,
} from "@/lib/clinical-shared/evolution-templates/types";
import { ensurePediatricDefaults } from "@/lib/clinical-shared/evolution-templates/seed-pediatrics";
import { fail, ok, type ActionResult } from "@/lib/clinical-shared/result";

const moduleEnum = z.nativeEnum(ClinicalModule);

const soapShape = z.object({
  S: z.string().max(4000),
  O: z.string().max(4000),
  A: z.string().max(4000),
  P: z.string().max(4000),
});

const createSchema = z.object({
  module: moduleEnum,
  name: z.string().min(1).max(80),
  soapTemplate: soapShape,
  proceduresPrefilled: z.array(z.string()).max(50).optional(),
  materialsPrefilled: z.array(z.string()).max(50).optional(),
  isDefault: z.boolean().optional(),
});

export async function createEvolutionTemplate(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  try {
    const created = await prisma.clinicalEvolutionTemplate.create({
      data: {
        clinicId: ctx.clinicId,
        module: parsed.data.module,
        name: parsed.data.name,
        soapTemplate: parsed.data.soapTemplate as unknown as object,
        proceduresPrefilled: parsed.data.proceduresPrefilled ?? [],
        materialsPrefilled: parsed.data.materialsPrefilled ?? [],
        isDefault: parsed.data.isDefault ?? false,
        createdBy: ctx.userId,
      },
      select: { id: true },
    });
    await auditClinicalShared({
      ctx,
      action: "clinical-shared.evolution-template.created",
      entityType: "clinical-evolution-template",
      entityId: created.id,
      changes: { module: parsed.data.module, name: parsed.data.name },
    });
    revalidatePath("/dashboard");
    return ok(created);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return fail("Ya existe una plantilla con ese nombre para este módulo");
    }
    return fail("No se pudo crear la plantilla");
  }
}

const listSchema = z.object({
  module: moduleEnum,
  /** Si true, garantiza que existan los defaults pediátricos antes de listar. */
  ensureDefaults: z.boolean().optional(),
});

export async function listEvolutionTemplates(
  input: z.infer<typeof listSchema>,
): Promise<ActionResult<EvolutionTemplateDTO[]>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (parsed.data.module === "pediatrics" && parsed.data.ensureDefaults) {
    await ensurePediatricDefaults({ clinicId: ctx.clinicId, createdBy: ctx.userId });
  }

  const rows = await prisma.clinicalEvolutionTemplate.findMany({
    where: {
      clinicId: ctx.clinicId,
      module: parsed.data.module,
      deletedAt: null,
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  const dtos: EvolutionTemplateDTO[] = [];
  for (const r of rows) {
    if (!isSoapTemplateBody(r.soapTemplate)) continue;
    dtos.push({
      id: r.id,
      name: r.name,
      module: r.module,
      soapTemplate: r.soapTemplate,
      proceduresPrefilled: r.proceduresPrefilled,
      materialsPrefilled: r.materialsPrefilled,
      isDefault: r.isDefault,
    });
  }
  return ok(dtos);
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deleteEvolutionTemplate(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const tpl = await prisma.clinicalEvolutionTemplate.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!tpl || tpl.deletedAt) return fail("Plantilla no encontrada");
  if (tpl.clinicId !== ctx.clinicId) return fail("Sin acceso");

  await prisma.clinicalEvolutionTemplate.update({
    where: { id: tpl.id },
    data: { deletedAt: new Date() },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.evolution-template.deleted",
    entityType: "clinical-evolution-template",
    entityId: tpl.id,
  });
  revalidatePath("/dashboard");
  return ok({ id: tpl.id });
}

const seedDefaultsSchema = z.object({ module: moduleEnum });

/** Llamado por administradores para forzar la creación de defaults. */
export async function seedEvolutionTemplateDefaults(
  input: z.infer<typeof seedDefaultsSchema>,
): Promise<ActionResult<{ created: number; total: number }>> {
  const parsed = seedDefaultsSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  if (!ctx.isAdmin && !ctx.isSuperAdmin) return fail("Solo administradores");

  if (parsed.data.module !== "pediatrics") {
    return fail("Solo Pediatría tiene seeds default por ahora");
  }
  const result = await ensurePediatricDefaults({
    clinicId: ctx.clinicId,
    createdBy: ctx.userId,
  });
  return ok(result);
}
