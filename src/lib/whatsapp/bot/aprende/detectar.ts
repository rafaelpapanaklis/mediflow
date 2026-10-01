/**
 * Detección de «el bot no supo → alguien del equipo contestó» (ws1-t11).
 *
 * PURO: recibe los mensajes de UN hilo en orden cronológico (lo que ya guarda
 * el Inbox) y devuelve los eventos. No hay IA ni consultas aquí; el servicio
 * trae los mensajes y decide qué guardar.
 *
 * Qué cuenta como «no supo» (disparador):
 *  - la nota interna que deja el handoff del bot (bot/handoff.ts, ws1-t5):
 *    «🙋 El bot pasó esta conversación a una persona…»;
 *  - una respuesta del bot que lo admite («te comunico con el equipo», «no
 *    tengo esa información»…), por si la nota no se pudo guardar o el hilo es
 *    de antes del handoff con nota.
 */
import { SYSTEM_EXTERNAL_ID_PREFIX } from "@/lib/whatsapp/system-message";

/**
 * `sys:bot:<wamid>`: así guarda el webhook las respuestas del bot desde ws1-t3
 * (#7, `BOT_REPLY_EXTERNAL_ID_PREFIX` de system-message.ts). Se repite aquí
 * para no depender de ese cambio; un test comprueba que sean iguales.
 */
export const PREFIJO_RESPUESTA_BOT = `${SYSTEM_EXTERNAL_ID_PREFIX}bot:`;

export type MensajeHilo = {
  id: string;
  threadId: string;
  direction: string; // "IN" | "OUT"
  body: string;
  sentAt: Date;
  sentById: string | null;
  externalId: string | null;
  isInternal: boolean;
  /** Foto, audio, documento… no son una pregunta escrita. */
  attachments?: unknown;
};

/** Lo mínimo para saber quién escribió un mensaje (lo usa también el Inbox). */
export type QuienEscribe = Pick<MensajeHilo, "direction" | "isInternal" | "sentById" | "externalId">;

/**
 * Inicio de `HANDOFF_NOTA_INTERNA` (bot/handoff.ts). Se compara por prefijo y
 * sin importar handoff.ts para que este módulo siga siendo puro; un test
 * comprueba que la nota real empiece así.
 */
export const PREFIJO_NOTA_HANDOFF = "🙋 El bot pasó esta conversación a una persona";

/** Frases con que el bot admite que no sabe o que pasa a una persona. */
const BOT_NO_SUPO: RegExp[] = [
  /te comunico con (el|alguien del|una persona del) equipo/,
  /no (tengo|cuento con) (esa|la|esta) informacion/,
  /no (estoy seguro|lo se|se la respuesta|puedo responder|puedo ayudarte con eso)/,
  /(una persona|alguien) del equipo te (escribe|contesta|responde|atiende)/,
  /en breve te (responden|contestan|escriben)/,
];

const VENTANA_PREGUNTA_MS = 30 * 60 * 1000;
const VENTANA_RESPUESTA_MS = 48 * 60 * 60 * 1000;
const PEGADOS_MS = 10 * 60 * 1000;
/** El aviso al paciente y la nota interna de un mismo handoff salen juntos. */
const MISMO_EVENTO_MS = 5 * 60 * 1000;
const MAX_PIEZAS = 3;

function sinAcentos(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function tieneAdjuntos(m: MensajeHilo): boolean {
  return m.attachments !== undefined && m.attachments !== null;
}

/** Respuesta automática del bot: OUT sin persona, `sys:bot:` o (antes de ws1-t3 #7) sin externalId. */
export function esRespuestaDelBot(m: QuienEscribe): boolean {
  if (m.direction !== "OUT" || m.isInternal || m.sentById) return false;
  return m.externalId === null || m.externalId.startsWith(PREFIJO_RESPUESTA_BOT);
}

/**
 * Persona del equipo contestando al paciente: con usuario del panel o eco del
 * celular de la clínica (wamid crudo). Mismo criterio que
 * `esRespuestaDelEquipo` de bot/handoff.ts.
 */
export function esDelEquipo(m: QuienEscribe): boolean {
  if (m.direction !== "OUT" || m.isInternal) return false;
  if (m.sentById) return true;
  return !!m.externalId && !m.externalId.startsWith(SYSTEM_EXTERNAL_ID_PREFIX);
}

export function esPreguntaDelPaciente(m: MensajeHilo): boolean {
  return m.direction === "IN" && !m.isInternal && !tieneAdjuntos(m) && m.body.trim().length > 0;
}

export function esDisparador(m: MensajeHilo): boolean {
  if (m.isInternal) return m.body.startsWith(PREFIJO_NOTA_HANDOFF);
  if (!esRespuestaDelBot(m)) return false;
  const t = sinAcentos(m.body);
  return BOT_NO_SUPO.some((re) => re.test(t));
}

/**
 * Lo que el paciente preguntó justo antes de `indice`: sus mensajes de texto
 * desde la última respuesta (del bot o de una persona), hasta 3 y de la última
 * media hora. Las notas internas se saltan.
 */
export function preguntaPrevia(mensajes: MensajeHilo[], indice: number): { ids: string[]; texto: string } {
  const ref = mensajes[indice];
  const piezas: MensajeHilo[] = [];
  for (let j = indice - 1; j >= 0 && piezas.length < MAX_PIEZAS; j--) {
    const m = mensajes[j];
    if (m.isInternal) continue;
    if (ref.sentAt.getTime() - m.sentAt.getTime() > VENTANA_PREGUNTA_MS) break;
    if (m.direction === "OUT") {
      // La respuesta del bot que es parte de ESTE mismo «no supe» no corta.
      if (esDisparador(m) && ref.sentAt.getTime() - m.sentAt.getTime() <= MISMO_EVENTO_MS) continue;
      break;
    }
    if (esPreguntaDelPaciente(m)) piezas.unshift(m);
  }
  return { ids: piezas.map((m) => m.id), texto: piezas.map((m) => m.body.trim()).join("\n") };
}

/**
 * Lo que contestó el equipo después de `indice`: su primer mensaje y los que
 * mandó pegados (sin que el paciente escriba en medio), hasta 3, dentro de 48 h.
 */
export function respuestaPosterior(mensajes: MensajeHilo[], indice: number): { ids: string[]; texto: string } | null {
  const ref = mensajes[indice];
  const piezas: MensajeHilo[] = [];
  for (let j = indice + 1; j < mensajes.length; j++) {
    const m = mensajes[j];
    if (m.sentAt.getTime() - ref.sentAt.getTime() > VENTANA_RESPUESTA_MS) break;
    if (m.isInternal) continue;
    if (piezas.length === 0) {
      if (esDisparador(m) && m.sentAt.getTime() - ref.sentAt.getTime() > MISMO_EVENTO_MS) break; // otro «no supe»
      if (esDelEquipo(m) && !tieneAdjuntos(m) && m.body.trim()) piezas.push(m);
      continue;
    }
    const ultima = piezas[piezas.length - 1];
    if (!esDelEquipo(m) || tieneAdjuntos(m) || m.sentAt.getTime() - ultima.sentAt.getTime() > PEGADOS_MS) break;
    if (m.body.trim()) piezas.push(m);
    if (piezas.length >= MAX_PIEZAS) break;
  }
  if (piezas.length === 0) return null;
  return { ids: piezas.map((m) => m.id), texto: piezas.map((m) => m.body.trim()).join("\n") };
}

export type EventoNoSupo = {
  /** Id del mensaje que lo disparó (nota de handoff o respuesta del bot). Llave de idempotencia. */
  disparadorId: string;
  threadId: string;
  at: Date;
  preguntaIds: string[];
  /** Texto CRUDO: el servicio lo anonimiza antes de guardarlo o mostrarlo. */
  pregunta: string;
  respuestaIds: string[];
  respuesta: string | null;
};

/** Eventos de un hilo. `mensajes` en orden cronológico y todos del mismo hilo. */
export function detectarEventos(mensajes: MensajeHilo[]): EventoNoSupo[] {
  const eventos: EventoNoSupo[] = [];
  let ultimo: EventoNoSupo | null = null;
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    if (!esDisparador(m)) continue;
    // El aviso del bot y la nota interna del mismo handoff: un solo evento.
    if (ultimo && m.sentAt.getTime() - ultimo.at.getTime() <= MISMO_EVENTO_MS) {
      const hubo = mensajes.slice(0, i).some((x) => esPreguntaDelPaciente(x) && x.sentAt > ultimo!.at);
      if (!hubo) continue;
    }
    const pregunta = preguntaPrevia(mensajes, i);
    if (!pregunta.texto) continue;
    const respuesta = respuestaPosterior(mensajes, i);
    ultimo = {
      disparadorId: m.id,
      threadId: m.threadId,
      at: m.sentAt,
      preguntaIds: pregunta.ids,
      pregunta: pregunta.texto,
      respuestaIds: respuesta?.ids ?? [],
      respuesta: respuesta?.texto ?? null,
    };
    eventos.push(ultimo);
  }
  return eventos;
}
