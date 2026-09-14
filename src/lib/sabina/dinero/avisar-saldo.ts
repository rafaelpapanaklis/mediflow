/**
 * `avisar_saldo_whatsapp` — el aviso de saldo pendiente por WhatsApp, el mismo
 * botón «Enviar WhatsApp» del detalle de la factura
 * (POST /api/invoices/[id]/send-whatsapp).
 *
 * 🔴 LO QUE SABINA PONE PORQUE EL SERVIDOR NO LO PONE (MAPA-dinero F9 y §7.11)
 *
 *  · UN aviso por factura al día. El servidor no tiene antiduplicado. Se mira en
 *    dos sitios: el Inbox (lo que salió hoy a ese teléfono, venga de la pantalla o
 *    de Sabina) y el rastro de Sabina (cada propuesta de aviso de esa factura que
 *    se confirmó hoy: la que salió, la que falló sin saber si llegó, y la que se
 *    confirmó y todavía no tiene resultado —en curso, o se cortó a la mitad—).
 *    Un aviso de hoy que salió como plantilla no dice de qué nota era: se cuenta
 *    como de esta, porque lo que se evita es mandarle dos cobros el mismo día.
 *  · La tarjeta enseña el texto EXACTO que recibe el paciente. Sale de
 *    `buildPaymentNotice` (el mismo que usa el handler) y de la misma decisión
 *    texto/plantilla que toma el envío (`decideSendMode`), con la ventana de 24 h
 *    medida igual (`lastInboundAtForPhone`). Si al confirmar la ventana ya se
 *    cerró, el texto cambia, la huella no coincide y no se manda.
 *  · Tras un 502 no se reintenta ESE DÍA: Meta pudo haber entregado el mensaje y
 *    el Inbox no lo muestra (solo registra lo que Meta confirmó), así que «mira el
 *    Inbox» no prueba nada. Si hace falta, se manda desde la factura, a mano.
 */

import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import { CHARGEABLE_INVOICE_STATUSES } from "@/components/dashboard/billing/invoice-status";
import { digitsLast10, isWithin24hWindow } from "@/lib/inbox/send-core";
import { buildPaymentNotice } from "@/lib/invoices/payment-notice";
import { decideSendMode } from "@/lib/whatsapp/send-mode";
import { SYSTEM_EXTERNAL_ID_PREFIX } from "@/lib/whatsapp/system-message";
import { parseWaTemplates, renderTemplateBody, specForKind } from "@/lib/whatsapp/template-config";
import { definirAccion, type ManejadorRuta, type SabinaPreparacion } from "../engine-acciones";
import { ENTIDAD_PROPUESTA, EVENTO } from "../engine-propuestas-core";
import { horaDe, inicioDeHoy } from "../tools/fechas";
import type { SabinaCtx } from "../tipos";
import {
  ID_SEGURO,
  dbDineroDe,
  dinero,
  estadoDe,
  leerFacturaPorId,
  pacienteConFolio,
  resolverFactura,
  rutaComprobante,
  sinVerFacturacion,
  telefonoParcial,
  type FacturaLeida,
} from "./comun";
import { errorDelCuerpo, rechazoDeDinero } from "./respuestas";

/** Los del handler: cobrables SIN el borrador. */
const ENVIABLES = CHARGEABLE_INVOICE_STATUSES.filter((s) => s !== "DRAFT") as readonly string[];

const NOMBRE = "avisar_saldo_whatsapp";

const parametros = z.object({
  factura: z.string().max(40).optional().describe("Folio (MF-0042). Si no lo sabes, manda paciente."),
  paciente: z.string().max(120).optional(),
});

export type ParamsAviso = z.infer<typeof parametros>;

export interface DatosAviso {
  facturaId: string;
  folio: string;
  paciente: string;
  modo: "text" | "template";
  /**
   * Marca de ESTA propuesta. Al confirmar, la huella corre después de apuntar el
   * `sabina_confirmar` de esta misma propuesta: sin la marca, el tope se vería a sí
   * mismo «en curso» y no dejaría mandar nunca.
   */
  intento: string;
}

const esquemaDatos = z.object({
  facturaId: z.string().regex(ID_SEGURO),
  folio: z.string(),
  paciente: z.string(),
  modo: z.enum(["text", "template"]),
  intento: z.string().uuid(),
}) as z.ZodType<DatosAviso>;

/* ═══════════════════════════════════════════════════════════════════════
   EL TOPE: ¿YA SE LE AVISÓ HOY?
   ═══════════════════════════════════════════════════════════════════════ */

export interface AvisosDeHoy {
  /** Ya salió hoy uno de esta factura (o uno que no dice de cuál). */
  enviado: { hora: string; porSabina: boolean } | null;
  /** Un intento de Sabina de hoy que no se sabe si llegó: falló con 502/excepción, o sigue sin resultado. */
  dudoso: { hora: string; enCurso: boolean } | null;
}

/** Lo que ya pasó hoy con el aviso de esta factura. `excluirIntento`: la propuesta que se está confirmando. */
export async function avisosDeHoy(ctx: SabinaCtx, f: FacturaLeida, excluirIntento?: string): Promise<AvisosDeHoy> {
  const db = dbDineroDe(ctx);
  const hoy = inicioDeHoy(ctx.timezone);
  const ruta = `/api/invoices/${f.id}/send-whatsapp`;
  const ultimos10 = digitsLast10(f.paciente.telefono);

  const [enInbox, propuestas] = await Promise.all([
    ultimos10.length === 10
      ? db.inboxMessage.findMany({
          where: {
            direction: "OUT",
            sentAt: { gte: hoy },
            externalId: { startsWith: `${SYSTEM_EXTERNAL_ID_PREFIX}payment_notice:` },
            // 🔴 clinicId de la sesión, por el hilo. El `contains` solo pre-filtra;
            // el teléfono se compara abajo por sus 10 dígitos, como el Inbox.
            thread: { clinicId: ctx.clinicId, channel: "WHATSAPP", externalId: { contains: ultimos10 } },
          },
          select: { body: true, sentAt: true, thread: { select: { externalId: true } } },
          orderBy: { sentAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    // Las propuestas de ESTE aviso de hoy (una propuesta vive 10 min: se mira desde un rato antes de medianoche).
    db.auditLog.findMany({
      where: {
        clinicId: ctx.clinicId,
        entityType: ENTIDAD_PROPUESTA,
        action: EVENTO.proponer,
        createdAt: { gte: new Date(hoy.getTime() - 15 * 60_000) },
        changes: { path: ["accion"], equals: NOMBRE },
      },
      select: { entityId: true, changes: true },
      take: 500,
    }),
  ]);

  let enviado: AvisosDeHoy["enviado"] = null;
  for (const m of enInbox) {
    if (digitsLast10(m.thread?.externalId) !== ultimos10) continue;
    const body = String(m.body ?? "");
    // Texto libre: trae el folio. Plantilla: no trae ninguno y no se sabe de cuál era.
    const otroFolio = /\bMF-\d+/.test(body) && !body.includes(f.folio);
    if (otroFolio) continue;
    enviado = { hora: horaDe(new Date(m.sentAt), ctx.timezone), porSabina: false };
    break;
  }

  const ids = propuestas
    .filter((e: any) => e.changes?.datos?.facturaId === f.id && e.changes?.datos?.intento !== excluirIntento)
    .map((e: any) => e.entityId);
  const eventos = ids.length
    ? await db.auditLog.findMany({
        where: {
          clinicId: ctx.clinicId,
          entityType: ENTIDAD_PROPUESTA,
          entityId: { in: ids },
          action: { in: [EVENTO.confirmar, EVENTO.resultado] },
        },
        select: { entityId: true, action: true, changes: true, createdAt: true },
      })
    : [];

  let dudoso: AvisosDeHoy["dudoso"] = null;
  for (const id of ids) {
    const deEsta = eventos.filter((e: any) => e.entityId === id);
    const confirmada = deEsta.find((e: any) => e.action === EVENTO.confirmar);
    if (!confirmada) continue; // propuesta sin confirmar: no mandó nada
    const resultado = deEsta.find((e: any) => e.action === EVENTO.resultado);
    // Cuenta el día en que SALIÓ (el resultado, o el botón si no hay resultado), no el de
    // la propuesta: una preparada a las 23:50 y mandada entonces es de ayer, y no puede
    // tapar el aviso de hoy.
    const momento = new Date((resultado ?? confirmada).createdAt);
    if (momento.getTime() < hoy.getTime()) continue;
    const hora = horaDe(momento, ctx.timezone);
    if (!resultado) {
      dudoso ??= { hora, enCurso: true };
      continue;
    }
    const c = (resultado.changes ?? {}) as { ok?: unknown; llamadas?: Array<{ ruta?: unknown; status?: unknown }> };
    if (c.ok === true) {
      enviado ??= { hora, porSabina: true };
      continue;
    }
    const llamada = (c.llamadas ?? []).find((l) => l?.ruta === ruta);
    const status = Number(llamada?.status);
    // Un 4xx (sin teléfono, sin plantilla) no mandó nada; un 5xx o una excepción, quién sabe.
    if (llamada && (status === 0 || status >= 500)) dudoso ??= { hora, enCurso: false };
  }
  return { enviado, dudoso };
}

/* ═══════════════════════════════════════════════════════════════════════
   EL TEXTO EXACTO
   ═══════════════════════════════════════════════════════════════════════ */

type Mensaje =
  | { tipo: "ok"; modo: "text" | "template"; texto: string }
  | { tipo: "no"; frase: string };

/**
 * Lo que saldría AHORA: las mismas comprobaciones del handler, en el mismo orden,
 * y el texto que decidiría `sendWhatsAppLogged`. No manda nada.
 */
export async function mensajeDe(ctx: SabinaCtx, f: FacturaLeida): Promise<Mensaje> {
  if (!ENVIABLES.includes(f.status)) {
    return {
      tipo: "no",
      frase:
        f.status === "DRAFT"
          ? `La factura ${f.folio} está en borrador: el aviso solo sale de facturas confirmadas.`
          : `La factura ${f.folio} está ${estadoDe(f.status)}: el aviso solo sale de una factura con saldo por cobrar.`,
    };
  }
  if (f.saldo <= 0) return { tipo: "no", frase: `La factura ${f.folio} no tiene saldo pendiente.` };
  if (!f.paciente.telefono) {
    return { tipo: "no", frase: `${f.paciente.nombre} no tiene teléfono registrado. Agrégalo en su expediente para poder avisarle.` };
  }
  const db = dbDineroDe(ctx);
  // El token de WhatsApp NO se lee: solo se pregunta si existe.
  const [clinica, conToken] = await Promise.all([
    db.clinic.findFirst({ where: { id: ctx.clinicId }, select: { name: true, phone: true, waConnected: true, waPhoneNumberId: true, waTemplates: true } }),
    db.clinic.findFirst({ where: { id: ctx.clinicId, waAccessToken: { not: null } }, select: { id: true } }),
  ]);
  if (!clinica?.waConnected || !clinica.waPhoneNumberId || !conToken) {
    return { tipo: "no", frase: "WhatsApp no está conectado en esta clínica. Se conecta en Configuración → WhatsApp." };
  }
  const telefonoClinica = String(clinica.phone ?? "").trim();
  if (!telefonoClinica) {
    return { tipo: "no", frase: "Falta el teléfono de la clínica (Configuración → Clínica): el aviso lo necesita para decir a dónde llamar." };
  }

  const aviso = buildPaymentNotice({
    patient: { firstName: f.paciente.firstName, lastName: f.paciente.lastName },
    clinicName: clinica.name,
    clinicPhone: telefonoClinica,
    invoiceNumber: f.folio,
    balance: f.balance,
    items: f.items,
  });
  const { lastInboundAtForPhone } = await import("@/lib/whatsapp/inbox-log");
  const ultimoDelPaciente = await lastInboundAtForPhone(ctx.clinicId, f.paciente.telefono);
  const decision = decideSendMode({
    kind: "payment_notice",
    windowOpen: isWithin24hWindow(ultimoDelPaciente, new Date()),
    templates: parseWaTemplates(clinica.waTemplates ?? null),
    params: aviso.templateParams,
  });
  if (decision.mode === "blocked") return { tipo: "no", frase: `No se puede mandar: ${decision.reason}` };
  if (decision.mode === "template") {
    return { tipo: "ok", modo: "template", texto: renderTemplateBody(specForKind("payment_notice"), decision.params, aviso.body) };
  }
  return { tipo: "ok", modo: "text", texto: aviso.body };
}

/* ═══════════════════════════════════════════════════════════════════════
   FASE 1
   ═══════════════════════════════════════════════════════════════════════ */

export async function prepararAviso(ctx: SabinaCtx, p: ParamsAviso): Promise<SabinaPreparacion<DatosAviso>> {
  const sinVer = sinVerFacturacion(ctx);
  if (sinVer) return sinVer;
  const r = await resolverFactura(ctx, p, {
    estados: ENVIABLES,
    filtro: (f) => ENVIABLES.includes(f.status) && f.saldo > 0,
    queTiene: "con saldo por cobrar",
  });
  if (r.tipo === "aclarar") return { tipo: "aclarar", pregunta: r.pregunta, opciones: r.opciones };
  if (r.tipo === "no") return { tipo: "no_se_puede", frase: r.frase };
  const f = r.valor;

  const m = await mensajeDe(ctx, f);
  if (m.tipo === "no") return { tipo: "no_se_puede", frase: m.frase };

  const hoy = await avisosDeHoy(ctx, f);
  if (hoy.enviado) {
    return {
      tipo: "no_se_puede",
      frase:
        `Hoy a las ${hoy.enviado.hora} ya ${hoy.enviado.porSabina ? "le mandé" : "salió"} un aviso de saldo a ${f.paciente.nombre}. ` +
        "Para no mandarle dos el mismo día, no preparo otro: mañana sí.",
    };
  }

  if (hoy.dudoso) {
    return {
      tipo: "no_se_puede",
      frase: hoy.dudoso.enCurso
        ? `Hay un envío de este aviso confirmado a las ${hoy.dudoso.hora} que todavía no termina (o se cortó a la mitad). Para no mandarlo dos veces, hoy no preparo otro.`
        : `Hoy a las ${hoy.dudoso.hora} intenté mandar este aviso y WhatsApp contestó con error: pudo haberle llegado aunque no aparezca en el Inbox. Para no mandárselo dos veces, hoy no preparo otro; si de verdad hace falta, mándalo desde la factura.`,
    };
  }

  const avisos: string[] = [];
  avisos.push(
    m.modo === "text"
      ? "Sale como mensaje normal (el paciente escribió en las últimas 24 h), con el comprobante PDF adjunto."
      : "El paciente no ha escrito en las últimas 24 h: sale como plantilla de WhatsApp (Meta se la cobra a la clínica) y sin el PDF.",
  );
  avisos.push("Le llega al paciente en cuanto confirmes, y queda en el Inbox.");

  return {
    tipo: "propuesta",
    datos: { facturaId: f.id, folio: f.folio, paciente: f.paciente.nombre, modo: m.modo, intento: randomUUID() },
    tarjeta: {
      frase: `Mandar a ${f.paciente.nombre} por WhatsApp el aviso de saldo de la factura ${f.folio}: ${dinero(f.balance)}.`,
      detalles: [
        { etiqueta: "Paciente", valor: `${pacienteConFolio(f.paciente)} · ${telefonoParcial(f.paciente.telefono) ?? ""}`.trim() },
        { etiqueta: "Factura", valor: `${f.folio} · ${estadoDe(f.status)} · saldo ${dinero(f.balance)}` },
        { etiqueta: "Mensaje que recibe", valor: `«${m.texto}»` },
      ],
      avisos,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   LA ACCIÓN
   ═══════════════════════════════════════════════════════════════════════ */

export const accionAvisarSaldo = definirAccion<ParamsAviso, DatosAviso>({
  nombre: NOMBRE,
  descripcion: "Prepara el aviso de saldo pendiente de una factura por WhatsApp al paciente. Uno por factura al día.",
  titulo: "Aviso de saldo por WhatsApp",
  boton: "Sí, mandar el aviso",
  queHace: "mandar avisos de saldo por WhatsApp",
  permiso: "whatsapp.send",
  deshacer: { reversible: false, aviso: "Un WhatsApp enviado no se puede retirar." },
  parametros,
  datos: esquemaDatos,

  preparar: prepararAviso,

  /**
   * El texto exacto (por su hash: el texto ya está en la tarjeta), cómo sale, y
   * que hoy no haya salido otro. Si cualquiera cambió, no se manda.
   */
  async huella(ctx, d) {
    const f = await leerFacturaPorId(ctx, d.facturaId);
    if (!f) return `ya_no:${randomUUID()}`;
    const m = await mensajeDe(ctx, f);
    if (m.tipo === "no") return `ya_no:${randomUUID()}`;
    const hoy = await avisosDeHoy(ctx, f, d.intento);
    if (hoy.enviado || hoy.dudoso) return `ya_salio:${randomUUID()}`;
    const texto = createHash("sha256").update(m.texto).digest("hex");
    return [m.modo, texto, f.status, f.balance].join("|");
  },

  async ejecutar(llave, _ctx, d) {
    if (!ID_SEGURO.test(d.facturaId)) {
      return { ok: false, tipo: "error", frase: "Esa propuesta no se pudo ejecutar tal como estaba. No se mandó nada." };
    }
    const { POST } = await import("@/app/api/invoices/[id]/send-whatsapp/route");
    let r;
    try {
      r = await llave.llamar(POST as ManejadorRuta, {
        metodo: "POST",
        ruta: `/api/invoices/${d.facturaId}/send-whatsapp`,
        params: { id: d.facturaId },
      });
    } catch {
      r = { status: 0, cuerpo: null };
    }
    if (r.status === 200) {
      return {
        ok: true,
        frase: `Listo: le mandé a ${d.paciente} el aviso de saldo de la factura ${d.folio} por WhatsApp. Queda en el Inbox.`,
        entidad: { tipo: "invoice", id: d.facturaId },
        enlace: { texto: `Comprobante ${d.folio}`, url: rutaComprobante(d.facturaId) },
      };
    }
    if (r.status === 0 || r.status >= 500) {
      // 502: Meta pudo haberlo entregado aunque contestara con error. No se reintenta.
      const detalle = errorDelCuerpo(r);
      return {
        ok: false,
        tipo: "error",
        frase:
          `WhatsApp contestó con un error${detalle ? ` («${detalle}»)` : ""} y no sé si el mensaje le llegó a ${d.paciente}: ` +
          "pudo llegar aunque no aparezca en el Inbox. Para no mandárselo dos veces, hoy no lo vuelvo a intentar.",
      };
    }
    return rechazoDeDinero(r, "No se mandó el aviso", "mandar mensajes de WhatsApp");
  },
});
