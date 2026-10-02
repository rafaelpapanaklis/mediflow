import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { cuerpoDoctorNoRecibeCitasDe } from "@/lib/agenda/roles-que-atienden-db";
import { iniciarConsultaWalkIn } from "@/lib/walk-in/iniciar-consulta";
import { cerrarFilaConSuCita } from "@/lib/walk-in/cerrar-con-cita";

// «Asignar» solo MARCA quién atenderá; «Iniciar» crea la cita (ver src/lib/walk-in/iniciar-consulta.ts).
// Contrato de la fila: el cliente manda `{ action }` (y `assignedTo` al asignar). El servidor decide el estado
// y las marcas de tiempo; antes solo leía status/assignedTo/startedAt/completedAt, así que «Asignar», «Iniciar» y
// «Cancelar» contestaban 200 sin cambiar nada (ws1-t4).
const ACCIONES = {
  assign: { desde: ["WAITING", "ASSIGNED"], a: "ASSIGNED" },
  start: { desde: ["WAITING", "ASSIGNED"], a: "IN_PROGRESS" },
  complete: { desde: ["IN_PROGRESS"], a: "COMPLETED" },
  cancel: { desde: ["WAITING", "ASSIGNED", "IN_PROGRESS"], a: "CANCELLED" },
} as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "agenda.edit");
  if (denied) return denied;
  if (!ctx.clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entry = await prisma.walkInQueue.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!entry) return NextResponse.json({ error: "Queue entry not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  if (!Object.prototype.hasOwnProperty.call(ACCIONES, action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const regla = ACCIONES[action as keyof typeof ACCIONES];

  // «Iniciar» crea la cita del momento (decisión 8, ws1-t4): vive en su propio módulo, con su transacción.
  if (action === "start") {
    if (!(regla.desde as readonly string[]).includes(entry.status)) {
      return NextResponse.json({ error: "invalid_transition", status: entry.status }, { status: 409 });
    }
    const r = await iniciarConsultaWalkIn({
      req,
      actor: { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId },
      entry,
      assignedTo: typeof body?.assignedTo === "string" ? body.assignedTo : null,
    });
    if ("body" in r) {
      return NextResponse.json(r.body.error === "invalid_transition" ? { ...r.body, status: entry.status } : r.body, { status: r.status });
    }
    return NextResponse.json(await prisma.walkInQueue.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } }));
  }

  // «Completar»/«Cancelar» cierran también la cita que creó «Iniciar» (src/lib/walk-in/cerrar-con-cita.ts).
  if (action === "complete" || action === "cancel") {
    // Cancelar una fila que ya es cita (en atención) cancela una cita: el mismo permiso que en la Agenda.
    if (action === "cancel" && entry.status === "IN_PROGRESS") {
      const sinBorrar = denyIfMissingPermission(ctx, "agenda.delete");
      if (sinBorrar) return sinBorrar;
    }
    const r = await cerrarFilaConSuCita({
      req,
      actor: { userId: ctx.userId, clinicId: ctx.clinicId },
      fila: entry,
      accion: action,
      desde: regla.desde,
    });
    if ("body" in r) return NextResponse.json({ ...r.body, status: entry.status }, { status: r.status });
    return NextResponse.json(await prisma.walkInQueue.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } }));
  }

  const data: Record<string, unknown> = { status: regla.a };
  if (action === "assign") {
    const assignedTo = typeof body?.assignedTo === "string" ? body.assignedTo : "";
    if (!assignedTo) return NextResponse.json({ error: "assignedTo_required" }, { status: 400 });
    // La misma regla única de «quién puede recibir citas» que la Agenda (ws1-t10), con el tenant de la sesión.
    const profesional = await prisma.user.findFirst({
      where: { id: assignedTo, clinicId: ctx.clinicId, ...RECIBE_CITAS_WHERE },
      select: { id: true },
    });
    // Con el MOTIVO concreto (recepción, cuenta inactiva, casilla apagada…), como Citas y la lista de espera.
    if (!profesional) return NextResponse.json(await cuerpoDoctorNoRecibeCitasDe(ctx.clinicId, assignedTo), { status: 404 });
    data.assignedTo = profesional.id;
  }

  // La transición se valida en la misma escritura (status en el where): dos clics a la vez no la pisan.
  const { count } = await prisma.walkInQueue.updateMany({
    where: { id: params.id, clinicId: ctx.clinicId, status: { in: [...regla.desde] } },
    data,
  });
  if (count === 0) {
    return NextResponse.json({ error: "invalid_transition", status: entry.status }, { status: 409 });
  }

  const updated = await prisma.walkInQueue.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "agenda.edit");
  if (denied) return denied;

  const entry = await prisma.walkInQueue.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!entry) return NextResponse.json({ error: "Queue entry not found" }, { status: 404 });

  await prisma.walkInQueue.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });

  return NextResponse.json({ success: true });
}
