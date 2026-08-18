import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { markWhatsAppMessageRead } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.enum(["UNREAD", "READ", "ARCHIVED", "SNOOZED"]).optional(),
  assignedToId: z.string().nullable().optional(),
  patientId: z.string().nullable().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  subject: z.string().min(1).max(200).optional(),
  tags: z.array(z.string()).optional(),
  // Pausar/reactivar el bot de WhatsApp en este hilo desde el detalle del Inbox.
  botActive: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, "no fields to update");

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí, pero aplicando el gate
// de plan vencido que las copias locales se saltaban. ctx.user es la fila
// User (include clinic) con permissionsOverride normalizado.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const denied = denyIfMissingPermission(dbUser, "inbox.view");
    if (denied) return denied;
    const thread = await prisma.inboxThread.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        messages: {
          orderBy: { sentAt: "asc" },
          // Este select ES el contrato que espera `ThreadMessage` en
          // inbox-client.tsx, copiado tal cual del GET de
          // /api/inbox/threads/[id]/messages para que los dos endpoints no
          // vuelvan a divergir. Antes faltaban externalId y los campos de
          // entrega: un recordatorio que Meta RECHAZÓ se pintaba como entregado
          // y sin motivo, y todo envío automático salía etiquetado "DaleControl"
          // en vez de "Recordatorio"/"Receta"/"Consentimiento" (solo se
          // arreglaba solo en lo que reenviaba /since).
          select: {
            id: true,
            direction: true,
            body: true,
            attachments: true,
            sentAt: true,
            isInternal: true,
            externalId: true,
            // Entrega REAL reportada por Meta (M-06): la palomita del Inbox se
            // pintaba a partir de "el envío no lanzó", que solo significa que Meta
            // ACEPTÓ el mensaje. Null = todavía sin dato, no "no llegó".
            deliveryStatus: true,
            deliveredAt: true,
            readAt: true,
            errorCode: true,
            errorTitle: true,
            sentBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Visibilidad por paciente: si el hilo tiene paciente y está restringido,
    // 404 (mismo status que not_found — no revela su existencia). Hilos sin
    // paciente se permiten.
    if (thread.patientId) {
      const hidden = await assertPatientVisible(thread.patientId, {
        userId: dbUser.id,
        role: dbUser.role,
        clinicId: dbUser.clinicId,
      });
      if (hidden) return hidden;
    }
    return NextResponse.json({ thread });
  } catch (err) {
    if ((err as { code?: string }).code === "P2021") {
      return NextResponse.json(
        { error: "schema_not_migrated", hint: "Aplica migración inbox." },
        { status: 503 },
      );
    }
    console.error("[GET inbox/threads/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const denied = denyIfMissingPermission(dbUser, "inbox.send");
    if (denied) return denied;
    const body = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const existing = await prisma.inboxThread.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true, patientId: true, channel: true },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Visibilidad por paciente: si el hilo ya tiene un paciente restringido, no
    // permitir modificarlo (404, no revela su existencia).
    if (existing.patientId) {
      const hidden = await assertPatientVisible(existing.patientId, {
        userId: dbUser.id,
        role: dbUser.role,
        clinicId: dbUser.clinicId,
      });
      if (hidden) return hidden;
    }

    // FK del body acotados a la clínica de la sesión (mismo patrón que el
    // POST de threads): un patientId ajeno vinculado aquí filtraría su PII
    // vía el GET de este mismo thread.
    if (parsed.data.patientId != null) {
      const patient = await prisma.patient.findFirst({
        where: { id: parsed.data.patientId, clinicId: dbUser.clinicId },
        select: { id: true },
      });
      if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
    }
    if (parsed.data.assignedToId != null) {
      const assignee = await prisma.user.findFirst({
        where: { id: parsed.data.assignedToId, clinicId: dbUser.clinicId, isActive: true },
        select: { id: true },
      });
      if (!assignee) return NextResponse.json({ error: "assignee_not_found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.assignedToId !== undefined) data.assignedToId = parsed.data.assignedToId;
    if (parsed.data.patientId !== undefined) data.patientId = parsed.data.patientId;
    if (parsed.data.snoozedUntil !== undefined) {
      data.snoozedUntil = parsed.data.snoozedUntil ? new Date(parsed.data.snoozedUntil) : null;
    }
    if (parsed.data.subject !== undefined) data.subject = parsed.data.subject;
    if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;
    if (parsed.data.botActive !== undefined) data.botActive = parsed.data.botActive;

    const updated = await prisma.inboxThread.update({
      where: { id: params.id },
      data,
      select: {
        id: true, status: true, assignedToId: true, snoozedUntil: true,
        subject: true, tags: true, botActive: true,
      },
    });

    // ── Palomitas azules ──
    // Alguien de la clínica abrió la conversación (READ): se le dice a Meta que
    // el último mensaje del paciente está leído, que es lo que le pinta las dos
    // palomitas azules en SU WhatsApp. Sin esto el paciente ve su mensaje "sin
    // leer" durante horas y vuelve a escribir para preguntar si llegó.
    // BEST-EFFORT ABSOLUTO: si Meta falla, el usuario ya abrió su conversación
    // y la respuesta de este PATCH no puede romperse por una palomita.
    if (parsed.data.status === "READ" && existing.channel === "WHATSAPP") {
      try {
        const lastIn = await prisma.inboxMessage.findFirst({
          where: { threadId: params.id, direction: "IN" },
          orderBy: { sentAt: "desc" },
          select: { externalId: true },
        });
        // Solo un wamid real de Meta: los `sys:` son nuestros y no existen allá.
        if (lastIn?.externalId?.startsWith("wamid.")) {
          // Credenciales solo en esta rama, no en cada PATCH.
          const clinic = await prisma.clinic.findUnique({
            where: { id: dbUser.clinicId },
            select: { waPhoneNumberId: true, waAccessToken: true },
          });
          if (clinic?.waPhoneNumberId && clinic.waAccessToken) {
            await markWhatsAppMessageRead(clinic.waPhoneNumberId, clinic.waAccessToken, lastIn.externalId);
          }
        }
      } catch (err) {
        console.error("[PATCH inbox/threads/:id] no se pudo marcar como leído en WhatsApp:", err);
      }
    }

    return NextResponse.json({ thread: updated });
  } catch (err) {
    console.error("[PATCH inbox/threads/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Permission dedicado para borrar threads. Por default solo
    // SUPER_ADMIN y ADMIN lo tienen; DOCTOR y RECEPTIONIST pueden
    // enviar (inbox.send) pero no borrar.
    const denied = denyIfMissingPermission(dbUser, "inbox.delete");
    if (denied) return denied;
    // Visibilidad por paciente: cargamos el hilo primero; si tiene un paciente
    // restringido, 404 antes de borrar (no revela su existencia).
    const existing = await prisma.inboxThread.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true, patientId: true },
    });
    if (existing?.patientId) {
      const hidden = await assertPatientVisible(existing.patientId, {
        userId: dbUser.id,
        role: dbUser.role,
        clinicId: dbUser.clinicId,
      });
      if (hidden) return hidden;
    }
    await prisma.inboxThread.deleteMany({
      where: { id: params.id, clinicId: dbUser.clinicId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE inbox/threads/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
