import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDentalLabContext } from "@/lib/lab-auth";
import { DENTAL_LAB_SERVICES, type DentalLabServiceDTO } from "@/lib/laboratorios/types";

// Lee cookies de sesión (getDentalLabContext) → siempre dinámico, nunca cacheado.
export const dynamic = "force-dynamic";

const VALID_SERVICE_KEYS = new Set(DENTAL_LAB_SERVICES.map((s) => s.key as string));

function serializeService(s: any): DentalLabServiceDTO {
  return {
    id: s.id,
    labId: s.labId,
    serviceKey: s.serviceKey,
    name: s.name,
    description: s.description ?? null,
    priceFrom: s.priceFrom,
    unit: s.unit,
    daysMin: s.daysMin ?? null,
    daysMax: s.daysMax ?? null,
    imageUrl: s.imageUrl ?? null,
    isActive: s.isActive,
  };
}

function normDays(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = Math.floor(Number(v));
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// ── PATCH /api/laboratorios/services/[serviceId] ─────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: { serviceId: string } }) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de laboratorio no está aprobada." }, { status: 403 });
  }

  // Multi-tenant guard: el servicio DEBE pertenecer al lab en sesión.
  const existing = await prisma.dentalLabService.findFirst({
    where: { id: params.serviceId, labId: ctx.labId },
    select: { id: true, daysMin: true, daysMax: true },
  });
  if (!existing) return NextResponse.json({ error: "Servicio no encontrado." }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  // Solo aplicamos los campos presentes en el body (update parcial).
  const data: Prisma.DentalLabServiceUpdateInput = {};

  if (body?.serviceKey !== undefined) {
    const key = typeof body.serviceKey === "string" ? body.serviceKey.trim() : "";
    if (!VALID_SERVICE_KEYS.has(key)) {
      return NextResponse.json({ error: "El tipo de servicio no es válido." }, { status: 400 });
    }
    data.serviceKey = key;
  }
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "El nombre del servicio es requerido." }, { status: 400 });
    data.name = name.slice(0, 200);
  }
  if (body?.priceFrom !== undefined) {
    const priceNum = typeof body.priceFrom === "number" ? body.priceFrom : Number(body.priceFrom);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return NextResponse.json({ error: "El precio debe ser un número mayor o igual a 0." }, { status: 400 });
    }
    data.priceFrom = Math.round(priceNum * 100) / 100;
  }
  if (body?.description !== undefined) {
    data.description =
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if (body?.unit !== undefined) {
    data.unit =
      typeof body.unit === "string" && body.unit.trim() ? body.unit.trim().slice(0, 30) : "pieza";
  }
  if (body?.daysMin !== undefined) {
    const d = normDays(body.daysMin);
    if (!d.ok) return NextResponse.json({ error: "Los días de entrega deben ser enteros mayores o iguales a 0." }, { status: 400 });
    data.daysMin = d.value;
  }
  if (body?.daysMax !== undefined) {
    const d = normDays(body.daysMax);
    if (!d.ok) return NextResponse.json({ error: "Los días de entrega deben ser enteros mayores o iguales a 0." }, { status: 400 });
    data.daysMax = d.value;
  }
  if (typeof body?.isActive === "boolean") {
    data.isActive = body.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No hay cambios que aplicar." }, { status: 400 });
  }

  // Coherencia min/max usando el valor final (el del body si vino, si no el existente).
  const finalMin = data.daysMin !== undefined ? (data.daysMin as number | null) : existing.daysMin;
  const finalMax = data.daysMax !== undefined ? (data.daysMax as number | null) : existing.daysMax;
  if (finalMin !== null && finalMax !== null && finalMin > finalMax) {
    return NextResponse.json({ error: "El mínimo de días no puede ser mayor que el máximo." }, { status: 400 });
  }

  const updated = await prisma.dentalLabService.update({
    where: { id: existing.id },
    data,
  });

  return NextResponse.json(serializeService(updated));
}

// ── DELETE /api/laboratorios/services/[serviceId] ────────────────────────
// Hard delete: el schema pone serviceId=null en las órdenes (onDelete: SetNull),
// preservando el historial de órdenes ya levantadas con este servicio.
export async function DELETE(_req: NextRequest, { params }: { params: { serviceId: string } }) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de laboratorio no está aprobada." }, { status: 403 });
  }

  const existing = await prisma.dentalLabService.findFirst({
    where: { id: params.serviceId, labId: ctx.labId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Servicio no encontrado." }, { status: 404 });

  await prisma.dentalLabService.delete({ where: { id: existing.id } });

  return NextResponse.json({ success: true });
}
