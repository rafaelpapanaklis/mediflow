import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type { DentalLabOrderDTO } from "@/lib/laboratorios/types";
import { canTransition, isTerminalLabStatus } from "@/lib/laboratorios/orders-shared";

// Include canónico para el detalle de una orden de laboratorio del lado
// clínica: trae el lab, el servicio, la línea de tiempo (events) y los
// archivos. Misma forma que el DTO de `@/lib/laboratorios/types`.
const orderInclude = {
  lab: true,
  service: true,
  events: { orderBy: { createdAt: "asc" } },
  files: { orderBy: { uploadedAt: "asc" } },
} satisfies Prisma.DentalLabOrderInclude;

type OrderWith = Prisma.DentalLabOrderGetPayload<{ include: typeof orderInclude }>;

const iso = (d: Date): string => d.toISOString();

// Serializa una orden Prisma → DentalLabOrderDTO (fechas como ISO string; la
// relación `events` se expone como `timeline`).
function toDentalLabOrderDTO(o: OrderWith): DentalLabOrderDTO {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    clinicId: o.clinicId,
    labId: o.labId,
    serviceId: o.serviceId,
    patientId: o.patientId,
    patientName: o.patientName,
    internalRef: o.internalRef,
    status: o.status,
    notes: o.notes,
    basePrice: o.basePrice,
    extrasTotal: o.extrasTotal,
    total: o.total,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    priority: o.priority,
    pickupAt: o.pickupAt ? iso(o.pickupAt) : null,
    etaAt: o.etaAt ? iso(o.etaAt) : null,
    courier: (o.courier as unknown as DentalLabOrderDTO["courier"]) ?? null,
    timeline: o.events.map((e) => ({
      status: e.status,
      at: e.at ? iso(e.at) : null,
      eta: e.eta ? iso(e.eta) : null,
      actor:
        e.actorId || e.actorName || e.actorRole
          ? { id: e.actorId, name: e.actorName, role: e.actorRole }
          : null,
      detail: e.detail,
    })),
    files: o.files.map((f) => ({
      id: f.id,
      url: f.url,
      name: f.name,
      fileType: f.fileType,
      sizeBytes: f.sizeBytes,
      uploadedAt: iso(f.uploadedAt),
    })),
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  };
}

// GET /api/ordenes-laboratorio/[orderId] — detalle de una orden de la clínica.
// Scopeado por clinicId de sesión: una orden de otra clínica devuelve 404.
export async function GET(_req: NextRequest, { params }: { params: { orderId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: params.orderId, clinicId: ctx.clinicId },
    include: orderInclude,
  });
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  return NextResponse.json(toDentalLabOrderDTO(order));
}

// PATCH /api/ordenes-laboratorio/[orderId] — cancela la orden de la clínica.
// Solo permitido si la orden NO está en un estado terminal y la transición
// hacia "CANCELADA" es válida según el flujo canónico. Registra el evento de
// cancelación en la línea de tiempo (DentalLabOrderEvent).
export async function PATCH(_req: NextRequest, { params }: { params: { orderId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: params.orderId, clinicId: ctx.clinicId },
    select: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  if (isTerminalLabStatus(order.status) || !canTransition(order.status, "CANCELADA")) {
    return NextResponse.json(
      { error: `No se puede cancelar una orden en estado "${order.status}".` },
      { status: 409 },
    );
  }

  // Nombre del actor a partir del usuario de sesión (firstName/lastName).
  const actorName =
    [ctx.user?.firstName, ctx.user?.lastName].filter(Boolean).join(" ").trim() || null;

  // Multi-tenant ya verificado arriba (findFirst con clinicId): el update se
  // ancla por id único, como en el PATCH del lado proveedor.
  const now = new Date();
  const updated = await prisma.dentalLabOrder.update({
    where: { id: order.id },
    data: {
      status: "CANCELADA",
      cancelledAt: now,
      events: {
        create: {
          status: "CANCELADA",
          at: now,
          actorId: ctx.userId,
          actorName,
          actorRole: "CLINIC",
          detail: "Orden cancelada por la clínica.",
        },
      },
    },
    include: orderInclude,
  });

  return NextResponse.json(toDentalLabOrderDTO(updated));
}
