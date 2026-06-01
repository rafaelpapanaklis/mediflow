import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type { DentalLabOrderDTO } from "@/lib/laboratorios/types";

// Include canónico para las órdenes de laboratorio del lado clínica: trae el
// lab, el servicio, la línea de tiempo (events) y los archivos. Mantiene la
// MISMA forma que el DTO declarado en `@/lib/laboratorios/types`.
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

// GET /api/ordenes-laboratorio — órdenes de laboratorio de la clínica (más
// recientes primero).
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const orders = await prisma.dentalLabOrder.findMany({
    where: { clinicId: ctx.clinicId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(orders.map(toDentalLabOrderDTO));
}
