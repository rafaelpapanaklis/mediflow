import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { PLAN_STATUS } from "@/lib/payment-plans/status";
import { calcularLetras } from "@/lib/payment-plans/letras";
import { DEFAULT_INVOICE_TZ } from "@/lib/invoices/due-date";
import { todayInTz, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { assertPatientVisible, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

// GET /api/payment-plans?patientId=xxx
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: el plan de pagos es dinero del paciente (total, enganche,
  // cuota a cuota y qué queda por cobrar). Leerlo es leer facturación, así que
  // pide la misma key que GET /api/invoices: "billing.view".
  const deniedPerm = denyIfMissingPermission(ctx, "billing.view");
  if (deniedPerm) return deniedPerm;

  const patientId = new URL(req.url).searchParams.get("patientId");

  const plans = await prisma.paymentPlan.findMany({
    where: {
      clinicId:  ctx.clinicId,
      ...(patientId ? { patientId } : {}),
      // Visibilidad por paciente. Filtro de RELACIÓN (no un assert) porque
      // patientId es opcional: sin él, esto listaba los planes de TODA la
      // clínica, restringidos incluidos.
      AND: relatedPatientVisibilityAnd({
        userId: ctx.userId,
        role: ctx.role,
        clinicId: ctx.clinicId,
      }),
    },
    include: {
      patient:  { select: { id: true, firstName: true, lastName: true } },
      payments: { orderBy: { installment: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(plans);
}

// POST /api/payment-plans — create plan + generate installments
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: un plan de pagos es el INSTRUMENTO DE COBRO de la
  // clínica — arma el calendario de cuotas sobre el que luego se registran los
  // pagos. Los tres handlers de escritura de este módulo comparten "billing.charge"
  // (la misma key que ya exige registrar un pago en POST /api/invoices/[id]):
  // una sola llave para toda la superficie de operar el plan, igual que el
  // PR #190 hizo con PATCH/DELETE de /api/quotes/[id] y "billing.edit".
  const deniedPerm = denyIfMissingPermission(ctx, "billing.charge");
  if (deniedPerm) return deniedPerm;

  const body = await req.json();
  const { patientId, invoiceId, name, totalAmount, downPayment, installments, frequency, startDate, notes } = body;

  if (!patientId || !name || !totalAmount || !installments) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  }

  // Montos, número de letras, frecuencia y fechas se validan y reparten en
  // centavos enteros ANTES de tocar la base (lib/payment-plans/letras.ts): antes
  // un enganche mayor al total o $1 en 150 letras dejaban letras negativas.
  const tz = (ctx.clinic?.timezone as string | null | undefined) || DEFAULT_INVOICE_TZ;
  const calculo = calcularLetras({ totalAmount, downPayment, installments, frequency, startDate }, todayInTz(tz));
  if (calculo.error || !calculo.plan) {
    return NextResponse.json({ error: calculo.error ?? "Datos inválidos" }, { status: 400 });
  }
  const letras = calculo.plan;

  // Multi-tenant verification: ensure patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where:  { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  // Visibilidad por paciente: no crear planes sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  if (invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where:  { id: invoiceId, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }
  }

  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.paymentPlan.create({
      data: {
        clinicId:     ctx.clinicId,
        patientId,
        invoiceId:    invoiceId ?? null,
        name,
        totalAmount:  letras.totalAmount,
        downPayment:  letras.downPayment,
        installments: letras.installments,
        frequency:    letras.frequency,
        // Día → 00:00 de ESE día en la zona de la clínica (mismo criterio que el
        // «Vence el» de las facturas): `new Date("2026-10-01")` en Vercel es el
        // 30 de septiembre a las 18:00 en México.
        startDate:    tzLocalToUtc(letras.startDate, 0, 0, tz),
        notes:        notes ?? null,
        status:       PLAN_STATUS.ACTIVE,
      },
    });

    const installmentData = letras.letras.map((l) => ({
      planId:      created.id,
      installment: l.installment,
      amount:      l.amount,
      dueDate:     tzLocalToUtc(l.fecha, 0, 0, tz),
    }));

    await tx.planPayment.createMany({ data: installmentData });
    return created;
  });

  const result = await prisma.paymentPlan.findUnique({
    where:   { id: plan.id },
    include: { payments: { orderBy: { installment: "asc" } } },
  });

  return NextResponse.json(result, { status: 201 });
}
