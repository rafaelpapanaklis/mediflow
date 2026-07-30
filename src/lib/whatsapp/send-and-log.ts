// Envío de WhatsApp que ADEMÁS deja rastro en el Inbox.
//
// PROBLEMA QUE RESUELVE: Meta no emite echo de lo enviado por la Graph API
// (`smb_message_echoes` solo refleja lo escrito desde la app del celular), así
// que todo lo que DaleControl mandaba solo —recordatorios, invitaciones a
// reseña, recetas, confirmaciones de cita, avisos de sistema— desaparecía: la
// clínica no podía ver "recordatorio enviado ayer 6pm" en ninguna parte.
//
// CONTRATO: mismo fallo que hoy. Si el envío a Meta falla, `sendWhatsAppLogged`
// LANZA igual que `sendWhatsAppMessage` (los callers ya lo manejan). El
// registro en el Inbox es best-effort en su propio try/catch: si falla, el
// mensaje YA salió y ni el request ni la corrida del cron se rompen.

import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { findPatientByWhatsAppPhone, upsertWhatsAppThread } from "@/lib/whatsapp/inbox-log";
import { buildSystemExternalId, type WhatsAppSendKind } from "@/lib/whatsapp/system-message";

export type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

/** Carga mínima de la clínica que necesita el helper (la mayoría de callers ya la tiene). */
export interface WhatsAppLogClinic {
  id: string;
  waPhoneNumberId?: string | null;
  waAccessToken?: string | null;
  waConnected?: boolean | null;
}

export interface SendWhatsAppLoggedArgs {
  /** Clínica ya cargada. Si no la tienes, pasa `clinicId` y el helper la carga. */
  clinic?: WhatsAppLogClinic | null;
  clinicId?: string;
  /** Teléfono destino, en el formato que ya usan los callers (se normaliza abajo). */
  to: string;
  body: string;
  kind: WhatsAppSendKind;
  /**
   * Vincular el hilo al paciente cuyo teléfono coincida. Por defecto sí, EXCEPTO
   * en kind "system": esos avisos van a la propia clínica (clinic.phone) o a un
   * doctor, y si ese número coincidiera con el de un paciente lo enlazaríamos
   * mal. Los callers de "system" que sí escriben a un paciente lo activan a mano.
   */
  linkPatient?: boolean;
}

/**
 * Envía por WhatsApp y registra el mensaje como OUT en el Inbox.
 *
 * Devuelve la respuesta cruda de Meta (igual que `sendWhatsAppMessage`), por si
 * el caller necesita el wamid.
 */
export async function sendWhatsAppLogged(args: SendWhatsAppLoggedArgs): Promise<any> {
  const clinic = await resolveClinic(args);

  // 1) El envío manda: mismas credenciales, mismo helper y MISMA semántica de
  //    fallo que antes de esta capa (lanza y el caller decide). A propósito NO
  //    se filtra por waConnected aquí: los callers ya lo hacen y añadir el gate
  //    cambiaría su comportamiento de error.
  const meta = await sendWhatsAppMessage(
    clinic?.waPhoneNumberId ?? "",
    clinic?.waAccessToken ?? "",
    args.to,
    args.body,
  );

  // 2) Registro best-effort. NUNCA debe tumbar el envío ya realizado.
  if (clinic?.id) {
    try {
      await logOutboundToInbox({
        clinicId: clinic.id,
        to: args.to,
        body: args.body,
        kind: args.kind,
        linkPatient: args.linkPatient ?? args.kind !== "system",
        wamid: meta?.messages?.[0]?.id ?? null,
      });
    } catch (e) {
      console.error(`[whatsapp/send-and-log] no se pudo registrar el envío (${args.kind}):`, e);
    }
  }

  return meta;
}

async function resolveClinic(args: SendWhatsAppLoggedArgs): Promise<WhatsAppLogClinic | null> {
  if (args.clinic) return args.clinic;
  if (!args.clinicId) {
    throw new Error("sendWhatsAppLogged: falta `clinic` o `clinicId`");
  }
  return prisma.clinic.findUnique({
    where: { id: args.clinicId },
    select: { id: true, waPhoneNumberId: true, waAccessToken: true, waConnected: true },
  });
}

interface LogArgs {
  clinicId: string;
  to: string;
  body: string;
  kind: WhatsAppSendKind;
  linkPatient: boolean;
  wamid: string | null;
}

async function logOutboundToInbox(args: LogArgs): Promise<void> {
  const now = new Date();
  const patient = args.linkPatient
    ? await findPatientByWhatsAppPhone(args.clinicId, args.to)
    : null;

  const thread = await upsertWhatsAppThread({
    clinicId: args.clinicId,
    externalId: whatsappThreadKey(args.to),
    now,
    createSubject: `WhatsApp · ${args.to}`,
    // Un mensaje que enviamos NOSOTROS no es algo "sin leer" (inflaría el
    // contador de no-leídos del Inbox). Y en un hilo que YA existe no se toca
    // el status: si el paciente había escrito y el hilo está UNREAD, un
    // recordatorio automático no puede darlo por leído a nombre del equipo.
    createStatus: "READ",
    patientId: patient?.id ?? null,
    matchByLast10: true,
    // Sin pauseBot: estos avisos NO son un humano tomando la conversación; el
    // bot debe seguir contestando (p.ej. el "CONFIRMAR" a un recordatorio).
  });

  await prisma.inboxMessage.create({
    data: {
      threadId: thread.id,
      direction: "OUT",
      body: args.body,
      sentById: null,          // automático: no lo escribió una persona
      sentAt: now,
      isInternal: false,       // es parte de la conversación, no una nota
      // `sys:<kind>:<wamid>` — marca el origen SIN columna nueva y permite
      // excluir estos envíos del tope diario del bot (ver webhook).
      externalId: buildSystemExternalId(args.kind, args.wamid),
    },
  });
}

/**
 * Clave del hilo (externalId) para un teléfono destino. Meta entrega los wa_id
 * mexicanos como 521 + 10 dígitos (ver fixtures del bot), así que un hilo nuevo
 * se crea con ese formato para que la respuesta del paciente caiga en el MISMO
 * hilo. Números no mexicanos se guardan tal cual (solo dígitos).
 */
export function whatsappThreadKey(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length < 10) return digits;
  if (digits.length <= 10 || digits.startsWith("52")) return `521${last10}`;
  return digits;
}
