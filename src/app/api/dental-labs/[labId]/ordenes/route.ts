import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { makeDentalLabOrderNumber } from "@/lib/laboratorios/types";

// POST /api/dental-labs/[labId]/ordenes — la clínica solicita una orden a un
// laboratorio. Crea el DentalLabOrder en status SOLICITADA + su primer
// DentalLabOrderEvent (actor CLINIC). NO hay pasarela: paymentStatus arranca
// UNPAID y el pago se acuerda offline.
//
// SEGURIDAD MULTI-TENANT:
//   - clinicId SIEMPRE de la sesión (getAuthContext) — NUNCA del body.
//   - labId SIEMPRE del path — NUNCA del body.
//   - serviceId (si viene) debe ser un servicio activo de ESTE lab.
//
// Body: { serviceId?, patientName?, internalRef?, notes?, priority? }
export async function POST(
  req: NextRequest,
  { params }: { params: { labId: string } }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const labId = params.labId;

  // El laboratorio debe existir y seguir APPROVED al momento de solicitar.
  const lab = await prisma.dentalLab.findFirst({
    where: { id: labId, status: "APPROVED" },
    select: { id: true },
  });
  if (!lab) {
    return NextResponse.json(
      { error: "Este laboratorio no está disponible en este momento." },
      { status: 404 }
    );
  }

  const body = await req.json().catch(() => null);
  const serviceIdRaw =
    typeof body?.serviceId === "string" && body.serviceId.trim()
      ? body.serviceId.trim()
      : null;
  const patientName =
    typeof body?.patientName === "string" && body.patientName.trim()
      ? body.patientName.trim()
      : null;
  const internalRef =
    typeof body?.internalRef === "string" && body.internalRef.trim()
      ? body.internalRef.trim()
      : null;
  const notes =
    typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const priority = body?.priority === true;

  // Si viene serviceId, debe ser un servicio ACTIVO de este lab. Congela el
  // precio base al momento de solicitar.
  let serviceId: string | null = null;
  let basePrice = 0;
  if (serviceIdRaw) {
    const service = await prisma.dentalLabService.findFirst({
      where: { id: serviceIdRaw, labId, isActive: true },
      select: { id: true, priceFrom: true },
    });
    if (!service) {
      return NextResponse.json(
        { error: "Servicio no válido para este laboratorio" },
        { status: 400 }
      );
    }
    serviceId = service.id;
    basePrice = service.priceFrom;
  }

  const actorName =
    `${ctx.user?.firstName ?? ""} ${ctx.user?.lastName ?? ""}`.trim() ||
    ctx.user?.email ||
    null;

  // Orden + primer evento del timeline en una sola escritura atómica.
  const order = await prisma.dentalLabOrder.create({
    data: {
      orderNumber: makeDentalLabOrderNumber(),
      clinicId: ctx.clinicId, // ← SIEMPRE de sesión
      labId, // ← del path
      serviceId,
      patientName,
      internalRef,
      notes,
      priority,
      status: "SOLICITADA",
      basePrice,
      total: basePrice,
      events: {
        create: {
          status: "SOLICITADA",
          at: new Date(),
          actorId: ctx.userId,
          actorName,
          actorRole: "CLINIC",
          detail: "Orden solicitada por la clínica",
        },
      },
    },
    select: { id: true, orderNumber: true, status: true },
  });

  return NextResponse.json(
    {
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
    },
    { status: 201 }
  );
}
