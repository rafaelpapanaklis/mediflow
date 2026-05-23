export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveChatCaller,
  loadOwnedThread,
  serializeMessage,
} from "@/lib/suppliers/chat-access";
import type { SupplierChatSender } from "@prisma/client";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };
const MAX_BODY = 4000;
const FULL_LOAD_LIMIT = 100;

const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  sender: true,
  senderId: true,
  body: true,
  createdAt: true,
} as const;

/**
 * Resuelve el cursor `?after=` a un Date para filtrar `createdAt > after`.
 * Acepta epoch ms, ISO string o el id de un mensaje del hilo. Devuelve null
 * si no hay cursor o es inválido (→ carga completa).
 */
async function resolveAfter(after: string | null, threadId: string): Promise<Date | null> {
  if (!after) return null;
  if (/^\d+$/.test(after)) {
    const d = new Date(Number(after));
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = Date.parse(after);
  if (!isNaN(parsed)) return new Date(parsed);
  // Tratar `after` como id de mensaje y usar su createdAt como cursor.
  const msg = await prisma.supplierChatMessage.findUnique({
    where: { id: after },
    select: { createdAt: true, threadId: true },
  });
  if (!msg || msg.threadId !== threadId) return null;
  return msg.createdAt;
}

/**
 * GET — mensajes del hilo. Sin `after`: últimos N en orden ascendente (carga
 * completa) y marca el hilo como leído para el que llama. Con `after`: solo lo
 * nuevo (polling incremental), sin escribir.
 */
export async function GET(req: Request, { params }: { params: { threadId: string } }) {
  const caller = await resolveChatCaller();
  if (!caller) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  const thread = await loadOwnedThread(params.threadId, caller);
  if (!thread) {
    return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404, headers: NO_STORE });
  }

  const afterParam = new URL(req.url).searchParams.get("after");
  const afterDate = await resolveAfter(afterParam, thread.id);

  let rows;
  if (afterDate) {
    rows = await prisma.supplierChatMessage.findMany({
      where: { threadId: thread.id, createdAt: { gt: afterDate } },
      orderBy: { createdAt: "asc" },
      select: MESSAGE_SELECT,
    });
  } else {
    const recent = await prisma.supplierChatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "desc" },
      take: FULL_LOAD_LIMIT,
      select: MESSAGE_SELECT,
    });
    rows = recent.reverse();
  }

  // Carga completa = el que llama abrió/refrescó la conversación: marcar leído
  // SU contador. En polls incrementales (con cursor) no escribimos.
  if (!afterParam) {
    await prisma.supplierChatThread.update({
      where: { id: thread.id },
      data: caller.side === "CLINIC" ? { clinicUnread: 0 } : { supplierUnread: 0 },
    });
  }

  return NextResponse.json(rows.map(serializeMessage), { headers: NO_STORE });
}

/**
 * POST — envía un mensaje. El `sender` se deriva del rol de la sesión
 * (nunca del body). Mensaje + actualización del hilo (lastMessageAt y
 * contador de no-leídos del receptor) en una sola transacción.
 */
export async function POST(req: Request, { params }: { params: { threadId: string } }) {
  const caller = await resolveChatCaller();
  if (!caller) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  const thread = await loadOwnedThread(params.threadId, caller);
  if (!thread) {
    return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404, headers: NO_STORE });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400, headers: NO_STORE });
  }
  const text = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "El mensaje no puede estar vacío." }, { status: 400, headers: NO_STORE });
  }
  if (text.length > MAX_BODY) {
    return NextResponse.json(
      { error: `El mensaje no puede exceder ${MAX_BODY} caracteres.` },
      { status: 400, headers: NO_STORE }
    );
  }

  const sender: SupplierChatSender = caller.side === "CLINIC" ? "CLINIC" : "SUPPLIER";

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.supplierChatMessage.create({
      data: { threadId: thread.id, sender, senderId: caller.senderId, body: text },
      select: MESSAGE_SELECT,
    });
    await tx.supplierChatThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt: created.createdAt,
        ...(sender === "CLINIC"
          ? { supplierUnread: { increment: 1 }, clinicUnread: 0 }
          : { clinicUnread: { increment: 1 }, supplierUnread: 0 }),
      },
    });
    return created;
  });

  return NextResponse.json(serializeMessage(message), { status: 201, headers: NO_STORE });
}
