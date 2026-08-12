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
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp";
import {
  findPatientByWhatsAppPhone,
  lastInboundAtForPhone,
  upsertWhatsAppThread,
} from "@/lib/whatsapp/inbox-log";
import { buildSystemExternalId, type WhatsAppSendKind } from "@/lib/whatsapp/system-message";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { decideSendMode } from "@/lib/whatsapp/send-mode";
import {
  parseWaTemplates,
  renderTemplateBody,
  specForKind,
} from "@/lib/whatsapp/template-config";
import { WhatsAppBlockedError, isBillingError } from "@/lib/whatsapp/errors";

export type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

/** Carga mínima de la clínica que necesita el helper (la mayoría de callers ya la tiene). */
export interface WhatsAppLogClinic {
  id: string;
  waPhoneNumberId?: string | null;
  waAccessToken?: string | null;
  waConnected?: boolean | null;
  /** Plantillas aprobadas de ESTA clínica (Json de Clinic.waTemplates). */
  waTemplates?: unknown;
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
  /**
   * Valores de {{1}}…{{n}} de la plantilla de ese tipo, EN ORDEN (ver
   * WA_TEMPLATE_SPECS). Solo se usan si la ventana de 24 h está cerrada; dentro
   * de ventana sale `body` como texto libre y esto se ignora.
   *
   * Sin ellos, un envío fuera de ventana NO sale: se bloquea con un motivo
   * legible en vez de mandar texto libre que Meta tira a la basura.
   */
  templateParams?: string[] | null;
}

/**
 * Envía por WhatsApp y registra el mensaje como OUT en el Inbox.
 *
 * Devuelve la respuesta cruda de Meta (igual que `sendWhatsAppMessage`), por si
 * el caller necesita el wamid.
 */
export async function sendWhatsAppLogged(args: SendWhatsAppLoggedArgs): Promise<any> {
  const clinic = await resolveClinic(args);

  // 1) ¿Texto libre o plantilla? (M-09, el P0.)
  //    WhatsApp solo acepta texto libre dentro de las 24 h siguientes al último
  //    mensaje DEL PACIENTE. Fuera de esa ventana exige plantilla aprobada, y
  //    hasta ahora aquí salía SIEMPRE texto libre: al paciente que nunca había
  //    escrito no le llegaba nada y el panel lo daba por enviado.
  //
  //    La ventana se mide contra el Inbox (mismo criterio que la respuesta
  //    manual del staff). Sin clínica resuelta no hay hilo que mirar: se trata
  //    como cerrada, que es el lado seguro.
  const lastInbound = clinic?.id ? await lastInboundAtForPhone(clinic.id, args.to) : null;
  const windowOpen = isWithin24hWindow(lastInbound, new Date());

  const decision = decideSendMode({
    kind: args.kind,
    windowOpen,
    templates: parseWaTemplates(clinic?.waTemplates ?? null),
    params: args.templateParams,
  });

  if (decision.mode === "blocked") {
    // No se llama a Meta: el mensaje no llegaría y encima parecería enviado.
    // El motivo va en el `message` y de ahí a WhatsAppReminder.errorMsg.
    throw new WhatsAppBlockedError(decision.reason);
  }

  // 2) El envío manda: mismas credenciales y MISMA semántica de fallo que antes
  //    de esta capa (lanza y el caller decide). A propósito NO se filtra por
  //    waConnected aquí: los callers ya lo hacen y añadir el gate cambiaría su
  //    comportamiento de error.
  let meta: any;
  try {
    meta =
      decision.mode === "template"
        ? await sendWhatsAppTemplate(
            clinic?.waPhoneNumberId ?? "",
            clinic?.waAccessToken ?? "",
            args.to,
            decision.template,
            decision.params,
          )
        : await sendWhatsAppMessage(
            clinic?.waPhoneNumberId ?? "",
            clinic?.waAccessToken ?? "",
            args.to,
            args.body,
          );
  } catch (e) {
    // 131042: la WABA de la clínica se quedó sin método de pago. Se anota para
    // que la pantalla de Plantillas lo diga en vez de repetir el mismo fallo.
    if (isBillingError(e) && clinic?.id) {
      await setBillingOk(clinic.id, false);
    }
    throw e;
  }

  if (decision.mode === "template" && clinic?.id) {
    // Una plantilla aceptada demuestra que la cuenta puede pagarlas.
    await setBillingOk(clinic.id, true);
  }

  // 3) Registro best-effort. NUNCA debe tumbar el envío ya realizado.
  if (clinic?.id) {
    try {
      await logOutboundToInbox({
        clinicId: clinic.id,
        to: args.to,
        // Con plantilla, en el Inbox se guarda lo que REALMENTE recibió el
        // paciente (el texto de la plantilla con sus datos), no el texto libre
        // que se habría mandado dentro de ventana: son distintos y el equipo
        // necesita ver la conversación de verdad.
        body:
          decision.mode === "template"
            ? renderTemplateBody(specForKind(args.kind), decision.params, args.body)
            : args.body,
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

/** Marca si la cuenta de WhatsApp de la clínica puede pagar plantillas. Best-effort. */
async function setBillingOk(clinicId: string, ok: boolean): Promise<void> {
  try {
    // updateMany con el valor contrario: no escribe si ya estaba así.
    await prisma.clinic.updateMany({
      where: { id: clinicId, waBillingOk: !ok },
      data: { waBillingOk: ok },
    });
  } catch (e) {
    console.error("[whatsapp/send-and-log] no se pudo actualizar waBillingOk:", e);
  }
}

async function resolveClinic(args: SendWhatsAppLoggedArgs): Promise<WhatsAppLogClinic | null> {
  if (args.clinic) return args.clinic;
  if (!args.clinicId) {
    throw new Error("sendWhatsAppLogged: falta `clinic` o `clinicId`");
  }
  return prisma.clinic.findUnique({
    where: { id: args.clinicId },
    select: {
      id: true,
      waPhoneNumberId: true,
      waAccessToken: true,
      waConnected: true,
      waTemplates: true,
    },
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
