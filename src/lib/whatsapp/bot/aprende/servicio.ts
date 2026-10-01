import "server-only";
import { prisma } from "@/lib/prisma";
import { matchFaq } from "@/lib/whatsapp/bot/engine";
import { getOrCreateBotConfig } from "@/app/api/whatsapp/bot/service";
import {
  anonimizar,
  evaluarPar,
  motivoClinico,
  problemaDeTextoDeFaq,
  TEXTO_MAX_CARACTERES,
  type MotivoNoApto,
  type OpcionesAnonimizar,
} from "./anonimizar";
import {
  detectarEventos,
  esDelEquipo,
  esRespuestaDelBot,
  preguntaPrevia,
  PREFIJO_NOTA_HANDOFF,
  PREFIJO_RESPUESTA_BOT,
  type EventoNoSupo,
  type MensajeHilo,
} from "./detectar";
import { armarReporte, type GrupoReporte } from "./reporte";
import { temaDePregunta } from "./temas";
import { __olvidarAusencia, ErrorAprende, exigirTablas, tablasDisponibles } from "./tablas";
import { bloqueDeTonoDeLaClinica } from "./tono-prompt";
import { MAX_EJEMPLOS_TONO, motivoTonoNoApto, type MotivoTonoNoApto } from "./tono";

/**
 * El bot aprende de cada clínica, SUPERVISADO (ws1-t11). Todo lo que toca la
 * base vive aquí; la lógica (detectar, anonimizar, agrupar) es pura y está en
 * los módulos vecinos.
 *
 * Reglas de la casa que se cumplen aquí:
 *  - TODO filtra por `clinicId`, y el `clinicId` llega de la sesión (lo pasa
 *    la ruta). Si falta, se corta antes de consultar (`exigirClinica`).
 *  - Nada se aprende solo: el escaneo crea SUGERENCIAS; solo `decidirSugerencia`
 *    con «aprobar» (una persona con permiso) crea una respuesta frecuente.
 *  - Los textos se guardan anonimizados; lo clínico se guarda como 'no_apto'
 *    sin texto.
 *  - Sin IA: detección y temas por reglas. No gasta Saldo IA.
 *  - Mientras sql/ws1-t11-bot-aprende.sql no esté pegado, las tres tablas no
 *    existen: las lecturas devuelven «no disponible» y la pantalla oculta lo
 *    que depende de ellas (el reporte sigue, sale del Inbox).
 */

const DIA_MS = 24 * 60 * 60 * 1000;
/** Lo que el escaneo revisa hacia atrás (la primera vez y cada vez: es idempotente). */
export const DIAS_ESCANEO = 30;
/** El reporte es de la semana. */
export const DIAS_REPORTE = 7;
const DIAS_RESPUESTAS_RECIENTES = 14;
const MAX_HILOS = 150;
const MAX_MENSAJES_POR_TANDA = 4000;
const TANDA_HILOS = 50;
/** Escanear cada vez que se abre la pantalla es barato, pero no hace falta en cada recarga. */
const ESCANEO_CADA_MS = 5 * 60 * 1000;

function exigirClinica(clinicId: string | null | undefined): string {
  // Regla dura (c): `clinicId: undefined` no filtra nada en Prisma.
  if (!clinicId || typeof clinicId !== "string") throw new ErrorAprende("Sin clínica", 401, "sin_clinica");
  return clinicId;
}

/** Solo para tests. */
export function __reiniciarEstado(): void {
  __olvidarAusencia();
  ultimoEscaneo.clear();
}

// ── Lectura del Inbox ─────────────────────────────────────────────────────────

const SELECT_MENSAJE = {
  id: true,
  threadId: true,
  direction: true,
  body: true,
  sentAt: true,
  sentById: true,
  externalId: true,
  isInternal: true,
  attachments: true,
} as const;

/** Lo que el bot dice cuando no sabe (prefiltro barato; `esDisparador` decide). */
const FRASES_NO_SUPO = ["comunico con", "no tengo esa informaci", "no tengo la informaci", "del equipo te", "en breve te"];

/** Datos públicos de la clínica que el anonimizado deja (su teléfono y correo). */
async function datosPublicosDeLaClinica(clinicId: string): Promise<string[]> {
  const c = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { phone: true, email: true } });
  return [c?.phone ?? "", c?.email ?? ""].filter(Boolean);
}

/** Nombre y apellido del paciente de cada hilo (para quitarlos del texto). */
async function nombresPorHilo(clinicId: string, threadIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (threadIds.length === 0) return out;
  const hilos = await prisma.inboxThread.findMany({
    where: { clinicId, id: { in: threadIds } },
    select: { id: true, patient: { select: { firstName: true, lastName: true } } },
  });
  for (const h of hilos) out.set(h.id, h.patient ? [h.patient.firstName, h.patient.lastName] : []);
  return out;
}

/** Mensajes de varios hilos de la clínica, en orden, por tandas (pooler: pocas a la vez). */
async function mensajesDeHilos(clinicId: string, threadIds: string[], desde: Date): Promise<Map<string, MensajeHilo[]>> {
  const porHilo = new Map<string, MensajeHilo[]>();
  for (let i = 0; i < threadIds.length; i += TANDA_HILOS) {
    const tanda = threadIds.slice(i, i + TANDA_HILOS);
    const filas = await prisma.inboxMessage.findMany({
      where: { threadId: { in: tanda }, thread: { clinicId }, sentAt: { gte: desde } },
      orderBy: [{ sentAt: "asc" }],
      take: MAX_MENSAJES_POR_TANDA,
      select: SELECT_MENSAJE,
    });
    for (const f of filas) {
      const lista = porHilo.get(f.threadId) ?? [];
      lista.push(f as MensajeHilo);
      porHilo.set(f.threadId, lista);
    }
  }
  return porHilo;
}

export type EventoConContexto = EventoNoSupo & { anonimizar: OpcionesAnonimizar };

/** Los «el bot no supo» de la clínica desde `desde`, con lo que contestó el equipo. */
export async function cargarEventos(clinicIdSesion: string, desde: Date): Promise<EventoConContexto[]> {
  const clinicId = exigirClinica(clinicIdSesion);
  const disparadores = await prisma.inboxMessage.findMany({
    where: {
      thread: { clinicId, channel: "WHATSAPP" },
      sentAt: { gte: desde },
      OR: [
        { isInternal: true, body: { startsWith: PREFIJO_NOTA_HANDOFF } },
        {
          direction: "OUT",
          isInternal: false,
          sentById: null,
          AND: [
            { OR: [{ externalId: null }, { externalId: { startsWith: PREFIJO_RESPUESTA_BOT } }] },
            { OR: FRASES_NO_SUPO.map((f) => ({ body: { contains: f, mode: "insensitive" as const } })) },
          ],
        },
      ],
    },
    orderBy: { sentAt: "desc" },
    take: 400,
    select: { threadId: true },
  });
  const threadIds = Array.from(new Set(disparadores.map((d) => d.threadId))).slice(0, MAX_HILOS);
  if (threadIds.length === 0) return [];

  // Una hora antes de la ventana: la pregunta de un «no supe» del primer día.
  const [mensajes, nombres, conservar] = await Promise.all([
    mensajesDeHilos(clinicId, threadIds, new Date(desde.getTime() - 60 * 60 * 1000)),
    nombresPorHilo(clinicId, threadIds),
    datosPublicosDeLaClinica(clinicId),
  ]);

  const eventos: EventoConContexto[] = [];
  for (const [threadId, lista] of Array.from(mensajes.entries())) {
    const opciones: OpcionesAnonimizar = { nombres: nombres.get(threadId) ?? [], conservar };
    for (const ev of detectarEventos(lista)) {
      if (ev.at >= desde) eventos.push({ ...ev, anonimizar: opciones });
    }
  }
  return eventos;
}

// ── Escaneo → sugerencias ─────────────────────────────────────────────────────

/** Fila que el escaneo inserta (pura, para poder probarla). */
export function filaDeSugerencia(clinicId: string, ev: EventoConContexto) {
  const base = {
    clinicId,
    origen: "equipo",
    threadId: ev.threadId,
    fuenteId: ev.disparadorId,
  };
  const evaluacion = evaluarPar(ev.pregunta, ev.respuesta ?? "", ev.anonimizar);
  if ("motivo" in evaluacion) {
    return {
      ...base,
      estado: "no_apto",
      motivoNoApto: evaluacion.motivo,
      tema: evaluacion.motivo === "clinico" ? "clinico" : null,
      pregunta: null,
      respuesta: null,
    };
  }
  return {
    ...base,
    estado: "pendiente",
    motivoNoApto: null,
    tema: temaDePregunta(evaluacion.pregunta),
    pregunta: evaluacion.pregunta,
    respuesta: evaluacion.respuesta,
  };
}

const ultimoEscaneo = new Map<string, number>();

/**
 * Crea las sugerencias que falten. Idempotente: (clinicId, fuenteId) es único
 * y se inserta con `skipDuplicates`, así que una sugerencia descartada nunca
 * vuelve. Solo los eventos con respuesta del equipo enseñan algo.
 */
export async function escanearSugerencias(
  clinicIdSesion: string,
  eventos: EventoConContexto[],
  opciones: { forzar?: boolean } = {},
): Promise<number> {
  const clinicId = exigirClinica(clinicIdSesion);
  const ahora = Date.now();
  if (!opciones.forzar && ahora - (ultimoEscaneo.get(clinicId) ?? 0) < ESCANEO_CADA_MS) return 0;
  ultimoEscaneo.set(clinicId, ahora);
  const filas = eventos.filter((e) => e.respuesta).map((e) => filaDeSugerencia(clinicId, e));
  if (filas.length === 0) return 0;
  const r = await prisma.whatsAppBotSugerencia.createMany({ data: filas, skipDuplicates: true });
  return r.count;
}

// ── La pantalla ───────────────────────────────────────────────────────────────

export type SugerenciaDTO = {
  id: string;
  origen: "equipo" | "correccion";
  pregunta: string;
  respuesta: string;
  tema: string | null;
  createdAt: string;
};

export type RespuestaBotDTO = {
  id: string;
  at: string;
  pregunta: string | null;
  respuesta: string;
  valor: "bien" | "mal" | null;
  correccion: string | null;
};

export type RespuestaEquipoDTO = {
  id: string;
  at: string;
  texto: string;
  /** null = se puede marcar «así hablamos». */
  noApto: MotivoTonoNoApto | null;
};

export type EjemploTonoDTO = { id: string; texto: string; createdAt: string };

export type PanelAprendeDTO = {
  /** false = el SQL aún no se pega: solo hay reporte. */
  disponible: boolean;
  reporte: GrupoReporte[];
  sugerencias: SugerenciaDTO[];
  /** Cuántas se apartaron solas en el periodo (clínicas, personales…), sin texto. */
  apartadas: Partial<Record<MotivoNoApto, number>>;
  respuestasBot: RespuestaBotDTO[];
  respuestasEquipo: RespuestaEquipoDTO[];
  ejemplosTono: EjemploTonoDTO[];
  maxEjemplosTono: number;
};

/** Respuestas recientes del bot con la pregunta que contestaron (anonimizadas). */
async function respuestasRecientesDelBot(
  clinicId: string,
  conservar: string[],
  disponible: boolean,
): Promise<RespuestaBotDTO[]> {
  const desde = new Date(Date.now() - DIAS_RESPUESTAS_RECIENTES * DIA_MS);
  const bot = await prisma.inboxMessage.findMany({
    where: {
      thread: { clinicId, channel: "WHATSAPP" },
      direction: "OUT",
      isInternal: false,
      sentById: null,
      sentAt: { gte: desde },
      OR: [{ externalId: null }, { externalId: { startsWith: PREFIJO_RESPUESTA_BOT } }],
    },
    orderBy: { sentAt: "desc" },
    take: 20,
    select: SELECT_MENSAJE,
  });
  if (bot.length === 0) return [];
  const threadIds = Array.from(new Set(bot.map((b) => b.threadId)));
  const masAntiguo = bot[bot.length - 1].sentAt;
  const [entrantes, nombres, valoraciones] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: {
        threadId: { in: threadIds },
        thread: { clinicId },
        direction: "IN",
        isInternal: false,
        sentAt: { gte: new Date(masAntiguo.getTime() - 60 * 60 * 1000) },
      },
      orderBy: { sentAt: "asc" },
      take: 1000,
      select: SELECT_MENSAJE,
    }),
    nombresPorHilo(clinicId, threadIds),
    disponible
      ? prisma.whatsAppBotValoracion.findMany({
          where: { clinicId, messageId: { in: bot.map((b) => b.id) } },
          select: { messageId: true, valor: true, correccion: true },
        })
      : Promise.resolve([] as Array<{ messageId: string; valor: string; correccion: string | null }>),
  ]);
  const porMensaje = new Map(valoraciones.map((v) => [v.messageId, v]));
  return bot.map((b) => {
    const hilo = [...entrantes.filter((m) => m.threadId === b.threadId), ...bot.filter((x) => x.threadId === b.threadId)]
      .map((m) => m as MensajeHilo)
      .sort((x, y) => x.sentAt.getTime() - y.sentAt.getTime());
    const idx = hilo.findIndex((m) => m.id === b.id);
    const previa = idx >= 0 ? preguntaPrevia(hilo, idx).texto : "";
    const opciones = { nombres: nombres.get(b.threadId) ?? [], conservar };
    const v = porMensaje.get(b.id);
    return {
      id: b.id,
      at: b.sentAt.toISOString(),
      pregunta: previa ? (motivoClinico(previa) ? "(pregunta sobre su salud: no se muestra)" : anonimizar(previa, opciones)) : null,
      respuesta: anonimizar(b.body, opciones),
      valor: v ? (v.valor === "mal" ? "mal" : "bien") : null,
      correccion: v?.correccion ?? null,
    };
  });
}

/** Respuestas cortas recientes del equipo, candidatas a «así hablamos». */
async function respuestasRecientesDelEquipo(
  clinicId: string,
  conservar: string[],
  yaMarcados: Set<string>,
): Promise<RespuestaEquipoDTO[]> {
  const desde = new Date(Date.now() - DIAS_ESCANEO * DIA_MS);
  const filas = await prisma.inboxMessage.findMany({
    where: {
      thread: { clinicId, channel: "WHATSAPP" },
      direction: "OUT",
      isInternal: false,
      sentById: { not: null },
      sentAt: { gte: desde },
    },
    orderBy: { sentAt: "desc" },
    take: 40,
    select: SELECT_MENSAJE,
  });
  const candidatas = filas.filter((f) => !yaMarcados.has(f.id) && !f.attachments && f.body.trim().length > 0);
  const nombres = await nombresPorHilo(clinicId, Array.from(new Set(candidatas.map((c) => c.threadId))));
  return candidatas.slice(0, 15).map((f) => {
    const texto = anonimizar(f.body, { nombres: nombres.get(f.threadId) ?? [], conservar });
    return { id: f.id, at: f.sentAt.toISOString(), texto, noApto: motivoTonoNoApto(texto) };
  });
}

/** Todo lo que pinta la pantalla «Aprende de tu equipo». Escanea de paso. */
export async function panelAprende(clinicIdSesion: string): Promise<PanelAprendeDTO> {
  const clinicId = exigirClinica(clinicIdSesion);
  const ahora = Date.now();
  const [disponible, eventos, faqs, conservar] = await Promise.all([
    tablasDisponibles(),
    cargarEventos(clinicId, new Date(ahora - DIAS_ESCANEO * DIA_MS)),
    prisma.whatsAppBotFaq.findMany({
      where: { clinicId, enabled: true },
      select: { id: true, question: true, answer: true, enabled: true, order: true },
    }),
    datosPublicosDeLaClinica(clinicId),
  ]);

  const desdeReporte = new Date(ahora - DIAS_REPORTE * DIA_MS);
  const reporte = armarReporte(
    eventos.filter((e) => e.at >= desdeReporte),
    { yaTieneRespuesta: (p) => !!matchFaq(p, faqs) },
  );

  if (!disponible) {
    return {
      disponible: false,
      reporte,
      sugerencias: [],
      apartadas: {},
      respuestasBot: await respuestasRecientesDelBot(clinicId, conservar, false),
      respuestasEquipo: [],
      ejemplosTono: [],
      maxEjemplosTono: MAX_EJEMPLOS_TONO,
    };
  }

  try {
    await escanearSugerencias(clinicId, eventos);
  } catch (e) {
    // El escaneo es un extra: si falla, la pantalla igual carga lo que ya hay.
    console.error("[bot/aprende] no se pudo escanear:", e);
  }

  const [pendientes, apartadasFilas, ejemplos] = await Promise.all([
    prisma.whatsAppBotSugerencia.findMany({
      where: { clinicId, estado: "pendiente" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, origen: true, pregunta: true, respuesta: true, tema: true, createdAt: true },
    }),
    prisma.whatsAppBotSugerencia.groupBy({
      by: ["motivoNoApto"],
      where: { clinicId, estado: "no_apto", createdAt: { gte: new Date(ahora - DIAS_ESCANEO * DIA_MS) } },
      _count: { _all: true },
    }),
    prisma.whatsAppBotEjemploTono.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, texto: true, fuenteId: true, activo: true, createdAt: true },
    }),
  ]);
  const [respuestasBot, respuestasEquipo] = await Promise.all([
    respuestasRecientesDelBot(clinicId, conservar, true),
    respuestasRecientesDelEquipo(clinicId, conservar, new Set(ejemplos.filter((e) => e.activo).map((e) => e.fuenteId))),
  ]);

  const apartadas: Partial<Record<MotivoNoApto, number>> = {};
  for (const a of apartadasFilas) {
    if (a.motivoNoApto) apartadas[a.motivoNoApto as MotivoNoApto] = a._count._all;
  }

  return {
    disponible: true,
    reporte,
    sugerencias: pendientes
      .filter((p) => p.pregunta !== null || p.respuesta !== null)
      .map((p) => ({
        id: p.id,
        origen: p.origen === "correccion" ? "correccion" : "equipo",
        pregunta: p.pregunta ?? "",
        respuesta: p.respuesta ?? "",
        tema: p.tema,
        createdAt: p.createdAt.toISOString(),
      })),
    apartadas,
    respuestasBot,
    respuestasEquipo,
    ejemplosTono: ejemplos
      .filter((e) => e.activo)
      .map((e) => ({ id: e.id, texto: e.texto, createdAt: e.createdAt.toISOString() })),
    maxEjemplosTono: MAX_EJEMPLOS_TONO,
  };
}

// ── Acciones ──────────────────────────────────────────────────────────────────

/** Valida el texto final de una respuesta frecuente (ver `problemaDeTextoDeFaq`). */
export function validarTextoDeFaq(pregunta: string, respuesta: string): void {
  const p = problemaDeTextoDeFaq(pregunta, respuesta);
  if (p) throw new ErrorAprende(p.mensaje, p.code === "faltan_textos" || p.code === "muy_largo" ? 400 : 422, p.code);
}

export async function decidirSugerencia(args: {
  clinicId: string;
  userId: string;
  id: string;
  accion: "aprobar" | "descartar";
  pregunta?: string;
  respuesta?: string;
}): Promise<{ estado: "aprobada" | "descartada"; faqId?: string }> {
  const clinicId = exigirClinica(args.clinicId);
  await exigirTablas();
  const sug = await prisma.whatsAppBotSugerencia.findFirst({
    where: { id: args.id, clinicId },
    select: { id: true, estado: true, pregunta: true, respuesta: true },
  });
  if (!sug) throw new ErrorAprende("Sugerencia no encontrada", 404, "no_encontrada");
  if (sug.estado !== "pendiente") throw new ErrorAprende("Esta sugerencia ya se decidió.", 409, "ya_decidida");

  const ahora = new Date();
  if (args.accion === "descartar") {
    // Descartar también se guarda: el escaneo no la vuelve a proponer.
    await prisma.whatsAppBotSugerencia.updateMany({
      where: { id: sug.id, clinicId, estado: "pendiente" },
      data: { estado: "descartada", decididoPorId: args.userId, decididoAt: ahora },
    });
    return { estado: "descartada" };
  }

  const pregunta = (args.pregunta ?? sug.pregunta ?? "").trim();
  const respuesta = (args.respuesta ?? sug.respuesta ?? "").trim();
  validarTextoDeFaq(pregunta, respuesta);

  const config = await getOrCreateBotConfig(clinicId);
  const faqId = await prisma.$transaction(async (tx) => {
    // Primero se «gana» la sugerencia: si dos personas aprueban a la vez, solo
    // una crea la respuesta frecuente.
    const r = await tx.whatsAppBotSugerencia.updateMany({
      where: { id: sug.id, clinicId, estado: "pendiente" },
      data: { estado: "aprobada", pregunta, respuesta, decididoPorId: args.userId, decididoAt: ahora },
    });
    if (r.count === 0) throw new ErrorAprende("Esta sugerencia ya se decidió.", 409, "ya_decidida");
    const faq = await tx.whatsAppBotFaq.create({
      data: { clinicId, configId: config.id, question: pregunta, answer: respuesta, enabled: true, order: 0 },
      select: { id: true },
    });
    await tx.whatsAppBotSugerencia.updateMany({ where: { id: sug.id, clinicId }, data: { faqId: faq.id } });
    return faq.id;
  });
  return { estado: "aprobada", faqId };
}

/**
 * «Agregar respuesta» desde el reporte: crea la respuesta frecuente con las
 * mismas validaciones que aprobar una sugerencia (nada clínico, sin
 * marcadores). No necesita las tablas nuevas: escribe en whatsapp_bot_faqs.
 */
export async function crearFaqDesdeReporte(args: { clinicId: string; pregunta: string; respuesta: string }): Promise<{ faqId: string }> {
  const clinicId = exigirClinica(args.clinicId);
  const pregunta = (args.pregunta ?? "").trim();
  const respuesta = (args.respuesta ?? "").trim();
  validarTextoDeFaq(pregunta, respuesta);
  const config = await getOrCreateBotConfig(clinicId);
  const faq = await prisma.whatsAppBotFaq.create({
    data: { clinicId, configId: config.id, question: pregunta, answer: respuesta, enabled: true, order: 0 },
    select: { id: true },
  });
  return { faqId: faq.id };
}

/** La respuesta del bot de ESTA clínica (o 404), con lo necesario para valorarla. */
async function mensajeDeLaClinica(clinicId: string, messageId: string) {
  const m = await prisma.inboxMessage.findFirst({
    where: { id: messageId, thread: { clinicId } },
    select: { ...SELECT_MENSAJE, thread: { select: { patient: { select: { firstName: true, lastName: true } } } } },
  });
  if (!m) throw new ErrorAprende("Mensaje no encontrado", 404, "no_encontrado");
  return m;
}

export async function valorarRespuesta(args: {
  clinicId: string;
  userId: string;
  messageId: string;
  valor: "bien" | "mal";
  correccion?: string | null;
}): Promise<{ valor: "bien" | "mal"; sugerencia: "creada" | "actualizada" | "no_apta" | null; aviso: string | null }> {
  const clinicId = exigirClinica(args.clinicId);
  await exigirTablas();
  const m = await mensajeDeLaClinica(clinicId, args.messageId);
  if (!esRespuestaDelBot(m as MensajeHilo)) {
    throw new ErrorAprende("Solo se valoran las respuestas del bot.", 400, "no_es_del_bot");
  }

  const [conservar, previos] = await Promise.all([
    datosPublicosDeLaClinica(clinicId),
    prisma.inboxMessage.findMany({
      where: { threadId: m.threadId, thread: { clinicId }, sentAt: { lte: m.sentAt, gte: new Date(m.sentAt.getTime() - 60 * 60 * 1000) } },
      orderBy: { sentAt: "asc" },
      take: 30,
      select: SELECT_MENSAJE,
    }),
  ]);
  const opciones: OpcionesAnonimizar = {
    nombres: m.thread.patient ? [m.thread.patient.firstName, m.thread.patient.lastName] : [],
    conservar,
  };
  const hilo = previos as MensajeHilo[];
  const idx = hilo.findIndex((x) => x.id === m.id);
  const preguntaCruda = idx >= 0 ? preguntaPrevia(hilo, idx).texto : "";
  const preguntaClinica = !!preguntaCruda && !!motivoClinico(preguntaCruda);
  const pregunta = preguntaCruda && !preguntaClinica ? anonimizar(preguntaCruda, opciones) : null;

  const correccionCruda = args.valor === "mal" ? (args.correccion ?? "").trim().slice(0, TEXTO_MAX_CARACTERES) : "";
  const correccionClinica = !!correccionCruda && !!motivoClinico(correccionCruda);
  // Una corrección con datos de salud no se guarda en texto (ni anonimizada).
  const correccion = correccionCruda && !correccionClinica ? anonimizar(correccionCruda, opciones) : null;

  await prisma.whatsAppBotValoracion.upsert({
    where: { clinicId_messageId: { clinicId, messageId: m.id } },
    create: { clinicId, messageId: m.id, threadId: m.threadId, valor: args.valor, correccion, pregunta, usuarioId: args.userId },
    update: { valor: args.valor, correccion, pregunta, usuarioId: args.userId },
  });

  if (args.valor !== "mal" || !correccionCruda) return { valor: args.valor, sugerencia: null, aviso: null };

  // 👎 con «así debió ser» → sugerencia (la clínica la aprueba después).
  const fuenteId = `mal:${m.id}`;
  const noApta = preguntaClinica || correccionClinica;
  const datos = noApta
    ? { estado: "no_apto", motivoNoApto: "clinico", tema: "clinico", pregunta: null, respuesta: null }
    : { estado: "pendiente", motivoNoApto: null, tema: pregunta ? temaDePregunta(pregunta) : null, pregunta, respuesta: correccion };
  const existente = await prisma.whatsAppBotSugerencia.findFirst({
    where: { clinicId, fuenteId },
    select: { id: true, estado: true },
  });
  if (!existente) {
    await prisma.whatsAppBotSugerencia.create({
      data: { clinicId, origen: "correccion", threadId: m.threadId, fuenteId, ...datos },
    });
  } else if (existente.estado === "pendiente" || existente.estado === "no_apto") {
    await prisma.whatsAppBotSugerencia.updateMany({ where: { id: existente.id, clinicId }, data: datos });
  }
  if (noApta) {
    return {
      valor: args.valor,
      sugerencia: "no_apta",
      aviso: "Guardamos tu 👎, pero la corrección habla de la salud del paciente: no se convierte en respuesta automática.",
    };
  }
  return { valor: args.valor, sugerencia: existente ? "actualizada" : "creada", aviso: null };
}

export async function marcarEjemploDeTono(args: {
  clinicId: string;
  userId: string;
  messageId: string;
}): Promise<EjemploTonoDTO> {
  const clinicId = exigirClinica(args.clinicId);
  await exigirTablas();
  const m = await mensajeDeLaClinica(clinicId, args.messageId);
  if (!esDelEquipo(m as MensajeHilo)) {
    throw new ErrorAprende("Solo se marcan respuestas escritas por el equipo.", 400, "no_es_del_equipo");
  }
  const conservar = await datosPublicosDeLaClinica(clinicId);
  const texto = anonimizar(m.body, {
    nombres: m.thread.patient ? [m.thread.patient.firstName, m.thread.patient.lastName] : [],
    conservar,
  });
  const motivo = motivoTonoNoApto(texto);
  if (motivo) {
    const msg: Record<MotivoTonoNoApto, string> = {
      clinico: "Este mensaje habla de la salud de un paciente: no sirve como ejemplo.",
      personal: "Este mensaje es sobre el caso de un paciente: elige uno que sirva para cualquiera.",
      corto: "Este mensaje es muy corto para mostrar cómo hablan.",
      largo: "Este mensaje es muy largo: elige uno corto.",
    };
    throw new ErrorAprende(msg[motivo], 422, `tono_${motivo}`);
  }
  const activos = await prisma.whatsAppBotEjemploTono.count({ where: { clinicId, activo: true, NOT: { fuenteId: m.id } } });
  if (activos >= MAX_EJEMPLOS_TONO) {
    throw new ErrorAprende(`Ya tienes ${MAX_EJEMPLOS_TONO} ejemplos. Quita uno para agregar otro.`, 409, "tope_tono");
  }
  const fila = await prisma.whatsAppBotEjemploTono.upsert({
    where: { clinicId_fuenteId: { clinicId, fuenteId: m.id } },
    create: { clinicId, fuenteId: m.id, texto, activo: true, creadoPorId: args.userId },
    update: { texto, activo: true, creadoPorId: args.userId },
    select: { id: true, texto: true, createdAt: true },
  });
  return { id: fila.id, texto: fila.texto, createdAt: fila.createdAt.toISOString() };
}

/** Quitar un ejemplo: se desactiva (no se borra). */
export async function quitarEjemploDeTono(args: { clinicId: string; id: string }): Promise<void> {
  const clinicId = exigirClinica(args.clinicId);
  await exigirTablas();
  const r = await prisma.whatsAppBotEjemploTono.updateMany({ where: { id: args.id, clinicId }, data: { activo: false } });
  if (r.count === 0) throw new ErrorAprende("Ejemplo no encontrado", 404, "no_encontrado");
}

export { bloqueDeTonoDeLaClinica, ErrorAprende };
