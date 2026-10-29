import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  PostmarkInboundPayload,
  verifyPostmarkSecret,
} from "@/lib/integrations/postmark-inbound";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/postmark/inbound
 * Cada clínica configura una dirección email tipo
 * "clinica-abc@inbox.dalecontrol.com". Postmark parsea el email entrante y nos
 * envía un JSON. Resolvemos por To → Clinic.postmarkInboundEmail.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("Authorization");
    const expected = process.env.POSTMARK_INBOUND_SECRET;
    if (!verifyPostmarkSecret(expected, auth)) {
      return NextResponse.json({ error: "invalid_secret" }, { status: 401 });
    }

    const payload = (await req.json().catch(() => null)) as PostmarkInboundPayload | null;
    if (!payload) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    // Buscamos la clínica por la dirección To. Soportamos múltiples destinatarios.
    const candidates: string[] = [];
    if (payload.To) candidates.push(payload.To.toLowerCase());
    if (Array.isArray(payload.ToFull)) {
      for (const t of payload.ToFull) candidates.push(t.Email.toLowerCase());
    }

    // Seguridad (auditoría «cloudflare», nº3): antes era un findFirst sin
    // ORDER BY. Si dos clínicas tenían la misma dirección, el correo iba a una
    // cualquiera. Ahora se leen TODAS las que casan: una dirección que tienen
    // dos clínicas es un error y el correo no se entrega a ninguna (409; Postmark
    // lo reintenta, y entra en cuanto se corrija la dirección duplicada). Con
    // varios destinatarios de clínicas distintas manda el primero del To.
    const dueños = candidates.length
      ? await prisma.clinic.findMany({
          where: {
            postmarkInboundEmail: { in: candidates, mode: "insensitive" },
          },
          select: { id: true, postmarkInboundEmail: true },
        })
      : [];

    let clinic: { id: string } | null = null;
    for (const direccion of candidates) {
      const deEsta = dueños.filter((c) => (c.postmarkInboundEmail ?? "").toLowerCase() === direccion);
      if (deEsta.length > 1) {
        console.error("[postmark-inbound] dirección de entrada en más de una clínica; no se entrega", {
          clinicas: deEsta.map((c) => c.id),
        });
        return NextResponse.json({ error: "ambiguous_inbound_address" }, { status: 409 });
      }
      if (deEsta.length === 1 && !clinic) clinic = { id: deEsta[0].id };
    }

    if (!clinic) {
      return NextResponse.json({ ok: true, ignored: "clinic_not_found" });
    }

    // Match patient por From email.
    const fromEmail = payload.From.toLowerCase().trim();
    const patient = fromEmail
      ? await prisma.patient.findFirst({
          where: {
            clinicId: clinic.id,
            email: { equals: fromEmail, mode: "insensitive" },
          },
          select: { id: true },
        })
      : null;

    const now = new Date();
    const externalThreadKey = payload.MessageID;

    // Busca thread existente por subject + clinic + sender, o crea uno nuevo.
    // Postmark no agrupa hilos automáticamente; usamos subject normalizado.
    const normalizedSubject = (payload.Subject ?? "(sin asunto)")
      .replace(/^(Re:|Fwd:|RE:|FW:)\s*/gi, "")
      .trim();

    let thread = await prisma.inboxThread.findFirst({
      where: {
        clinicId: clinic.id,
        channel: "EMAIL",
        subject: normalizedSubject,
        ...(patient?.id ? { patientId: patient.id } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });

    if (!thread) {
      const created = await prisma.inboxThread.create({
        data: {
          clinicId: clinic.id,
          channel: "EMAIL",
          externalId: externalThreadKey,
          patientId: patient?.id ?? null,
          subject: normalizedSubject || `Email · ${fromEmail}`,
          status: "UNREAD",
          lastMessageAt: now,
        },
        select: { id: true },
      });
      thread = created;
    } else {
      await prisma.inboxThread.update({
        where: { id: thread.id },
        data: { status: "UNREAD", lastMessageAt: now },
      });
    }

    const bodyText =
      payload.StrippedTextReply?.trim() ||
      payload.TextBody?.trim() ||
      "(sin contenido)";

    const attachments = (payload.Attachments ?? []).map((a) => ({
      name: a.Name,
      mime: a.ContentType,
      size: a.ContentLength,
      url: "", // Postmark no nos da una URL pública; el caller debe subir a storage si lo necesita.
    }));

    await prisma.inboxMessage.create({
      data: {
        threadId: thread.id,
        direction: "IN",
        body: bodyText,
        externalId: payload.MessageID,
        sentAt: payload.Date ? new Date(payload.Date) : now,
        ...(attachments.length > 0
          ? { attachments: attachments as unknown as object }
          : {}),
      },
    });

    return NextResponse.json({ ok: true, threadId: thread.id });
  } catch (err) {
    console.error("[POST /api/webhooks/postmark/inbound]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
