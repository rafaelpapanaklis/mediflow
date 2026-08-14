// GET/POST /api/inbox/compose — INICIAR una conversación de WhatsApp con un
// paciente que todavía no tiene hilo.
//
// EL HUECO QUE CIERRA: hasta ahora la clínica solo podía RESPONDER. El "+
// Componer" del Inbox era un toast de "próximamente" y la ficha del paciente,
// cuando no había conversación, decía "Sin conversaciones" y ahí se acababa.
// Una paciente registrada, con teléfono, a la que hay que mandarle las
// indicaciones post-tratamiento: no se podía.
//
// LA REGLA QUE MANDA (y no es nuestra, es de Meta): a quien nunca ha escrito
// —o cuya ventana de 24 h ya cerró— SOLO se le entrega una PLANTILLA APROBADA.
// El texto libre lo rechaza con 131047. Por eso el flujo es siempre
// paciente → plantilla aprobada → enviar, y no hay un recuadro de texto aquí.
//
//   GET  ?patientId= → si se puede escribirle, con qué plantillas, y si ya
//                      existe una conversación (para abrirla en vez de crearla).
//   POST {patientId, kind} → la envía. Si había hilo se usa ESE; si no, se crea
//                      y nace ligado al paciente.
//
// NO CONSTRUYE NADA EN PARALELO:
//   · las opciones y sus variables → lib/inbox/template-offer (compartido con
//     el composer del hilo, para que lo que se ve y lo que sale no diverjan);
//   · el envío + el registro en el Inbox → `sendWhatsAppLogged`, que decide
//     texto vs. plantilla y agrupa por los últimos 10 dígitos del destino;
//   · localizar el hilo del teléfono → `findWhatsAppThreadsForPhone`, el ÚNICO
//     criterio de emparejamiento del repo.
//
// Multi-tenant: clinicId SIEMPRE de getAuthContext, nunca del body. El paciente
// se busca acotado a esa clínica y pasa por `assertPatientVisible`.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { acquireLock, releaseLock } from "@/lib/failban";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible, type VisibilityViewer } from "@/lib/patient-visibility";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { describeNoTemplatesAvailable } from "@/lib/inbox/composer-templates";
import {
  TEMPLATES_MANAGE_HREF,
  TEMPLATE_CLINIC_SELECT,
  buildTemplateOffering,
  describeMetaError,
  describeWhatsAppNotReady,
  kindsForSession,
  templateDisplayName,
} from "@/lib/inbox/template-offer";
import {
  findWhatsAppThreadsForPhone,
  lastInboundAtForPhone,
} from "@/lib/whatsapp/inbox-log";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { WhatsAppApiError, WhatsAppBlockedError, waErrorCode } from "@/lib/whatsapp/errors";
import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

export const dynamic = "force-dynamic";

/** Sin teléfono no hay a dónde escribir, y el punto de entrada no debe ofrecerse. */
const REASON_NO_PHONE =
  "Este paciente no tiene teléfono registrado, así que no se le puede escribir por WhatsApp. " +
  "Captúralo en su ficha y vuelve a intentarlo.";

/**
 * "No existe" y "no lo puedes ver" comparten respuesta A PROPÓSITO: distinguirlos
 * confirmaría que el paciente existe en la clínica a quien no debería saberlo.
 * El texto va en español porque este cuerpo se lee TAL CUAL en el panel, y aquí
 * el motivo estándar del helper (`patient_not_found`) sería un código crudo en
 * pantalla.
 */
// Una función y no una constante: un NextResponse solo se puede consumir una
// vez, y devolver la MISMA instancia en dos peticiones dejaría la segunda sin
// cuerpo.
const notAvailable = () =>
  NextResponse.json(
    { error: "Ese paciente no está disponible para tu usuario." },
    { status: 404 },
  );

const PostSchema = z.object({
  patientId: z.string().min(1).max(64),
  kind: z.string().min(1).max(40),
});

const PATIENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
} as const;

/**
 * Paciente de ESTA clínica, vivo.
 *
 * `deletedAt: null` no es decorativo: un paciente cancelado por ARCO pidió que
 * lo borráramos, y mandarle un WhatsApp sería exactamente lo contrario.
 */
function loadPatient(clinicId: string, patientId: string) {
  return prisma.patient.findFirst({
    where: { id: patientId, clinicId, deletedAt: null },
    select: PATIENT_SELECT,
  });
}

/**
 * "Su" conversación de WhatsApp, si ya existe.
 *
 * Se busca POR TELÉFONO (no por el enlace hilo↔paciente): el caso normal es
 * justo el hilo huérfano —el paciente escribió antes de darse de alta— y
 * filtrar por `patientId` lo dejaría invisible, que es el fallo que ya cerró
 * lib/inbox/patient-threads.
 *
 * Un hilo ligado a OTRO paciente NO se devuelve: dos hermanos pueden compartir
 * el celular de la mamá, y abrir esa conversación en nombre de este paciente
 * sería enseñar los mensajes de un tercero. El mensaje que se envíe caerá igual
 * en ese hilo (WhatsApp agrupa por número, no por persona), pero eso lo decide
 * `sendWhatsAppLogged`, no esta ruta.
 */
async function findExistingThread(
  clinicId: string,
  patientId: string,
  phone: string,
): Promise<string | null> {
  const threads = await findWhatsAppThreadsForPhone(clinicId, phone);
  const mine = threads.find((t) => t.patientId === patientId);
  if (mine) return mine.id;
  const orphan = threads.find((t) => t.patientId === null);
  return orphan?.id ?? null;
}

// ═══════════════════════════════ GET ═══════════════════════════════

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    // "inbox.send" y no "inbox.view": esto NO es una lectura del Inbox, es la
    // antesala de un envío que Meta le cobra a la clínica. Quien no puede
    // enviar no tiene nada que hacer aquí, y así el cliente no necesita un
    // segundo permiso para saber si esconder el botón.
    const denied = denyIfMissingPermission(ctx, "inbox.send");
    if (denied) return denied;

    const patientId = (req.nextUrl.searchParams.get("patientId") ?? "").trim();
    if (!patientId) {
      return NextResponse.json({ error: "Falta indicar el paciente." }, { status: 400 });
    }

    const viewer: VisibilityViewer = {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    };
    if (await assertPatientVisible(patientId, viewer)) return notAvailable();

    const patient = await loadPatient(ctx.clinicId, patientId);
    if (!patient) return notAvailable();

    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: TEMPLATE_CLINIC_SELECT,
    });
    const waConnected = Boolean(clinic?.waConnected);
    const billingOk = Boolean(clinic?.waBillingOk);
    const patientName = templateDisplayName(patient);
    const phone = (patient.phone ?? "").trim();

    if (!phone) {
      // Se responde el contrato COMPLETO igual que en el resto de casos: el
      // cliente no necesita otro camino, solo el motivo.
      return NextResponse.json({
        patient: { id: patient.id, name: patientName, firstName: patient.firstName, phone: null },
        threadId: null,
        windowOpen: false,
        waConnected,
        billingOk,
        options: [],
        unavailableReason: REASON_NO_PHONE,
        manageHref: TEMPLATES_MANAGE_HREF,
      });
    }

    const now = new Date();
    const [threadId, lastInbound] = await Promise.all([
      findExistingThread(ctx.clinicId, patient.id, phone),
      lastInboundAtForPhone(ctx.clinicId, phone),
    ]);
    // Informativo: quien decide de verdad al enviar es sendWhatsAppLogged, que
    // mide la ventana contra el mismo teléfono. Abierta = el mensaje sale como
    // texto y no cuesta; cerrada = plantilla, y la cobra Meta.
    const windowOpen = isWithin24hWindow(lastInbound, now);

    // Mismo gate que protege el saldo en el resto del producto: el aviso de
    // saldo lleva el importe DENTRO del cuerpo de la plantilla.
    const canSeeBilling = !denyIfMissingPermission(ctx, "billing.view");

    const { options } = await buildTemplateOffering({
      clinicId: ctx.clinicId,
      clinic: clinic ?? { name: null, phone: null, timezone: null, waTemplates: null },
      patient,
      canSeeBilling,
      now,
    });

    return NextResponse.json({
      patient: { id: patient.id, name: patientName, firstName: patient.firstName, phone },
      threadId,
      windowOpen,
      waConnected,
      billingOk,
      options,
      unavailableReason: describeNoTemplatesAvailable({ options, waConnected, billingOk }),
      manageHref: TEMPLATES_MANAGE_HREF,
    });
  } catch (err) {
    console.error("[GET inbox/compose]", err);
    return NextResponse.json({ error: "No se pudieron cargar las plantillas." }, { status: 500 });
  }
}

// ═══════════════════════════════ POST ═══════════════════════════════

export async function POST(req: NextRequest) {
  // Cada plantilla se la cobra Meta a la clínica: un botón que se dispara solo
  // (doble clic, reintento del cliente) le cuesta dinero de verdad.
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  let lockKey: string | null = null;
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    // MISMO gate que usa el Inbox para responder.
    const denied = denyIfMissingPermission(ctx, "inbox.send");
    if (denied) return denied;

    const raw = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Falta indicar el paciente y qué plantilla enviar." },
        { status: 400 },
      );
    }
    const kind = parsed.data.kind as WhatsAppSendKind;

    // Allowlist de tipos: solo los que el composer sabe rellenar Y los que ESTA
    // sesión puede ofrecer. Se comprueba en el servidor porque los chips los
    // pinta el cliente, y el cliente no es quien decide los permisos.
    const canSeeBilling = !denyIfMissingPermission(ctx, "billing.view");
    if (!(kindsForSession(canSeeBilling) as readonly string[]).includes(kind)) {
      return NextResponse.json(
        { error: "Esa plantilla no se puede enviar desde aquí." },
        { status: 400 },
      );
    }

    const viewer: VisibilityViewer = {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    };
    if (await assertPatientVisible(parsed.data.patientId, viewer)) return notAvailable();

    const patient = await loadPatient(ctx.clinicId, parsed.data.patientId);
    if (!patient) return notAvailable();

    const to = (patient.phone ?? "").trim();
    if (!to) return NextResponse.json({ error: REASON_NO_PHONE }, { status: 409 });

    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: TEMPLATE_CLINIC_SELECT,
    });
    // sendWhatsAppLogged NO filtra por waConnected (sus callers ya lo hacen):
    // sin este gate el envío iría a Meta con credenciales vacías y volvería un
    // error opaco en vez de decir qué hay que conectar.
    const notReady = clinic
      ? describeWhatsAppNotReady(clinic)
      : "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp.";
    if (!clinic || notReady) return NextResponse.json({ error: notReady }, { status: 409 });

    const now = new Date();
    // Los params se RECALCULAN aquí, nunca llegan del body: son el texto que
    // Meta le entrega al paciente firmado por la clínica.
    const { byKind } = await buildTemplateOffering({
      clinicId: ctx.clinicId,
      clinic,
      patient,
      canSeeBilling,
      now,
    });
    const built = byKind.get(kind);
    if (!built) return NextResponse.json({ error: "Esa plantilla ya no existe." }, { status: 400 });
    if (built.option.blockedReason) {
      // No se llama a Meta: el mensaje no llegaría y encima parecería enviado.
      return NextResponse.json({ error: built.option.blockedReason }, { status: 409 });
    }
    // buildInboxTemplateOption garantiza el preview cuando no hay blockedReason.
    const preview = built.option.preview ?? "";

    // Candado por clínica+paciente+plantilla. El botón ya se deshabilita al
    // pulsarlo, pero un doble clic rápido, un reintento del navegador o dos
    // pestañas abiertas mandarían DOS plantillas y Meta cobra las dos. El TTL
    // corto es el freno; se suelta solo si el envío falla, para poder reintentar
    // en el acto.
    lockKey = `wa-compose:${ctx.clinicId}:${patient.id}:${kind}`;
    if (!(await acquireLock(lockKey, 20))) {
      lockKey = null; // el candado es de la otra petición: no lo soltamos nosotros
      return NextResponse.json(
        { error: "Ese mensaje se acaba de enviar. Espera unos segundos antes de repetirlo." },
        { status: 409 },
      );
    }

    try {
      // Dentro de la ventana de 24 h sale `preview` como texto libre (gratis);
      // fuera sale la PLANTILLA con estos params. El helper además CREA el hilo
      // si no existía (o reutiliza el que ya haya para ese número), registra el
      // mensaje, marca waBillingOk ante el 131042 y lanza WhatsAppBlockedError
      // con el motivo ya en español.
      await sendWhatsAppLogged({
        clinic: {
          id: clinic.id,
          waPhoneNumberId: clinic.waPhoneNumberId,
          waAccessToken: clinic.waAccessToken,
          waConnected: clinic.waConnected,
          waTemplates: clinic.waTemplates,
        },
        to,
        body: preview,
        kind,
        templateParams: built.params,
        // El hilo nace ligado a ESTE paciente, no al que adivine el teléfono:
        // así aparece en el Inbox con su nombre y no con el de perfil de
        // WhatsApp, y la ficha lo encuentra desde el primer mensaje.
        patientId: patient.id,
        // Lo mandó una PERSONA: la conversación lo muestra con su nombre.
        sentById: ctx.userId,
      });
    } catch (e) {
      // Falló: el candado se suelta para que se pueda reintentar en el acto.
      await releaseLock(lockKey);
      lockKey = null;
      if (e instanceof WhatsAppBlockedError) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      if (e instanceof WhatsAppApiError) {
        // El error crudo (con su código) queda en el log para diagnóstico; al
        // panel va la traducción en español.
        console.error(`[POST inbox/compose] Meta rechazó ${kind} (paciente ${patient.id}):`, e);
        return NextResponse.json({ error: describeMetaError(waErrorCode(e)) }, { status: 502 });
      }
      console.error(`[POST inbox/compose] fallo al enviar ${kind} (paciente ${patient.id}):`, e);
      return NextResponse.json({ error: "No se pudo enviar la plantilla." }, { status: 502 });
    }
    // Salió: el candado se queda tomado hasta que venza su TTL. Se olvida la
    // llave para que ningún camino de error posterior lo suelte — soltarlo
    // ahora abriría la puerta al segundo envío que este candado existe para
    // evitar, y el mensaje ya está entregado.
    lockKey = null;

    // A dónde llevar al usuario. Se busca DESPUÉS del envío a propósito: el hilo
    // puede acabar de nacer dentro de sendWhatsAppLogged, y crearlo antes
    // dejaría una conversación vacía en el Inbox cada vez que Meta rechazara el
    // mensaje.
    let threadId: string | null = null;
    try {
      threadId = await findExistingThread(ctx.clinicId, patient.id, to);
      if (threadId) {
        // Lo que `sendWhatsAppLogged` no hace, porque él sirve a los envíos
        // automáticos: pausar el bot. Esto lo mandó una persona y el bot no debe
        // pisar la conversación que acaba de abrir.
        await prisma.inboxThread.update({
          where: { id: threadId },
          data: { botActive: false },
        });
      }
    } catch (e) {
      // Best-effort: el mensaje YA salió. Sin threadId el cliente solo se queda
      // sin el salto a la conversación; darlo por no enviado sería peor.
      console.error(`[POST inbox/compose] no se pudo resolver el hilo (paciente ${patient.id}):`, e);
    }

    return NextResponse.json({ ok: true, threadId, body: preview }, { status: 201 });
  } catch (err) {
    if (lockKey) await releaseLock(lockKey).catch(() => {});
    console.error("[POST inbox/compose]", err);
    return NextResponse.json({ error: "No se pudo enviar la plantilla." }, { status: 500 });
  }
}
