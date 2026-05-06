"use server";
// Clinical-shared — server actions para LabOrder + LabPartner.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { renderToStream } from "@react-pdf/renderer";
import {
  ClinicalModule,
  LabOrderStatus,
  LabOrderType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared, guardPatient } from "@/lib/clinical-shared/auth/guard";
import { fail, isFailure, ok, type ActionResult } from "@/lib/clinical-shared/result";
import { LabOrderDocument } from "@/lib/pdf/lab-order-document";
import {
  LAB_ORDER_STATUS_LABELS,
  LAB_ORDER_TYPE_LABELS,
  type LabOrderDTO,
  type LabPartnerDTO,
} from "@/lib/clinical-shared/lab-orders/types";

const moduleEnum = z.nativeEnum(ClinicalModule);
const orderTypeEnum = z.nativeEnum(LabOrderType);
const orderStatusEnum = z.nativeEnum(LabOrderStatus);

// ── LabPartner ─────────────────────────────────────────────────────────

const partnerSchema = z.object({
  name: z.string().min(1).max(120),
  contactName: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(120).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function createLabPartner(
  input: z.infer<typeof partnerSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = partnerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const created = await prisma.labPartner.create({
    data: {
      clinicId: ctx.clinicId,
      name: parsed.data.name,
      contactName: parsed.data.contactName ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
    },
    select: { id: true },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.lab-partner.created",
    entityType: "lab-partner",
    entityId: created.id,
    changes: { name: parsed.data.name },
  });
  revalidatePath("/dashboard");
  return ok(created);
}

export async function listLabPartners(): Promise<ActionResult<LabPartnerDTO[]>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const rows = await prisma.labPartner.findMany({
    where: { clinicId: ctx.clinicId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      contactName: true,
      phone: true,
      email: true,
      isActive: true,
    },
  });
  return ok(rows);
}

const togglePartnerSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});

export async function setLabPartnerActive(
  input: z.infer<typeof togglePartnerSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = togglePartnerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const p = await prisma.labPartner.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!p || p.deletedAt) return fail("Laboratorio no encontrado");
  if (p.clinicId !== ctx.clinicId) return fail("Sin acceso");

  await prisma.labPartner.update({
    where: { id: p.id },
    data: { isActive: parsed.data.isActive },
  });
  return ok({ id: p.id });
}

// ── LabOrder ───────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
  partnerId: z.string().min(1).nullable().optional(),
  orderType: orderTypeEnum,
  spec: z.record(z.string(), z.unknown()),
  toothFdi: z.number().int().nullable().optional(),
  shadeGuide: z.string().max(40).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function createLabOrder(
  input: z.infer<typeof createOrderSchema>,
): Promise<ActionResult<{ id: string; pdfUrl: string }>> {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  if (parsed.data.partnerId) {
    const p = await prisma.labPartner.findUnique({
      where: { id: parsed.data.partnerId },
      select: { id: true, clinicId: true, deletedAt: true },
    });
    if (!p || p.deletedAt || p.clinicId !== ctx.clinicId) return fail("Laboratorio inválido");
  }

  const created = await prisma.labOrder.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module,
      partnerId: parsed.data.partnerId ?? null,
      authorId: ctx.userId,
      orderType: parsed.data.orderType,
      spec: parsed.data.spec as object,
      toothFdi: parsed.data.toothFdi ?? null,
      shadeGuide: parsed.data.shadeGuide ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      notes: parsed.data.notes ?? null,
      status: "draft",
    },
    select: { id: true },
  });

  const pdfUrl = await renderLabOrderPdfDataUrl({ orderId: created.id });
  await prisma.labOrder.update({ where: { id: created.id }, data: { pdfUrl } });

  await auditClinicalShared({
    ctx,
    action: "clinical-shared.lab-order.created",
    entityType: "lab-order",
    entityId: created.id,
    changes: { module: parsed.data.module, orderType: parsed.data.orderType },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok({ id: created.id, pdfUrl });
}

const listOrdersSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum.optional(),
});

export async function listLabOrders(
  input: z.infer<typeof listOrdersSchema>,
): Promise<ActionResult<LabOrderDTO[]>> {
  const parsed = listOrdersSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const rows = await prisma.labOrder.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module ?? undefined,
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    include: { partner: { select: { name: true } } },
  });

  return ok(
    rows.map((r) => ({
      id: r.id,
      module: r.module,
      partnerId: r.partnerId,
      partnerName: r.partner?.name ?? null,
      patientId: r.patientId,
      orderType: r.orderType,
      spec: (r.spec as unknown as Record<string, unknown>) ?? {},
      toothFdi: r.toothFdi,
      shadeGuide: r.shadeGuide,
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      status: r.status,
      pdfUrl: r.pdfUrl,
      notes: r.notes,
    })),
  );
}

const setStatusSchema = z.object({
  id: z.string().min(1),
  status: orderStatusEnum,
});

export async function setLabOrderStatus(
  input: z.infer<typeof setStatusSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const o = await prisma.labOrder.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!o || o.deletedAt) return fail("Orden no encontrada");
  if (o.clinicId !== ctx.clinicId) return fail("Sin acceso");

  const updates: { status: LabOrderStatus; sentAt?: Date; receivedAt?: Date } = {
    status: parsed.data.status,
  };
  if (parsed.data.status === "sent") updates.sentAt = new Date();
  if (parsed.data.status === "received") updates.receivedAt = new Date();

  await prisma.labOrder.update({ where: { id: o.id }, data: updates });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.lab-order.status",
    entityType: "lab-order",
    entityId: o.id,
    changes: { status: parsed.data.status },
  });
  return ok({ id: o.id });
}

// ── Internals ──────────────────────────────────────────────────────────

async function renderLabOrderPdfDataUrl(args: { orderId: string }): Promise<string> {
  const o = await prisma.labOrder.findUnique({
    where: { id: args.orderId },
    include: {
      patient: { select: { firstName: true, lastName: true, dob: true } },
      author: {
        select: { firstName: true, lastName: true, cedulaProfesional: true },
      },
      partner: { select: { name: true, contactName: true, phone: true, address: true } },
      clinic: { select: { name: true } },
    },
  });
  if (!o) throw new Error("Orden no encontrada");

  const specEntries: Array<{ label: string; value: string }> = [];
  if (o.spec && typeof o.spec === "object") {
    for (const [k, v] of Object.entries(o.spec as Record<string, unknown>)) {
      specEntries.push({ label: prettyLabel(k), value: stringifyValue(v) });
    }
  }

  const stream = await renderToStream(
    LabOrderDocument({
      clinicName: o.clinic.name,
      doctorAuthorName: `${o.author.firstName} ${o.author.lastName}`,
      doctorAuthorCedula: o.author.cedulaProfesional ?? null,
      partnerName: o.partner?.name ?? null,
      partnerContact:
        [o.partner?.contactName, o.partner?.phone].filter(Boolean).join(" · ") || null,
      partnerAddress: o.partner?.address ?? null,
      generatedAt: new Date().toISOString(),
      patientName: `${o.patient.firstName} ${o.patient.lastName}`,
      patientDob: o.patient.dob ? o.patient.dob.toISOString() : null,
      module: o.module,
      orderType: LAB_ORDER_TYPE_LABELS[o.orderType] ?? o.orderType,
      toothFdi: o.toothFdi,
      shadeGuide: o.shadeGuide,
      dueDate: o.dueDate ? o.dueDate.toISOString() : null,
      spec: specEntries,
      notes: o.notes,
    }),
  );
  const chunks: Buffer[] = [];
  for await (const c of stream as unknown as AsyncIterable<Buffer>) chunks.push(c);
  return `data:application/pdf;base64,${Buffer.concat(chunks).toString("base64")}`;
}

function prettyLabel(key: string): string {
  return key
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function stringifyValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export { LAB_ORDER_STATUS_LABELS, LAB_ORDER_TYPE_LABELS };
