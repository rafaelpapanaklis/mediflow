// Piezas COMPARTIDAS del registro de WhatsApp en el Inbox.
//
// Antes vivían duplicadas dentro de src/app/api/whatsapp/webhook/route.ts (una
// copia para los mensajes entrantes y otra para los echoes de coexistence).
// Ahora las consumen ese webhook y el helper de envíos automáticos
// (src/lib/whatsapp/send-and-log.ts), para que TODOS los mensajes de un mismo
// contacto caigan en el MISMO hilo con el mismo criterio.
//
// Multi-tenant: el clinicId siempre lo pasa el caller desde su contexto de
// servidor (sesión, cron o phone_number_id resuelto); nunca sale de un body.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeLast10 } from "@/lib/whatsapp/bot/booking-parse";

/**
 * Empareja al paciente por teléfono comparando los últimos 10 dígitos
 * NORMALIZADOS en ambos lados (no `contains` crudo, que da falsos positivos
 * cuando esos 10 dígitos aparecen como substring de otro número). El `contains`
 * solo pre-filtra en la BD; el match real lo hace normalizeLast10.
 */
export async function findPatientByWhatsAppPhone(
  clinicId: string,
  phone: string,
): Promise<{ id: string; phone: string | null } | null> {
  const matches = await findPatientsByWhatsAppPhone(clinicId, phone);
  return matches[0] ?? null;
}

/**
 * TODOS los pacientes de la clínica con ese teléfono, no solo el primero.
 *
 * Existe para poder distinguir "un único paciente con ese número" de "dos
 * hermanos que comparten el celular de la mamá": enlazar un hilo a ciegas en el
 * segundo caso le enseñaría la conversación de uno en la ficha del otro. Quien
 * escribe el enlace (`linkOrphanThreadsToPatient`) exige que haya UNO solo;
 * `findPatientByWhatsAppPhone` conserva su semántica de siempre —el primero—
 * porque sus callers (webhook, envíos) solo necesitan a quién atribuir el
 * mensaje y ahí quedarse sin atribuir es peor que atribuir a uno de los dos.
 */
export async function findPatientsByWhatsAppPhone(
  clinicId: string,
  phone: string,
): Promise<Array<{ id: string; phone: string | null }>> {
  const last10 = normalizeLast10(phone);
  if (last10.length !== 10) return [];

  // La normalización va DENTRO de la consulta, no en un `contains` sobre el
  // teléfono crudo.
  //
  // POR QUÉ: los teléfonos se guardan tal como los teclea la recepción
  // ("55 1234 5678", "(999) 260-2093", "999-260-2093"), y un
  // `phone: { contains: "5512345678" }` NO casa con ninguno de esos —el LIKE es
  // literal, los espacios y guiones están en medio—. Con el pre-filtro crudo,
  // el paciente por el que se está preguntando salía como "no existe":
  //   · la auto-reparación no escribía nunca el enlace (creía que nadie tenía
  //     ese número) y encima registraba "0 pacientes lo tienen registrado";
  //   · peor, la GUARDA DE AMBIGÜEDAD se invertía: de dos hermanos con el mismo
  //     celular, si uno lo tiene guardado con espacios y el otro sin ellos, el
  //     LIKE solo veía a uno → "match inequívoco" → enlace escrito al que no
  //     tocaba, y ya irreversible (el hilo deja de estar huérfano).
  // Es además EL MISMO criterio que sql/inbox-link-orphan-threads.sql, para que
  // el script y el código no puedan discrepar.
  //
  // Rendimiento: el `clinicId = $1` va primero y hay índices que arrancan por
  // esa columna, así que la expresión solo se evalúa sobre los pacientes de la
  // clínica, no sobre la tabla entera.
  try {
    return await prisma.$queryRaw<Array<{ id: string; phone: string | null }>>`
      SELECT "id", "phone"
        FROM "patients"
       WHERE "clinicId" = ${clinicId}
         AND "phone" IS NOT NULL
         AND right(regexp_replace("phone", '[^0-9]', '', 'g'), 10) = ${last10}
       LIMIT 25
    `;
  } catch (err) {
    // Red de seguridad: este helper lo usa el webhook, y quedarse sin emparejar
    // pacientes es peor que emparejar solo los teléfonos bien formateados. Si el
    // raw falla (motor distinto, permisos), se vuelve al criterio de siempre.
    console.error("[whatsapp/inbox-log] el emparejamiento normalizado falló, uso el contains:", err);
    const candidates = await prisma.patient.findMany({
      where: { clinicId, phone: { contains: last10 } },
      select: { id: true, phone: true },
      take: 25,
    });
    return candidates.filter((p) => normalizeLast10(p.phone ?? "") === last10);
  }
}

/** Hilo de WhatsApp que corresponde a un teléfono, con su paciente actual. */
export interface WhatsAppThreadForPhone {
  id: string;
  patientId: string | null;
}

/**
 * Todos los hilos de WhatsApp de la clínica que corresponden a un teléfono, por
 * los últimos 10 dígitos normalizados (mismo criterio que el resto del módulo).
 *
 * POR QUÉ HACE FALTA: el enlace hilo↔paciente solo se intentaba al CREAR el
 * hilo. Si el paciente se dio de alta después de que empezara la conversación,
 * o si su teléfono se corrigió más tarde, el hilo se quedaba con `patientId`
 * nulo para siempre — y el Inbox filtrado por paciente salía vacío aunque la
 * conversación estuviera ahí. Buscar por teléfono no depende de ese enlace.
 */
export async function findWhatsAppThreadsForPhone(
  clinicId: string,
  phone: string,
  opts?: { limit?: number },
): Promise<WhatsAppThreadForPhone[]> {
  const last10 = normalizeLast10(phone);
  if (last10.length !== 10) return [];
  const candidates = await prisma.inboxThread.findMany({
    where: { clinicId, channel: "WHATSAPP", externalId: { contains: last10 } },
    orderBy: { lastMessageAt: "desc" },
    take: opts?.limit ?? 50,
    select: { id: true, externalId: true, patientId: true },
  });
  return candidates
    .filter((t) => normalizeLast10(t.externalId ?? "") === last10)
    .map((t) => ({ id: t.id, patientId: t.patientId }));
}

/** Qué hizo (o por qué no hizo nada) `linkOrphanThreadsToPatient`. */
export interface LinkOrphanThreadsResult {
  /** Cuántos hilos huérfanos quedaron enlazados a este paciente. */
  linked: number;
  /** Ids de TODOS los hilos de ese teléfono (enlazados o ya ligados a él). */
  threadIds: string[];
  /**
   * Había hilos huérfanos pero el número lo comparten varios pacientes de la
   * clínica: no se enlaza nada. El caller lo registra; la interfaz sigue
   * ENCONTRANDO los hilos por teléfono, solo que sin escribir el enlace.
   */
  ambiguous: boolean;
}

/**
 * Auto-reparación: escribe el enlace que faltaba entre un paciente y sus hilos
 * de WhatsApp huérfanos. Así el sistema se cura solo con el uso, sin depender
 * de que alguien corra el script de `sql/`.
 *
 * SOLO enlaza cuando el match es INEQUÍVOCO — un único paciente de la clínica
 * con ese número. Con dos o más no toca nada: un enlace equivocado mete la
 * conversación de un paciente en la ficha de otro, y eso es peor que dejarlo
 * huérfano (lo huérfano se ve igual, porque la búsqueda va por teléfono).
 *
 * Idempotente: el `updateMany` filtra por `patientId: null`, así que dos
 * peticiones simultáneas no se pisan y la segunda simplemente no escribe nada.
 */
export async function linkOrphanThreadsToPatient(args: {
  clinicId: string;
  patientId: string;
  phone: string | null | undefined;
}): Promise<LinkOrphanThreadsResult> {
  const empty: LinkOrphanThreadsResult = { linked: 0, threadIds: [], ambiguous: false };
  const phone = (args.phone ?? "").trim();
  if (!phone) return empty;
  const last10 = normalizeLast10(phone);
  if (last10.length !== 10) return empty;

  // El número de la PROPIA clínica queda fuera, entero.
  //
  // POR QUÉ: los avisos internos de la plataforma (solicitud de cita nueva,
  // saldo de IA, cobros) salen por WhatsApp al teléfono de la clínica con
  // kind "system" y `linkPatient: false` — send-and-log evita atribuirlos a
  // nadie a propósito. Ese hilo queda huérfano por diseño y su conversación
  // habla de OTROS pacientes ("Nueva solicitud de cita · <nombre> · <teléfono>").
  // Si alguien registró el número de la clínica en la ficha de un paciente
  // (pasa: el propio doctor dado de alta como paciente, o ese número usado de
  // relleno cuando el paciente no da el suyo), el match sería "inequívoco" y
  // acabaríamos metiendo los avisos internos —con datos de terceros— dentro de
  // su expediente. Aquí no hay forma de distinguir, así que no se toca.
  const clinic = await prisma.clinic.findUnique({
    where: { id: args.clinicId },
    select: { phone: true },
  });
  if (clinic?.phone && normalizeLast10(clinic.phone) === last10) {
    console.warn(
      `[whatsapp/inbox-log] el número …${last10} es el de la propia clínica ` +
        `${args.clinicId}: no se enlaza ningún hilo (los avisos internos hablan de otros pacientes).`,
    );
    return empty;
  }

  const threads = await findWhatsAppThreadsForPhone(args.clinicId, phone);
  if (threads.length === 0) return empty;

  // Hilos de ESTE paciente (ya ligados) + los huérfanos que le corresponden.
  // Los ligados a OTRO paciente se quedan fuera a propósito: devolverlos sería
  // enseñar la conversación de un tercero en la ficha de este.
  const mine = threads.filter((t) => t.patientId === args.patientId).map((t) => t.id);
  const orphans = threads.filter((t) => t.patientId === null).map((t) => t.id);
  if (orphans.length === 0) {
    return { linked: 0, threadIds: mine, ambiguous: false };
  }

  const owners = await findPatientsByWhatsAppPhone(args.clinicId, phone);
  const unambiguous = owners.length === 1 && owners[0].id === args.patientId;
  if (!unambiguous) {
    console.warn(
      `[whatsapp/inbox-log] ${orphans.length} hilo(s) sin paciente con el número ` +
        `…${last10} en la clínica ${args.clinicId}: ${owners.length} paciente(s) lo tienen ` +
        `registrado, así que NO se enlaza (haría falta desambiguar a mano).`,
    );
    // Sin enlazar, pero SÍ visibles: la búsqueda por teléfono no depende del
    // enlace, y dejar la conversación escondida sería el fallo original.
    return { linked: 0, threadIds: [...mine, ...orphans], ambiguous: true };
  }

  const res = await prisma.inboxThread.updateMany({
    // `patientId: null` en el where, no solo en la lectura: entre el findMany y
    // este update otra petición pudo haber enlazado el hilo.
    where: { id: { in: orphans }, clinicId: args.clinicId, patientId: null },
    data: { patientId: args.patientId },
  });
  return { linked: res.count, threadIds: [...mine, ...orphans], ambiguous: false };
}

export interface WhatsAppThreadRef {
  id: string;
  botActive: boolean;
  botState: Prisma.JsonValue | null;
  patientId: string | null;
}

/**
 * Localiza el hilo de un teléfono: primero por externalId exacto y, si no hay,
 * por los últimos 10 dígitos normalizados. Es el MISMO criterio que usa
 * `upsertWhatsAppThread` en los envíos, extraído para poder reutilizarlo.
 */
async function findThreadByPhone(
  clinicId: string,
  externalId: string,
): Promise<{ id: string } | null> {
  const exact = await prisma.inboxThread.findFirst({
    where: { clinicId, channel: "WHATSAPP", externalId },
    select: { id: true },
  });
  if (exact) return exact;

  const last10 = normalizeLast10(externalId);
  if (last10.length !== 10) return null;

  const candidates = await prisma.inboxThread.findMany({
    where: { clinicId, channel: "WHATSAPP", externalId: { contains: last10 } },
    orderBy: { lastMessageAt: "desc" },
    take: 10,
    select: { id: true, externalId: true },
  });
  // El `contains` solo pre-filtra: el match real es exacto por los 10 dígitos
  // normalizados (nunca un hilo de otro número que los contenga).
  const match = candidates.find((t) => normalizeLast10(t.externalId ?? "") === last10);
  return match ? { id: match.id } : null;
}

/**
 * Momento del último mensaje ENTRANTE de ese contacto, o null si nunca escribió.
 *
 * Es lo que decide si la ventana de servicio de 24 h de WhatsApp sigue abierta
 * y, por tanto, si un aviso automático puede salir como texto libre o necesita
 * plantilla (lib/whatsapp/send-mode.ts).
 *
 * Usa el mismo emparejamiento laxo que los envíos a propósito: con un criterio
 * más estricto un hilo que SÍ existe pasaría por inexistente, daríamos la
 * ventana por cerrada y exigiríamos plantilla donde hoy basta el texto libre.
 */
export async function lastInboundAtForPhone(
  clinicId: string,
  phone: string,
): Promise<Date | null> {
  const thread = await findThreadByPhone(clinicId, phone);
  if (!thread) return null;
  const lastIn = await prisma.inboxMessage.findFirst({
    where: { threadId: thread.id, direction: "IN" },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  return lastIn?.sentAt ?? null;
}

export interface UpsertWhatsAppThreadArgs {
  clinicId: string;
  /** externalId del hilo = teléfono del contacto (mismo criterio que el webhook). */
  externalId: string;
  now: Date;
  /** Asunto SOLO al crear; un hilo existente conserva el suyo. */
  createSubject: string;
  /** Estado SOLO al crear. */
  createStatus: "UNREAD" | "READ";
  /** Paciente ya resuelto; se vincula al crear y también si el hilo no lo tenía. */
  patientId?: string | null;
  /** true = el hilo pasa a UNREAD (llegó algo del paciente). */
  markUnread?: boolean;
  /** true = pausa el bot del hilo, al crear y al actualizar (un humano contesta). */
  pauseBot?: boolean;
  /**
   * true = si no hay match exacto de externalId, busca por los últimos 10
   * dígitos. Necesario en los ENVÍOS: el teléfono guardado del paciente casi
   * nunca viene con el mismo formato que el wa_id que manda Meta ("5512345678"
   * vs "5215512345678"), y sin esto cada aviso automático abriría un hilo nuevo.
   */
  matchByLast10?: boolean;
}

/**
 * Busca (o crea) el hilo de WhatsApp de un contacto y le actualiza
 * lastMessageAt. Reproduce el patrón del webhook tal cual: create con captura
 * de P2002 (carrera entre reintentos de Meta, @@unique [clinicId, channel,
 * externalId]) → re-findFirst, y vinculación perezosa del paciente.
 *
 * Devuelve el hilo TAL COMO ESTABA antes del update (igual que el webhook, que
 * lee botActive/botState del findFirst previo).
 */
export async function upsertWhatsAppThread(
  args: UpsertWhatsAppThreadArgs,
): Promise<WhatsAppThreadRef> {
  const { clinicId, externalId, now, patientId = null } = args;
  const select = { id: true, botActive: true, botState: true, patientId: true } as const;

  let thread = await prisma.inboxThread.findFirst({
    where: { clinicId, channel: "WHATSAPP", externalId },
    select,
  });

  // Fallback por últimos 10 dígitos (solo envíos): el hilo puede existir con el
  // wa_id de Meta, que no coincide carácter a carácter con el teléfono guardado.
  if (!thread && args.matchByLast10) {
    const last10 = normalizeLast10(externalId);
    if (last10.length === 10) {
      const candidates = await prisma.inboxThread.findMany({
        where: {
          clinicId,
          channel: "WHATSAPP",
          externalId: { contains: last10 },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 10,
        select: { ...select, externalId: true },
      });
      // El `contains` solo pre-filtra: el match real es exacto por los 10
      // dígitos normalizados (nunca un hilo de otro número que los contenga).
      const match = candidates.find((t) => normalizeLast10(t.externalId ?? "") === last10);
      if (match) {
        thread = {
          id: match.id,
          botActive: match.botActive,
          botState: match.botState,
          patientId: match.patientId,
        };
      }
    }
  }

  if (!thread) {
    try {
      return await prisma.inboxThread.create({
        data: {
          clinicId,
          channel: "WHATSAPP",
          externalId,
          patientId,
          subject: args.createSubject,
          status: args.createStatus,
          lastMessageAt: now,
          ...(args.pauseBot ? { botActive: false } : {}),
        },
        select,
      });
    } catch (err) {
      // Carrera: otro request creó el hilo entre el findFirst y el create.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        thread = await prisma.inboxThread.findFirst({
          where: { clinicId, channel: "WHATSAPP", externalId },
          select,
        });
      }
      if (!thread) throw err;
      return thread;
    }
  }

  await prisma.inboxThread.update({
    where: { id: thread.id },
    data: {
      lastMessageAt: now,
      ...(args.markUnread ? { status: "UNREAD" as const } : {}),
      ...(args.pauseBot ? { botActive: false } : {}),
      // si identificamos al paciente y el hilo no lo tenía, lo vinculamos.
      ...(patientId && !thread.patientId ? { patientId } : {}),
    },
  });
  return thread;
}
