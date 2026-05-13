"use server";
// Implants — CRUD del catálogo de marcas/modelos por clínica.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type {
  ImplantBrand,
  ImplantConnectionType,
  ImplantSurfaceTreatment,
  Prisma,
} from "@prisma/client";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import { auditImplant, getImplantActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const brandEnum = z.enum([
  "STRAUMANN",
  "NOBEL_BIOCARE",
  "NEODENT",
  "MIS",
  "BIOHORIZONS",
  "ZIMMER_BIOMET",
  "IMPLANT_DIRECT",
  "ODONTIT",
  "OTRO",
]);

const surfaceEnum = z.enum([
  "SLA",
  "SLActive",
  "TiUnite",
  "OsseoSpeed",
  "LASER_LOK",
  "OTRO",
]);

const connectionEnum = z.enum([
  "EXTERNAL_HEX",
  "INTERNAL_HEX",
  "CONICAL_MORSE",
  "TRI_CHANNEL",
  "OTRO",
]);

const upsertSchema = z.object({
  id: z.string().nullable().optional(),
  brand: brandEnum,
  brandCustomName: z.string().max(120).nullable().optional(),
  modelName: z.string().min(1).max(120),
  platforms: z.array(z.string().min(1).max(40)).max(20),
  diametersMm: z.array(z.number().min(2).max(8)).max(20),
  lengthsMm: z.array(z.number().min(4).max(20)).max(20),
  surfaceTreatment: surfaceEnum.nullable().optional(),
  connectionType: connectionEnum.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
});

export type UpsertImplantCatalogModelInput = z.infer<typeof upsertSchema>;

export interface CatalogModelDto {
  id: string;
  brand: string;
  brandCustomName: string | null;
  modelName: string;
  platforms: string[];
  diametersMm: number[];
  lengthsMm: number[];
  surfaceTreatment: string | null;
  connectionType: string | null;
  notes: string | null;
  isActive: boolean;
}

function toDto(row: {
  id: string;
  brand: ImplantBrand;
  brandCustomName: string | null;
  modelName: string;
  platforms: string[];
  diametersMm: Prisma.Decimal[];
  lengthsMm: Prisma.Decimal[];
  surfaceTreatment: ImplantSurfaceTreatment | null;
  connectionType: ImplantConnectionType | null;
  notes: string | null;
  isActive: boolean;
}): CatalogModelDto {
  return {
    id: row.id,
    brand: row.brand,
    brandCustomName: row.brandCustomName,
    modelName: row.modelName,
    platforms: row.platforms,
    diametersMm: row.diametersMm.map((d) => Number(d)),
    lengthsMm: row.lengthsMm.map((d) => Number(d)),
    surfaceTreatment: row.surfaceTreatment,
    connectionType: row.connectionType,
    notes: row.notes,
    isActive: row.isActive,
  };
}

export async function listImplantCatalogModels(): Promise<
  ActionResult<CatalogModelDto[]>
> {
  const ctxRes = await getImplantActionContext({ write: false });
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;
  const rows = await prisma.implantCatalogModel.findMany({
    where: { clinicId: ctx.clinicId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { brand: "asc" }, { modelName: "asc" }],
  });
  return ok(rows.map(toDto));
}

export async function upsertImplantCatalogModel(
  input: UpsertImplantCatalogModelInput,
): Promise<ActionResult<CatalogModelDto>> {
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }
  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const data = {
    clinicId: ctx.clinicId,
    brand: parsed.data.brand as ImplantBrand,
    brandCustomName: parsed.data.brandCustomName ?? null,
    modelName: parsed.data.modelName,
    platforms: parsed.data.platforms,
    diametersMm: parsed.data.diametersMm,
    lengthsMm: parsed.data.lengthsMm,
    surfaceTreatment:
      (parsed.data.surfaceTreatment as ImplantSurfaceTreatment | null) ?? null,
    connectionType:
      (parsed.data.connectionType as ImplantConnectionType | null) ?? null,
    notes: parsed.data.notes ?? null,
    isActive: parsed.data.isActive,
  };

  let row;
  if (parsed.data.id) {
    // verificar tenant
    const existing = await prisma.implantCatalogModel.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, clinicId: true },
    });
    if (!existing) return fail("Modelo no encontrado");
    if (existing.clinicId !== ctx.clinicId) {
      return fail("Modelo pertenece a otra clínica");
    }
    row = await prisma.implantCatalogModel.update({
      where: { id: parsed.data.id },
      data: { ...data, createdBy: undefined as never },
    });
    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.CATALOG_BRAND_UPDATED,
      entityType: "ImplantCatalogModel",
      entityId: row.id,
      meta: { brand: row.brand, modelName: row.modelName },
    }).catch(() => {});
  } else {
    row = await prisma.implantCatalogModel.create({
      data: { ...data, createdBy: ctx.userId },
    });
    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.CATALOG_BRAND_CREATED,
      entityType: "ImplantCatalogModel",
      entityId: row.id,
      meta: { brand: row.brand, modelName: row.modelName },
    }).catch(() => {});
  }

  revalidatePath("/dashboard/settings/implants");
  return ok(toDto(row));
}

export async function deleteImplantCatalogModel(input: {
  id: string;
}): Promise<ActionResult<{ id: string }>> {
  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;
  const existing = await prisma.implantCatalogModel.findUnique({
    where: { id: input.id },
    select: { id: true, clinicId: true },
  });
  if (!existing) return fail("Modelo no encontrado");
  if (existing.clinicId !== ctx.clinicId) {
    return fail("Modelo pertenece a otra clínica");
  }
  await prisma.implantCatalogModel.update({
    where: { id: input.id },
    data: { deletedAt: new Date(), isActive: false },
  });
  revalidatePath("/dashboard/settings/implants");
  return ok({ id: input.id });
}
