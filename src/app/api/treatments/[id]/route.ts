import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { logMutation } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { cuerpoPlanConNota } from "@/lib/treatments/borrar-plan";
import { notasQueImpidenBorrar } from "@/lib/treatments/borrar-plan.server";
import { consumeFefoTx, esErrorDeLotesNoAplicados, InsufficientStockError } from "@/lib/inventory/lots.server";
import { consumeRecipeForSession } from "@/lib/inventory/recipe.server";
import { aPesos, conProcedimientosValidos, filaDto, leerFilas, planearCambios, totalCentavos, type FilaDelPlan, type FilaEntrante } from "@/lib/treatments/items";
import { bloquearPlan, FilaError, procedimientosDeLaClinica, repoFilas, tablaDeFilasExiste } from "@/lib/treatments/items-db";
import { cuerpoDeErrorDeFila } from "@/lib/treatments/errores";
import { asegurarNotaDelPlan } from "@/lib/treatments/cobro.server";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
      const procedure = await prisma.procedureCatalog.findFirst({ where: { id: procedureId, clinicId: ctx.clinicId }, select: { id: true } });
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
    // H17: materiales sin existencias vigentes (solo caducados). Avisa, no bloquea.
    const avisosSinVigentes: string[] = [];
    const manualConsumido = new Map<string, number>();

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
          for (const c of consumo) if (c.sinVigentes) avisosSinVigentes.push(c.sinVigentes.mensaje);
        }

        for (const it of invItems) {
          const item = dbItems.find(d => d.id === it.id)!;
          const r = await consumeFefoTx(tx, {
            clinicId:           ctx.clinicId,
            itemId:             it.id,
            itemName:           item.name,
            qty:                Number(it.qty),
            reason:             `Sesión ${nextNumber} — ${plan.name}`,
            userId:             ctx.userId,
            treatmentSessionId: session.id,
          });
          if (r.sinVigentes) {
            avisosSinVigentes.push(r.sinVigentes.mensaje);
            manualConsumido.set(it.id, r.sinVigentes.consumed);
          }
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
        ...invItems.map(i => ({ itemId: i.id, itemName: i.name, qtyConsumed: manualConsumido.get(i.id) ?? Number(i.qty) })),
      ],
      ...(avisosSinVigentes.length > 0 ? { avisosExistencias: avisosSinVigentes } : {}),
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

  // ws1-t12 · P2: `items` es el plan ENTERO, en su orden (contrato en lib/treatments/items.ts:
  // sin id = alta; con id = cambio; la que ya no viene se CANCELA, nunca se borra; una hecha o ya
  // cobrada no se calla). Sin la tabla se ignora y el plan se guarda como hoy (texto).
  let entrantes: FilaEntrante[] | null = null;
  if (body.items !== undefined && (await tablaDeFilasExiste())) {
    const lectura = leerFilas(body.items);
    if (!lectura.ok) return NextResponse.json(cuerpoDeErrorDeFila(lectura.codigo!, lectura.indice), { status: 400 });
    const validos = await procedimientosDeLaClinica(ctx.clinicId, lectura.filas!.map((f) => f.procedureId));
    entrantes = conProcedimientosValidos(lectura.filas!, validos);
  }

  let filasAntes: FilaDelPlan[] = [];
  let filasDespues: FilaDelPlan[] = [];
  if (entrantes) {
    try {
      await prisma.$transaction(async (tx) => {
        await bloquearPlan(tx, ctx.clinicId, params.id);
        filasAntes = await repoFilas.leer(ctx.clinicId, params.id, { conCanceladas: true, db: tx });
        const cambios = planearCambios(filasAntes, entrantes!);
        if (!cambios.ok) throw new FilaError(cambios.codigo ?? "fila_desconocida", String(cambios.indice ?? ""));
        filasDespues = await repoFilas.aplicarCambios(tx, { clinicId: ctx.clinicId, planId: params.id, userId: ctx.userId, cambios });
        // Con filas, el costo del plan sigue a las filas (salvo que lo manden escrito): la primera vez
        // es lo que suman; después se mueve lo mismo que ellas, así un descuento que traía (el de un
        // presupuesto aceptado) no se pierde al agregar una fila.
        if (body.totalCost === undefined) {
          const antes = totalCentavos(filasAntes);
          const despues = totalCentavos(filasDespues);
          if (antes === 0) data.totalCost = aPesos(despues);
          else if (antes !== despues) data.totalCost = Math.max(0, Math.round((Number(plan.totalCost) || 0) * 100 + despues - antes) / 100);
        }
        await tx.treatmentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data });
      }, { maxWait: 10_000, timeout: 15_000 });
    } catch (e) {
      if (e instanceof FilaError) {
        const indice = e.message && /^\d+$/.test(e.message) ? Number(e.message) : null;
        return NextResponse.json(cuerpoDeErrorDeFila(e.codigo, indice), { status: 409 });
      }
      throw e;
    }
  } else {
    await prisma.treatmentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data });
  }

  // Un plan ya aceptado que CRECE (fila nueva): la fila va a su nota de cobro (si la nota sigue por
  // cobrar la recibe; si ya está pagada, nace una nota adicional del plan). Reordenar o corregir un
  // diente no toca la nota. Nace dinero, así que pide `billing.create`; sin él la fila queda «por
  // facturar» (la cuenta del plan lo enseña) para quien sí factura. Sin tumbar el guardado.
  let notaDelPlan: Awaited<ReturnType<typeof asegurarNotaDelPlan>> | { estado: "error" | "sin_permiso" } | null = null;
  const antes = new Set(filasAntes.map((f) => f.id));
  const crecio = filasDespues.some((f) => !antes.has(f.id));
  if (entrantes && crecio && denyIfMissingPermission(ctx, "billing.create")) {
    notaDelPlan = { estado: "sin_permiso" };
  } else if (entrantes && crecio) {
    try {
      notaDelPlan = await asegurarNotaDelPlan({ clinicId: ctx.clinicId, planId: params.id, userId: ctx.userId, origen: "plan_crece", soloSiAceptado: true });
    } catch (e) {
      console.error("[plan:editar] no se pudo actualizar la nota de cobro del plan:", e);
      notaDelPlan = { estado: "error" };
    }
  }

  // NOM-024 §6.3.5 — bitácora: edición general del plan (solo campos cambiados).
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "treatment",
    entityId:   params.id,
    action:     "update",
    before:     {
      name: plan.name, description: plan.description, totalCost: Number(plan.totalCost), totalSessions: plan.totalSessions, sessionIntervalDays: plan.sessionIntervalDays,
      ...(entrantes ? { procedimientos: resumenParaBitacora(filasAntes) } : {}),
    },
    after:      {
      name: data.name ?? plan.name, description: data.description ?? plan.description, totalCost: data.totalCost ?? Number(plan.totalCost), totalSessions: data.totalSessions ?? plan.totalSessions, sessionIntervalDays: data.sessionIntervalDays ?? plan.sessionIntervalDays,
      ...(entrantes ? { procedimientos: resumenParaBitacora(filasDespues) } : {}),
    },
  });

  revalidateAfter("treatments");
  return NextResponse.json({
    success: true,
    ...(entrantes ? { items: filasDespues.map(filaDto), notaDelPlan } : {}),
  });
}

/** «Resina 16 (MO) ×1 $1,250.00 · pendiente» por fila viva — lo que cambia se ve en Movimientos/bitácora. */
function resumenParaBitacora(filas: FilaDelPlan[]): string[] {
  return filas
    .filter((f) => f.estado !== "cancelado")
    .map((f) => `${f.nombre}${f.dientes.length ? ` ${f.dientes.join(",")}` : ""}${f.caras.length ? ` (${f.caras.join("")})` : ""} ×${f.cantidad} $${aPesos(f.precioCentavos).toFixed(2)} · ${f.estado}`);
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
  // ws1-t12 · fase 2: con nota de cobro no se borra (lib/treatments/borrar-plan.ts); se cancela. Con
  // el plan bloqueado: «Aceptar el plan» en otra pestaña no cuela su nota entre la comprobación y el borrado.
  const notas = await prisma.$transaction(async (tx) => {
    await bloquearPlan(tx, ctx.clinicId, params.id);
    const conNota = await notasQueImpidenBorrar(ctx.clinicId, params.id, tx);
    if (conNota.length === 0) await tx.treatmentPlan.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
    return conNota;
  }, { maxWait: 10_000, timeout: 15_000 });
  if (notas.length > 0) return NextResponse.json(cuerpoPlanConNota(notas), { status: 409 });

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
