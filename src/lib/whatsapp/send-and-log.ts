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
import {
  sendWhatsAppDocument,
  sendWhatsAppInteractive,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  uploadWhatsAppMedia,
} from "@/lib/whatsapp";
import {
  PLANTILLA_RECORDATORIO_CON_BOTONES,
  construirInteractivo,
  lineaDeOpciones,
  payloadsDeBotonesDePlantilla,
  plantillaTieneBotones,
  type MensajeInteractivo,
} from "@/lib/whatsapp/interactivo";
import {
  findPatientByWhatsAppPhone,
  lastInboundAtForPhone,
  upsertWhatsAppThread,
} from "@/lib/whatsapp/inbox-log";
import { buildSystemExternalId, type WhatsAppSendKind } from "@/lib/whatsapp/system-message";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
// Namespace a propósito: las pruebas que sustituyen inbox-log con unos pocos
// exports no tienen `findPatientsByWhatsAppPhone`, y un import con nombre
// rompería su carga; así solo falla (y se atrapa) cuando de verdad se usa.
import * as inboxLog from "@/lib/whatsapp/inbox-log";
import { conEtiquetaDePaciente, debeEtiquetarPaciente } from "@/lib/whatsapp/atribucion-paciente";
import { decideSendMode, kindDePlantilla } from "@/lib/whatsapp/send-mode";
import {
  parseWaTemplates,
  renderTemplateBody,
  specForKind,
} from "@/lib/whatsapp/template-config";
import { WhatsAppApiError, WhatsAppBlockedError, isBillingError, isTokenRevoked } from "@/lib/whatsapp/errors";
import { PacienteNoContactarError } from "@/lib/patients/paciente-de-prueba";
import { motivoParaNoContactar } from "@/lib/patients/paciente-de-prueba-db";

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

/** Documento (PDF) que acompaña a un envío. Solo sale con la ventana abierta. */
export interface WhatsAppOutboundAttachment {
  buffer: Buffer;
  filename: string;
  /** Texto que WhatsApp muestra bajo el documento. */
  caption?: string;
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
   * Paciente YA identificado por el caller. Cuando viene, GANA sobre la búsqueda
   * por teléfono: es el caso de "iniciar conversación desde la ficha", donde una
   * persona eligió a ESTE paciente y el hilo debe nacer ligado a él.
   *
   * Importa además porque el emparejamiento por teléfono devuelve "el primero"
   * cuando dos pacientes comparten número (dos hermanos con el celular de la
   * mamá): a ciegas podría ligar el hilo al hermano equivocado. Con el id
   * explícito no hay nada que adivinar.
   *
   * Solo se USA si `linkPatient` no está en false.
   */
  patientId?: string | null;
  /**
   * Quién pulsó el botón. Null (lo normal) = envío automático de la plataforma,
   * y el Inbox lo pinta con la etiqueta del bot. Con id, el mensaje aparece en
   * la conversación atribuido a esa persona, igual que una respuesta escrita a
   * mano: una plantilla que manda alguien del equipo no es un automatismo, y
   * enseñarla como tal esconde quién habló con el paciente.
   */
  sentById?: string | null;
  /**
   * Valores de {{1}}…{{n}} de la plantilla de ese tipo, EN ORDEN (ver
   * WA_TEMPLATE_SPECS). Solo se usan si la ventana de 24 h está cerrada; dentro
   * de ventana sale `body` como texto libre y esto se ignora.
   *
   * Sin ellos, un envío fuera de ventana NO sale: se bloquea con un motivo
   * legible en vez de mandar texto libre que Meta tira a la basura.
   */
  templateParams?: string[] | null;
  /**
   * ws1-t4 (8c) — con la ventana cerrada, la plantilla a usar EN VEZ de la de `kind` si la
   * clínica ya la tiene aprobada y pide los mismos datos (aviso de saldo: «pago por
   * realizar» / «saldo vencido»). Si no, la de `kind`, como siempre. El envío se registra
   * con `kind` igualmente (Inbox, tope de avisos de cobro).
   */
  plantillaPreferida?: WhatsAppSendKind | null;
  /**
   * ws1-t3 — botones o lista que acompañan a `body` DENTRO de la ventana de
   * 24 h (fuera de ella sale la plantilla, que lleva los suyos si los tiene).
   * Si Meta rechaza el interactivo (o no cabe en sus límites), sale `body` como
   * texto libre: el paciente siempre puede contestar escribiendo.
   */
  interactivo?: MensajeInteractivo | null;
  /**
   * Adjunto que se manda DESPUÉS del texto, como segundo mensaje del hilo.
   * Solo aplica con la ventana de 24 h abierta (modo texto): las plantillas de
   * DaleControl son de solo texto y Meta no permite colgarles un documento, así
   * que en modo plantilla el adjunto se IGNORA sin error (limitación de Meta,
   * documentada en el caller).
   */
  attachment?: WhatsAppOutboundAttachment | null;
}

/**
 * Envía por WhatsApp y registra el mensaje como OUT en el Inbox.
 *
 * Devuelve la respuesta cruda de Meta (igual que `sendWhatsAppMessage`), por si
 * el caller necesita el wamid.
 */
export async function sendWhatsAppLogged(args: SendWhatsAppLoggedArgs): Promise<any> {
  const clinic = await resolveClinic(args);

  // 0) ws1-t11 (11d) — «Paciente de prueba / no contactar». ESTE es el freno de
  //    todo WhatsApp a pacientes: cola (recordatorios, recall, cumpleaños,
  //    seguimientos, cobranza), reseñas, avisos de cita, anticipos y cada botón
  //    «enviar por WhatsApp» del panel pasan por aquí. Los avisos de "system" a
  //    la clínica o a un doctor no se frenan (su número puede ser el mismo que
  //    el del paciente de prueba que dio de alta). Se lanza ANTES de llamar a
  //    Meta y antes de tocar el Inbox: no sale nada y no se registra como enviado.
  if ((args.linkPatient ?? args.kind !== "system") && clinic?.id) {
    const motivo = await motivoParaNoContactar({
      clinicId: clinic.id,
      patientId: args.patientId ?? null,
      telefono: args.to,
    });
    if (motivo) throw new PacienteNoContactarError();
  }

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

  const plantillas = parseWaTemplates(clinic?.waTemplates ?? null);
  const kindPlantilla = windowOpen ? args.kind : kindDePlantilla(args.kind, args.plantillaPreferida, plantillas);
  const decision = decideSendMode({
    kind: kindPlantilla,
    windowOpen,
    templates: plantillas,
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
  // ws1-t3 — lo que de verdad llevó el mensaje de botones (null = sin botones).
  let opcionesEnviadas: string | null = null;
  try {
    if (decision.mode === "template") {
      meta = await sendWhatsAppTemplate(
        clinic?.waPhoneNumberId ?? "",
        clinic?.waAccessToken ?? "",
        args.to,
        decision.template,
        decision.params,
        payloadsDeBotonesDePlantilla(decision.template.name, args.interactivo),
      );
      // La plantilla con botones (la propuesta para recordatorios) los lleva
      // fijos; la bandeja los enseña igual que los de un interactivo.
      if (plantillaTieneBotones(decision.template.name)) {
        opcionesEnviadas = lineaDeOpciones({
          tipo: "botones",
          botones: PLANTILLA_RECORDATORIO_CON_BOTONES.botones.map((b) => ({ id: b.payload, titulo: b.texto })),
        });
      }
    } else {
      const interactive = args.interactivo ? construirInteractivo(args.body, args.interactivo) : null;
      if (interactive) {
        try {
          meta = await sendWhatsAppInteractive(
            clinic?.waPhoneNumberId ?? "",
            clinic?.waAccessToken ?? "",
            args.to,
            interactive,
          );
          opcionesEnviadas = lineaDeOpciones(args.interactivo!);
        } catch (e) {
          // Solo un rechazo EXPLÍCITO de Meta (no un timeout: pudo haber
          // salido) y no por el token: ese fallaría igual en texto.
          if (!(e instanceof WhatsAppApiError) || isTokenRevoked(e)) throw e;
          console.warn(`[whatsapp/send-and-log] Meta rechazó el interactivo (${args.kind}); sale como texto:`, e.message);
          meta = null;
        }
      }
      if (!meta) {
        meta = await sendWhatsAppMessage(
          clinic?.waPhoneNumberId ?? "",
          clinic?.waAccessToken ?? "",
          args.to,
          args.body,
        );
      }
    }
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

  // 2b) Documento adjunto — solo con la ventana abierta. Best-effort DESPUÉS del
  //     texto: si el documento falla, el texto YA salió y el envío no se da por
  //     fallido (relanzar duplicaría el texto); se deja rastro en el log.
  let docMeta: any = null;
  if (decision.mode === "text" && args.attachment && clinic?.id) {
    try {
      const mediaId = await uploadWhatsAppMedia(
        clinic.waPhoneNumberId ?? "",
        clinic.waAccessToken ?? "",
        { buffer: args.attachment.buffer, filename: args.attachment.filename, mimeType: "application/pdf" },
      );
      docMeta = await sendWhatsAppDocument(clinic.waPhoneNumberId ?? "", clinic.waAccessToken ?? "", args.to, {
        mediaId,
        filename: args.attachment.filename,
        caption: args.attachment.caption,
      });
    } catch (e) {
      console.error(`[whatsapp/send-and-log] el texto salió pero el documento no (${args.kind}):`, e);
    }
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
          (decision.mode === "template"
            ? renderTemplateBody(specForKind(kindPlantilla), decision.params, args.body)
            : args.body) + (opcionesEnviadas ? `\n\n${opcionesEnviadas}` : ""),
        kind: args.kind,
        linkPatient: args.linkPatient ?? args.kind !== "system",
        patientId: args.patientId ?? null,
        sentById: args.sentById ?? null,
        wamid: meta?.messages?.[0]?.id ?? null,
      });
      if (docMeta && args.attachment) {
        await logOutboundToInbox({
          clinicId: clinic.id,
          to: args.to,
          // El Inbox no renderiza adjuntos hoy: el cuerpo dice qué archivo fue y el
          // Json `attachments` queda para cuando la UI los pinte.
          body: `[Documento] ${args.attachment.filename}`,
          kind: args.kind,
          linkPatient: args.linkPatient ?? args.kind !== "system",
          patientId: args.patientId ?? null,
          sentById: args.sentById ?? null,
          wamid: docMeta?.messages?.[0]?.id ?? null,
          attachments: [{ name: args.attachment.filename, mime: "application/pdf", size: args.attachment.buffer.length }],
        });
      }
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
  /** Paciente ya identificado por el caller; gana sobre la búsqueda por teléfono. */
  patientId?: string | null;
  /** Persona del equipo que lo mandó, o null si fue un envío automático. */
  sentById?: string | null;
  wamid: string | null;
  attachments?: Array<{ name: string; mime: string; size: number }> | null;
}

async function logOutboundToInbox(args: LogArgs): Promise<void> {
  const now = new Date();
  // El id explícito primero: si el caller ya sabe a quién le escribe, no hay
  // que adivinarlo por teléfono (ni arriesgarse a acertar el hermano que no es).
  const explicito = args.linkPatient ? args.patientId ?? null : null;
  const patientId = args.linkPatient
    ? explicito ?? (await findPatientByWhatsAppPhone(args.clinicId, args.to))?.id ?? null
    : null;

  // Teléfono compartido (11.3): solo se mira cuando el caller dijo de quién es el
  // aviso. Con dos pacientes en ese número el hilo NO se liga a ninguno (lo
  // ligaría a quien le toque primero, que es el fallo original); la
  // conversación sigue visible porque el Inbox la encuentra por teléfono.
  let duenos = 0;
  if (explicito) {
    try {
      duenos = (await inboxLog.findPatientsByWhatsAppPhone(args.clinicId, args.to)).length;
    } catch (e) {
      console.error("[whatsapp/send-and-log] no se pudo contar quién comparte el teléfono:", e);
    }
  }

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
    patientId: explicito && duenos > 1 ? null : patientId,
    matchByLast10: true,
    // Sin pauseBot: estos avisos NO son un humano tomando la conversación; el
    // bot debe seguir contestando (p.ej. el "CONFIRMAR" a un recordatorio).
  });

  let cuerpo = args.body;
  if (explicito && debeEtiquetarPaciente({
    patientId: explicito,
    hiloPatientId: thread.patientId,
    pacientesConElTelefono: duenos,
  })) {
    // Tenant: el paciente se busca por id Y clínica.
    const quien = await prisma.patient
      .findFirst({ where: { id: explicito, clinicId: args.clinicId }, select: { firstName: true, lastName: true } })
      .catch(() => null);
    if (quien) cuerpo = conEtiquetaDePaciente(args.body, `${quien.firstName ?? ""} ${quien.lastName ?? ""}`);
  }

  await prisma.inboxMessage.create({
    data: {
      threadId: thread.id,
      direction: "OUT",
      body: cuerpo,
      // null = automático (nadie lo escribió). Con id, el Inbox lo pinta como
      // mensaje del equipo y con el nombre de quien lo mandó.
      sentById: args.sentById ?? null,
      sentAt: now,
      isInternal: false,       // es parte de la conversación, no una nota
      // `sys:<kind>:<wamid>` — marca el origen SIN columna nueva y permite
      // excluir estos envíos del tope diario del bot (ver webhook).
      externalId: buildSystemExternalId(args.kind, args.wamid),
      ...(args.attachments ? { attachments: args.attachments as any } : {}),
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
