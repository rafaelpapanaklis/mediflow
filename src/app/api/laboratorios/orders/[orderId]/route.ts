import { type NextRequest, NextResponse } from "next/server";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/laboratorios/orders-shared";
import type { DentalLabOrderStatus, DentalLabPaymentStatus } from "@/lib/laboratorios/types";
import { isB2BPaymentMethod } from "@/lib/payments-b2b";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "SOLICITADA",
  "RECIBIDA",
  "ATENDIENDO",
  "ENVIADA",
  "ENTREGADA",
  "CANCELADA",
] as const;

const VALID_PAYMENTS = ["UNPAID", "PAID"] as const;

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

// PATCH /api/laboratorios/orders/[orderId] → avanzar el status del pedido y/o
// marcar el pago. Acepta { status?, paymentStatus?, paymentMethod? }:
//   - status: valida la transición con la máquina de estados compartida
//     (inválida → 400) y registra un DentalLabOrderEvent (actorRole='LAB').
//   - paymentStatus: solo el VENDEDOR marca a mano (transferencia/efectivo);
//     PAID ⇒ paidAt=now; UNPAID ⇒ paidAt=null. (MercadoPago lo marca el webhook.)
//   - paymentMethod (opcional, B2B válido): se persiste si viene.
// Un update solo-de-pago NO crea evento de timeline (espejo del lado proveedor).
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
  const payload = (body ?? {}) as {
    status?: unknown;
    paymentStatus?: unknown;
    paymentMethod?: unknown;
  };
  const nextStatus = typeof payload.status === "string" ? payload.status : undefined;
  const nextPayment = typeof payload.paymentStatus === "string" ? payload.paymentStatus : undefined;
  const nextMethod = typeof payload.paymentMethod === "string" ? payload.paymentMethod : undefined;

  if (nextStatus === undefined && nextPayment === undefined) {
    return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
  }
  if (nextStatus !== undefined && !(VALID_STATUSES as readonly string[]).includes(nextStatus)) {
    return NextResponse.json({ error: "Estado de pedido inválido." }, { status: 400 });
  }
  if (nextPayment !== undefined && !(VALID_PAYMENTS as readonly string[]).includes(nextPayment)) {
    return NextResponse.json({ error: "Estado de pago inválido." }, { status: 400 });
  }
  if (nextMethod !== undefined && !isB2BPaymentMethod(nextMethod)) {
    return NextResponse.json({ error: "Método de pago inválido." }, { status: 400 });
  }

  // Multi-tenant: confirmar que el pedido es de ESTE laboratorio antes de tocarlo.
  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: params.orderId, labId: ctx.labId },
    select: { id: true, status: true, paymentStatus: true },
  });
  if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

  const updateData: {
    status?: DentalLabOrderStatus;
    deliveredAt?: Date;
    cancelledAt?: Date;
    paymentStatus?: DentalLabPaymentStatus;
    paidAt?: Date | null;
    paymentMethod?: string;
  } = {};

  // ── Cambio de status (con validación de transición + evento). ──
  let statusChanged = false;
  if (nextStatus !== undefined) {
    const status = nextStatus as DentalLabOrderStatus;
    // Transición inválida → 400 (máquina de estados compartida = única fuente de verdad).
    if (!canTransition(order.status, status)) {
      return NextResponse.json(
        { error: `No se puede pasar de "${order.status}" a "${nextStatus}".` },
        { status: 400 },
      );
    }
    updateData.status = status;
    if (status === "ENTREGADA") updateData.deliveredAt = new Date();
    if (status === "CANCELADA") updateData.cancelledAt = new Date();
    statusChanged = true;
  }

  // ── Cambio de pago (lo marca el vendedor a mano). ──
  // Idempotente: solo tocamos paymentStatus/paidAt si REALMENTE cambia. Así
  // re-marcar PAID no pisa el paidAt original ni compite con el webhook (que ya
  // es idempotente con su propio guard order.paymentStatus !== "PAID").
  if (nextPayment !== undefined && nextPayment !== order.paymentStatus) {
    const paymentStatus = nextPayment as DentalLabPaymentStatus;
    updateData.paymentStatus = paymentStatus;
    updateData.paidAt = paymentStatus === "PAID" ? new Date() : null;
  }
  if (nextMethod !== undefined) {
    updateData.paymentMethod = nextMethod;
  }

  const orderUpdate = prisma.dentalLabOrder.update({
    where: { id: order.id },
    data: updateData,
    include: {
      clinic: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  // Si cambió el status, registramos el evento en la misma transacción atómica
  // (forma de array → compatible con PgBouncer en transaction mode). Un update
  // solo-de-pago no genera evento de timeline.
  let updated;
  if (statusChanged && updateData.status) {
    const [u] = await prisma.$transaction([
      orderUpdate,
      prisma.dentalLabOrderEvent.create({
        data: {
          orderId: order.id,
          status: updateData.status,
          at: new Date(),
          actorId: ctx.labUserId,
          actorName: ctx.lab.name,
          actorRole: "LAB",
        },
      }),
    ]);
    updated = u;
  } else {
    updated = await orderUpdate;
  }

  return NextResponse.json(updated);
}
