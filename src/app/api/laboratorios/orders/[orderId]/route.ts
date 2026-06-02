import { type NextRequest, NextResponse } from "next/server";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/laboratorios/orders-shared";
import type { DentalLabOrderStatus } from "@/lib/laboratorios/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "SOLICITADA",
  "RECIBIDA",
  "ATENDIENDO",
  "ENVIADA",
  "ENTREGADA",
  "CANCELADA",
] as const;

// GET /api/laboratorios/orders/[orderId] → detalle + timeline de un pedido del lab.
export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  const order = await prisma.dentalLabOrder.findFirst({
    // Scopeado por labId → un laboratorio nunca ve el pedido de otro.
    where: { id: params.orderId, labId: ctx.labId },
    include: {
      clinic: { select: { name: true, city: true, state: true, phone: true, email: true } },
      service: { select: { name: true, unit: true } },
      events: { orderBy: { createdAt: "asc" } },
      files: true,
    },
  });

  if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  return NextResponse.json(order, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

// PATCH /api/laboratorios/orders/[orderId] → avanzar el status del pedido.
// Valida la transición con la máquina de estados compartida; transición
// inválida → 400. Cada cambio crea un DentalLabOrderEvent (actorRole='LAB').
export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }
  const payload = (body ?? {}) as { status?: unknown };
  const nextStatus = typeof payload.status === "string" ? payload.status : undefined;

  if (nextStatus === undefined) {
    return NextResponse.json({ error: "Falta el nuevo estatus." }, { status: 400 });
  }
  if (!(VALID_STATUSES as readonly string[]).includes(nextStatus)) {
    return NextResponse.json({ error: "Estado de pedido inválido." }, { status: 400 });
  }

  // Multi-tenant: confirmar que el pedido es de ESTE laboratorio antes de tocarlo.
  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: params.orderId, labId: ctx.labId },
    select: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

  // Transición inválida → 400 (máquina de estados compartida = única fuente de verdad).
  if (!canTransition(order.status, nextStatus as DentalLabOrderStatus)) {
    return NextResponse.json(
      { error: `No se puede pasar de "${order.status}" a "${nextStatus}".` },
      { status: 400 },
    );
  }

  const status = nextStatus as DentalLabOrderStatus;
  const updateData: { status: DentalLabOrderStatus; deliveredAt?: Date; cancelledAt?: Date } = {
    status,
  };
  if (status === "ENTREGADA") updateData.deliveredAt = new Date();
  if (status === "CANCELADA") updateData.cancelledAt = new Date();

  // Actualizar status + registrar el evento en una sola transacción atómica
  // (forma de array → compatible con PgBouncer en transaction mode).
  const [updated] = await prisma.$transaction([
    prisma.dentalLabOrder.update({
      where: { id: order.id },
      data: updateData,
      include: {
        clinic: { select: { name: true } },
        service: { select: { name: true } },
      },
    }),
    prisma.dentalLabOrderEvent.create({
      data: {
        orderId: order.id,
        status,
        at: new Date(),
        actorId: ctx.labUserId,
        actorName: ctx.lab.name,
        actorRole: "LAB",
      },
    }),
  ]);

  return NextResponse.json(updated);
}
