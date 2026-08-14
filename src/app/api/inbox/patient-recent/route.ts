import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { resolvePatientThreadScope, patientThreadWhere } from "@/lib/inbox/patient-threads";
import { parseSystemKind } from "@/lib/whatsapp/system-message";

export const dynamic = "force-dynamic";

/**
 * GET /api/inbox/patient-recent?patientId=&limit=
 *
 * Los últimos mensajes de WhatsApp del paciente para la tarjeta "WhatsApp
 * recientes" de la ficha. Esa tarjeta era ESTÁTICA: pintaba siempre "Sin
 * mensajes recientes" aunque la conversación existiera, porque nunca pedía
 * nada. Este endpoint es su única fuente de datos.
 *
 * No filtra por `patientId` a secas: usa `resolvePatientThreadScope`, que
 * además encuentra (y repara) los hilos huérfanos que le corresponden al
 * paciente POR TELÉFONO — el caso normal cuando el paciente se dio de alta
 * después de que empezara la conversación.
 */

/** Recorte del cuerpo: la tarjeta es estrecha y solo pinta una línea. */
const BODY_MAX_CHARS = 160;
const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 10;

// Contexto vía el helper CENTRAL (getAuthContext): resolución cookie→clínica
// con el gate de plan vencido. ctx.user es la fila User con permissionsOverride
// normalizado. clinicId SIEMPRE de aquí, jamás del query string.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const denied = denyIfMissingPermission(dbUser, "inbox.view");
    if (denied) return denied;

    const sp = req.nextUrl.searchParams;
    const patientId = sp.get("patientId");
    if (!patientId) {
      return NextResponse.json({ error: "missing_patient_id" }, { status: 400 });
    }

    // Visibilidad por paciente: la conversación es dato clínico del paciente.
    // Se responde 403 "forbidden" (y no el 404 que devuelve el helper) porque
    // el consumidor es una tarjeta de la ficha: necesita distinguir "no puedo
    // verlo" —para pintar el aviso y esconder el enlace al Inbox— de "no hay
    // mensajes".
    const visDenied = await assertPatientVisible(patientId, {
      userId: dbUser.id,
      role: dbUser.role,
      clinicId: dbUser.clinicId,
    });
    if (visDenied) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const rawLimit = parseInt(sp.get("limit") ?? "", 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // `repair: false` A PROPÓSITO: este GET lo dispara la ficha al abrirse, y
    // "inbox.view" lo tiene hasta el rol de solo lectura. Un GET que escribe
    // dejaría que un READONLY cambiara de dueño un hilo sin dejar rastro.
    // Encontrar los huérfanos no necesita escribirlos; el enlace lo escribe el
    // Inbox (GET /api/inbox/threads, gateado por quien sí puede enviar) o el
    // alta/edición del paciente.
    const scope = await resolvePatientThreadScope(dbUser.clinicId, patientId, { repair: false });

    // Número compartido por varios pacientes: los hilos huérfanos NO entran.
    // Aquí cada mensaje entrante se pinta con el nombre de ESTE paciente, así
    // que meter la conversación de su hermano sería atribuirle mensajes que no
    // son suyos dentro de su expediente. En la lista del Inbox sí se ven —ahí
    // el hilo lleva su propio nombre y no se le atribuye a nadie.
    const extraThreadIds = scope.ambiguous ? [] : scope.extraThreadIds;

    const threads = await prisma.inboxThread.findMany({
      where: {
        clinicId: dbUser.clinicId,
        // La tarjeta se llama "WhatsApp recientes": los hilos del portal y los
        // de correo nacen CON patientId, así que sin este filtro un chat del
        // portal se colaba (y, al ordenar por fecha, desplazaba justo a los
        // mensajes de WhatsApp que la tarjeta viene a enseñar).
        channel: "WHATSAPP",
        // En el AND, nunca en el OR del where: el helper YA devuelve un OR
        // propio y anidarlo mal volvería el filtro permisivo.
        AND: [patientThreadWhere(patientId, extraThreadIds)],
      },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    if (threads.length === 0) {
      return NextResponse.json({ threadId: null, messages: [], total: 0 });
    }

    // El hilo más reciente es el que abrirá el enlace "Abrir chat".
    const threadId = threads[0].id;
    const threadIds = threads.map((t) => t.id);

    // Las notas internas del staff quedan fuera: la tarjeta muestra la
    // conversación con el paciente, no el trabajo interno del equipo.
    const messageWhere = { threadId: { in: threadIds }, isInternal: false };
    const [rows, total] = await Promise.all([
      prisma.inboxMessage.findMany({
        where: messageWhere,
        orderBy: { sentAt: "desc" },
        take: limit,
        select: { id: true, direction: true, body: true, sentAt: true, externalId: true },
      }),
      prisma.inboxMessage.count({ where: messageWhere }),
    ]);

    // Se piden los N ÚLTIMOS (desc) pero se devuelven en orden cronológico:
    // la tarjeta los pinta como conversación, el más viejo arriba.
    const messages = rows
      .slice()
      .reverse()
      .map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body.length > BODY_MAX_CHARS ? m.body.slice(0, BODY_MAX_CHARS) : m.body,
        sentAt: m.sentAt.toISOString(),
        // Envío automático de la plataforma (recordatorio, reseña, aviso…):
        // viaja marcado en el externalId como `sys:<kind>:<wamid>`.
        isSystem: parseSystemKind(m.externalId) !== null,
      }));

    return NextResponse.json({ threadId, messages, total });
  } catch (err) {
    console.error("[GET /api/inbox/patient-recent]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
