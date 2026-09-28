import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { logMutation } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { consumeFefoTx, esErrorDeLotesNoAplicados, InsufficientStockError } from "@/lib/inventory/lots.server";
import { consumeRecipeForSession } from "@/lib/inventory/recipe.server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // EQ-07: registrar sesiones, cambiar estado y editar el plan → "Crear y
  // editar planes de tratamiento". El doctor sigue acotado a sus planes.
  const deniedPerm = denyIfMissingPermission(ctx, "treatments.edit");
  if (deniedPerm) return deniedPerm;

  const plan = await prisma.treatmentPlan.findFirst({
    where:   { id: params.id, clinicId: ctx.clinicId },
    include: { sessions: { orderBy: { sessionNumber: "asc" } } },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (plan.patientId) {
    const denied = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }
  if (ctx.isDoctor && plan.doctorId !== ctx.userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();

  // ── add_session with optional inventory deduction ─────────────────────────
  // WS1-T5: el descuento se movió DESPUÉS de crear la sesión y vive en la
  // MISMA transacción que ella (antes eran pasos sueltos: el stock se
  // descontaba primero y, si algo fallaba al crear la sesión, quedaba
  // descontado sin sesión que lo explique). El chequeo de stock ahora corre
  // DENTRO de la transacción, con el artículo bloqueado (FOR UPDATE, ver
  // consumeFefoTx) — antes se leía fuera y dos sesiones a la vez podían
  // pasar la validación con el mismo stock y dejarlo negativo. Además, si
  // hay receta de materiales (procedureId) o insumos elegidos a mano, el
  // consumo se hace por LOTE (FEFO), no por cantidad plana del artículo.
  if (body.action === "add_session") {
    const completedCount = plan.sessions.filter(s => s.completedAt !== null).length;
    const nextNumber     = completedCount + 1;

    if (nextNumber > plan.totalSessions) {
      return NextResponse.json({ error: "El plan ya tiene todas las sesiones completadas" }, { status: 400 });
    }

    // inventoryItems: [{ id, qty, name }] — selección manual de insumos,
    // como hoy. procedureId (WS1-T5): si el procedimiento del catálogo
    // tiene receta de materiales, se descuenta también, sola.
    const invItems: { id: string; qty: number; name: string }[] = body.inventoryItems ?? [];
    const procedureId: string | null = body.procedureId ? String(body.procedureId) : null;

    for (const it of invItems) {
      // EQ — una cantidad negativa o cero no puede "consumir" insumo: eso
      // subiría existencias por la puerta de atrás con solo treatments.edit.
      if (!(Number(it.qty) > 0)) {
        return NextResponse.json({ error: `Cantidad inválida para "${it.name}": ${it.qty}` }, { status: 400 });
      }
    }
    if (procedureId) {
      const procedure = await prisma.procedureCatalog.findFirst({ where: { id: procedureId, clinicId: ctx.clinicId } });
      if (!procedure) return NextResponse.json({ error: "Procedimiento no encontrado" }, { status: 404 });
    }
    let dbItems: { id: string; name: string }[] = [];
    if (invItems.length > 0) {
      dbItems = await prisma.inventoryItem.findMany({
        where:  { clinicId: ctx.clinicId, id: { in: invItems.map(i => i.id) } },
        select: { id: true, name: true },
      });
      for (const it of invItems) {
        if (!dbItems.find(d => d.id === it.id)) {
          return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });
        }
      }
    }

    const isCompleted     = nextNumber >= plan.totalSessions;
    const newNextExpected = new Date(Date.now() + plan.sessionIntervalDays * 24 * 60 * 60 * 1000);

    let recetaConsumida: { itemId: string; itemName: string; qtyConsumed: number }[] = [];

    try {
      // ws1-t6 (arreglo N5, ws1-t10 ronda 4): el timeout por defecto de
      // $transaction (5 s) se quedaba corto cuando la receta trae varios
      // insumos — cada uno hace su propio FOR UPDATE dentro de la misma
      // transacción (consumeFefoTx, lots.server.ts) y con dev.108 cargado
      // sumaban más de 5 s: "Transaction already closed… timeout 5000 ms,
      // however 4971 ms passed", 500 crudo. Mismo valor que ya usan otras
      // transacciones largas del repo (spei-directo.ts, barber/booking.ts).
      await prisma.$transaction(async tx => {
        let session;
        try {
          session = await tx.treatmentSession.create({
            data: {
              treatmentId:   params.id,
              sessionNumber: nextNumber,
              notes:         body.notes || null,
              completedAt:   new Date(),
              procedureId,
            },
          });
        } catch (e) {
          // Ajuste 2 (aviso de ws1-t4, §6): procedureId es un campo NUEVO en
          // TreatmentSession (modelo viejo) — un cliente de Prisma sin
          // reiniciar desde antes de este schema no lo reconoce y rechaza
          // TODO el `data`, aunque valga null. Se reintenta sin esa llave:
          // la sesión se crea igual (como antes de este cambio); el
          // descuento por receta de abajo no depende de esta columna, solo
          // de la variable `procedureId` en memoria.
          if (!esErrorDeLotesNoAplicados(e)) throw e;
          session = await tx.treatmentSession.create({
            data: {
              treatmentId:   params.id,
              sessionNumber: nextNumber,
              notes:         body.notes || null,
              completedAt:   new Date(),
            },
          });
        }

        if (procedureId) {
          const consumo = await consumeRecipeForSession(tx, {
            clinicId:           ctx.clinicId,
            procedureId,
            treatmentSessionId: session.id,
            userId:             ctx.userId,
            sessionLabel:       `Sesión ${nextNumber} — ${plan.name}`,
          });
          recetaConsumida = consumo;
        }

        for (const it of invItems) {
          const item = dbItems.find(d => d.id === it.id)!;
          await consumeFefoTx(tx, {
            clinicId:           ctx.clinicId,
            itemId:             it.id,
            itemName:           item.name,
            qty:                Number(it.qty),
            reason:             `Sesión ${nextNumber} — ${plan.name}`,
            userId:             ctx.userId,
            treatmentSessionId: session.id,
          });
        }

        await tx.treatmentPlan.update({
          where: { id: params.id },
          data: {
            nextExpectedDate: isCompleted ? null : newNextExpected,
            status:           isCompleted ? "COMPLETED" : "ACTIVE",
            updatedAt:        new Date(),
          },
        });
      }, { maxWait: 10_000, timeout: 15_000 });
    } catch (err: any) {
      if (err instanceof InsufficientStockError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    // NOM-024 §6.3.5 — bitácora: nueva sesión + cambio de estado del plan.
    await logMutation({
      req,
      clinicId:   ctx.clinicId,
      userId:     ctx.userId,
      entityType: "treatment",
      entityId:   params.id,
      action:     "update",
      before:     { status: plan.status, completedSessions: completedCount },
      after:      { status: isCompleted ? "COMPLETED" : "ACTIVE", completedSessions: nextNumber, addedSession: nextNumber },
    });

    revalidateAfter("treatments");
    return NextResponse.json({
      success:      true,
      sessionNumber: nextNumber,
      completed:     isCompleted,
      materialesDescontados: [
        ...recetaConsumida,
        ...invItems.map(i => ({ itemId: i.id, itemName: i.name, qtyConsumed: Number(i.qty) })),
      ],
    });
  }

  // ── status change ──────────────────────────────────────────────────────────
  if (body.status) {
    if (!["ACTIVE","COMPLETED","ABANDONED","PAUSED"].includes(body.status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }
    await prisma.treatmentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data: { status: body.status } });

    // NOM-024 §6.3.5 — bitácora: cambio de estado del plan.
    await logMutation({
      req,
      clinicId:   ctx.clinicId,
      userId:     ctx.userId,
      entityType: "treatment",
      entityId:   params.id,
      action:     "update",
      before:     { status: plan.status },
      after:      { status: body.status },
    });

    return NextResponse.json({ success: true });
  }

  // ── general update ─────────────────────────────────────────────────────────
  const data: any = { updatedAt: new Date() };
  if (body.name                !== undefined) data.name                = body.name;
  if (body.description         !== undefined) data.description         = body.description;
  if (body.totalCost           !== undefined) data.totalCost           = Number(body.totalCost);
  if (body.totalSessions       !== undefined) data.totalSessions       = Number(body.totalSessions);
  if (body.sessionIntervalDays !== undefined) data.sessionIntervalDays = Number(body.sessionIntervalDays);

  await prisma.treatmentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data });

  // NOM-024 §6.3.5 — bitácora: edición general del plan (solo campos cambiados).
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "treatment",
    entityId:   params.id,
    action:     "update",
    before:     { name: plan.name, description: plan.description, totalCost: Number(plan.totalCost), totalSessions: plan.totalSessions, sessionIntervalDays: plan.sessionIntervalDays },
    after:      { name: data.name ?? plan.name, description: data.description ?? plan.description, totalCost: data.totalCost ?? Number(plan.totalCost), totalSessions: data.totalSessions ?? plan.totalSessions, sessionIntervalDays: data.sessionIntervalDays ?? plan.sessionIntervalDays },
  });

  revalidateAfter("treatments");
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // EQ-07: mismo interruptor que crear y editar.
  const deniedPerm = denyIfMissingPermission(ctx, "treatments.edit");
  if (deniedPerm) return deniedPerm;
  const plan = await prisma.treatmentPlan.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (plan.patientId) {
    const denied = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }
  if (ctx.isDoctor && plan.doctorId !== ctx.userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  await prisma.treatmentPlan.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });

  // NOM-024 §6.3.5 — bitácora: borrado del plan de tratamiento.
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "treatment",
    entityId:   params.id,
    action:     "delete",
    before:     { name: plan.name, patientId: plan.patientId, doctorId: plan.doctorId, status: plan.status },
  });

  revalidateAfter("treatments");
  return NextResponse.json({ success: true });
}
