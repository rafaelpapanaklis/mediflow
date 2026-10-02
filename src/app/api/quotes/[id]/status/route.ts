import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { serializeQuote } from "@/lib/quotes/serialize";
import { leerCondiciones } from "@/lib/quotes/condiciones-pago-db";
import { presentQuote } from "@/lib/quotes/present";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { estadoDePresupuesto } from "@/lib/movimientos-paciente/textos";
import { aceptarPresupuesto, fraseDeAceptacion, PresupuestoError } from "@/lib/quotes/cargos.server";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

type Action = "present" | "accept" | "reject";

/**
 * POST /api/quotes/[id]/status  Body: { action: "present" | "accept" | "reject" }
 *
 * - present: DRAFT/EXPIRED → PRESENTED. Genera acceptToken (liga pública) y
 *   asegura una vigencia futura (default +30 días si faltaba o ya venció).
 * - accept:  marca ACCEPTED manualmente desde el panel (sin firma del paciente).
 *            Con `itemIds` (ws1-t6) acepta SOLO esos conceptos: lo demás queda
 *            guardado como «no aceptado» y nunca se carga. Sin `itemIds`, todo.
 * - reject:  marca REJECTED.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: present/accept/reject son mutaciones del presupuesto, la
  // misma superficie que PATCH y DELETE de /api/quotes/[id] — que desde el
  // PR #190 exigen "billing.edit". Una sola llave para toda la edición del
  // presupuesto. No pide "billing.create" a propósito: aquí no nace ninguna
  // factura ni se quema folio; eso pasa en [id]/invoice, que sí lo exige.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.edit");
  if (deniedPerm) return deniedPerm;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const action = body.action as Action;
  if (action !== "present" && action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, status: true, acceptToken: true, validUntil: true, patientId: true },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // Visibilidad por paciente: no permitir cambiar el estado (ni recibir el
  // presupuesto con nombre del paciente) a quien no puede ver a ese paciente.
  if (quote.patientId) {
    const denied = await assertPatientVisible(quote.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  if (action === "present") {
    // Token + vigencia + auditoría viven en lib/quotes/present, COMPARTIDOS
    // con POST /api/quotes/[id]/send-whatsapp (que presenta un DRAFT antes de
    // mandar la liga pública por WhatsApp).
    const presented = await presentQuote({
      current: quote,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
    });
    if (!presented.ok) {
      return NextResponse.json(
        { error: presented.error ?? "No se pudo presentar el presupuesto." },
        { status: presented.httpStatus ?? 409 },
      );
    }
    return NextResponse.json(serializeQuote(presented.quote, (await leerCondiciones(prisma, quote.id)).condiciones));
  }

  if (action === "accept") {
    // Aceptación por concepto (ws1-t6): transacción con el presupuesto
    // bloqueado, copia del precio de cada concepto y si se aceptó o no. Sin
    // el SQL acepta todo, como siempre, y rechaza una selección parcial.
    let aceptado;
    try {
      aceptado = await aceptarPresupuesto({
        quoteId: quote.id,
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        via: "panel",
        itemIds: body.itemIds,
        desde: ["DRAFT", "PRESENTED", "EXPIRED"],
      });
    } catch (e) {
      if (e instanceof PresupuestoError) return NextResponse.json({ error: e.message }, { status: e.http });
      throw e;
    }
    const leido = await prisma.quote.findFirst({
      where: { id: quote.id, clinicId: ctx.clinicId },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        createdBy: { select: { firstName: true, lastName: true } },
        patient: { select: { firstName: true, lastName: true } },
      },
    });
    if (!leido) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    await logAudit({
      patientId: quote.patientId,
      texto: fraseDeAceptacion(aceptado.renglones, Number(leido.total) || 0),
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "quote",
      entityId: quote.id,
      action: "update",
      changes: {
        status: { before: aceptado.status, after: "ACCEPTED" },
        ...(aceptado.renglones
          ? { conceptosAceptados: { before: null, after: aceptado.renglones.filter((r) => r.aceptado).map((r) => r.nombre) } }
          : {}),
      },
    });
    return NextResponse.json(serializeQuote(leido, (await leerCondiciones(prisma, quote.id)).condiciones));
  }

  const data: any = {};
  const now = new Date();

  {
    // reject
    if (quote.status === "ACCEPTED") {
      return NextResponse.json({ error: "El presupuesto ya fue aceptado" }, { status: 409 });
    }
    data.status = "REJECTED";
    data.rejectedAt = now;
  }

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data,
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });

  await logAudit({
    patientId: quote.patientId,
    texto: `Cambió el presupuesto de «${estadoDePresupuesto(quote.status)}» a «${estadoDePresupuesto(updated.status)}»`,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "update",
    changes: { status: { before: quote.status, after: updated.status } },
  });

  return NextResponse.json(serializeQuote(updated, (await leerCondiciones(prisma, quote.id)).condiciones));
}
