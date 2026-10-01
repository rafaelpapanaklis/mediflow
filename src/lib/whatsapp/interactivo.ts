// Mensajes INTERACTIVOS de WhatsApp (botones de respuesta y listas) y las
// respuestas del paciente a ellos. ws1-t3 — Rafael aprobó que el paciente toque
// en vez de escribir: un «no» escrito dentro de una frase ya canceló citas.
//
// PURO: sin Prisma, sin red y sin React. Lo usan el webhook (entrada y salida),
// la cola de recordatorios, el motor del bot y los tests.
//
// Formato y límites COPIADOS de la documentación oficial de la Cloud API
// (consultada el 1-oct-2026), no adivinados:
//   · Botones de respuesta (interactive.type "button"): máx. 3 botones; título
//     del botón 20 caracteres; id 256; cuerpo 1024.
//     developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
//   · Lista (interactive.type "list"): máx. 10 filas EN TOTAL entre todas las
//     secciones; título de fila 24; descripción 72; id de fila 200; texto del
//     botón que abre la lista 20; título de sección 24; cuerpo 4096.
//     developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
//   · Lo que llega al webhook: `type:"interactive"` con
//     `interactive.button_reply {id,title}` o `interactive.list_reply
//     {id,title,description}`, y `context.id` = wamid del mensaje que tenía los
//     botones. Un botón de respuesta rápida de PLANTILLA llega distinto:
//     `type:"button"` con `button {payload,text}` (y también `context.id`).
//   · Plantillas: hasta 3 botones QUICK_REPLY en las de respuesta rápida
//     (10 en total por plantilla); texto del botón 25 caracteres; al enviar, el
//     payload va en un componente `{type:"button", sub_type:"quick_reply",
//     index:"0", parameters:[{type:"payload", payload}]}` por botón.
//
// Fuera de la ventana de 24 h NO se puede mandar nada de esto: solo plantillas.

export const WA_LIMITES = {
  BOTONES_MAX: 3,
  BOTON_TITULO: 20,
  BOTON_ID: 256,
  BOTONES_CUERPO: 1024,
  LISTA_FILAS_MAX: 10,
  FILA_TITULO: 24,
  FILA_DESCRIPCION: 72,
  FILA_ID: 200,
  LISTA_BOTON: 20,
  LISTA_CUERPO: 4096,
  PLANTILLA_BOTON_TEXTO: 25,
} as const;

export interface OpcionInteractiva {
  /** Lo que vuelve en el webhook. Debe ser único dentro del mensaje. */
  id: string;
  /** Lo que ve el paciente en el botón o en la fila. */
  titulo: string;
  /** Solo listas: segunda línea gris de la fila. */
  descripcion?: string;
}

/**
 * Lo que el motor (o un caller) pide además del texto. El TEXTO completo sigue
 * viajando aparte (`reply`): es el cuerpo del mensaje, lo que se guarda en la
 * bandeja y el respaldo si el interactivo no se puede mandar.
 */
export type MensajeInteractivo =
  | { tipo: "botones"; botones: OpcionInteractiva[] }
  | { tipo: "lista"; boton: string; filas: OpcionInteractiva[] };

/** Corta a `max` caracteres (por puntos de código, no parte un emoji) con «…». */
export function recortar(texto: string, max: number): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(limpio);
  if (chars.length <= max) return limpio;
  return chars.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

function largo(s: string): number {
  return Array.from(s).length;
}

/**
 * Elige botones (≤3) o lista (≤10) para unas opciones. Con más de 10 opciones
 * devuelve null: el paciente sigue eligiendo por número, como siempre (una
 * lista que esconde opciones haría creer que no existen).
 */
export function interactivoParaOpciones(
  opciones: OpcionInteractiva[],
  botonLista = "Ver opciones",
): MensajeInteractivo | null {
  if (opciones.length === 0 || opciones.length > WA_LIMITES.LISTA_FILAS_MAX) return null;
  if (opciones.length <= WA_LIMITES.BOTONES_MAX && opciones.every((o) => largo(o.titulo.trim()) <= WA_LIMITES.BOTON_TITULO)) {
    return { tipo: "botones", botones: opciones.map((o) => ({ id: o.id, titulo: o.titulo })) };
  }
  return { tipo: "lista", boton: botonLista, filas: opciones };
}

/**
 * El cuerpo `interactive` de la Graph API, ya dentro de los límites de Meta, o
 * null si no se puede armar uno válido (sin opciones, ids repetidos o
 * demasiado largos, cuerpo vacío o que no cabe). Null = mandar texto normal.
 *
 * Los títulos se recortan con «…» (en una lista el título completo pasa a la
 * descripción si cabe); los ids NO se recortan: un id cortado ya no
 * identificaría nada, así que con uno de más se cae a texto.
 */
export function construirInteractivo(cuerpo: string, m: MensajeInteractivo): Record<string, unknown> | null {
  const body = (cuerpo ?? "").trim();
  if (!body) return null;

  if (m.tipo === "botones") {
    const botones = m.botones;
    if (botones.length === 0 || botones.length > WA_LIMITES.BOTONES_MAX) return null;
    if (largo(body) > WA_LIMITES.BOTONES_CUERPO) return null;
    if (!idsValidos(botones, WA_LIMITES.BOTON_ID)) return null;
    const titulos = botones.map((b) => recortar(b.titulo, WA_LIMITES.BOTON_TITULO));
    // Meta rechaza dos botones con el mismo título.
    if (new Set(titulos).size !== titulos.length || titulos.some((t) => !t)) return null;
    return {
      type: "button",
      body: { text: body },
      action: {
        buttons: botones.map((b, i) => ({ type: "reply", reply: { id: b.id, title: titulos[i] } })),
      },
    };
  }

  const filas = m.filas;
  if (filas.length === 0 || filas.length > WA_LIMITES.LISTA_FILAS_MAX) return null;
  if (largo(body) > WA_LIMITES.LISTA_CUERPO) return null;
  if (!idsValidos(filas, WA_LIMITES.FILA_ID)) return null;
  const rows = filas.map((f) => {
    const completo = f.titulo.replace(/\s+/g, " ").trim();
    const titulo = recortar(completo, WA_LIMITES.FILA_TITULO);
    // Si el título no cupo, el texto entero va en la descripción.
    const desc = f.descripcion?.trim() || (titulo !== completo ? completo : "");
    return {
      id: f.id,
      title: titulo,
      ...(desc ? { description: recortar(desc, WA_LIMITES.FILA_DESCRIPCION) } : {}),
    };
  });
  if (rows.some((r) => !r.title)) return null;
  return {
    type: "list",
    body: { text: body },
    action: {
      button: recortar(m.boton || "Ver opciones", WA_LIMITES.LISTA_BOTON),
      sections: [{ rows }],
    },
  };
}

function idsValidos(ops: OpcionInteractiva[], max: number): boolean {
  const ids = ops.map((o) => o.id);
  if (ids.some((id) => !id || id.length > max)) return false;
  return new Set(ids).size === ids.length;
}

/**
 * Una línea para la bandeja con lo que se le ofreció al paciente, debajo del
 * texto: «🔘 Opciones: ✅ Sí · ❌ No». Con una lista, los títulos de las filas.
 */
export function lineaDeOpciones(m: MensajeInteractivo): string {
  const ops = m.tipo === "botones" ? m.botones : m.filas;
  return `🔘 Opciones: ${ops.map((o) => o.titulo).join(" · ")}`;
}

// ── Entrada ────────────────────────────────────────────────────────────────

export type OrigenEleccion = "boton" | "lista" | "plantilla";

/** Lo que tocó el paciente, tal como lo entregó Meta. */
export interface EleccionEntrante {
  /** id del botón / fila, o el payload del botón de plantilla. */
  id: string;
  /** Lo que decía el botón o la fila. */
  titulo: string;
  origen: OrigenEleccion;
  /** wamid del mensaje que tenía los botones (null si Meta no lo mandó). */
  contextoId: string | null;
}

/**
 * Lee un toque de botón o de lista de un mensaje entrante del webhook. null si
 * el mensaje no es eso (texto, audio…). Un `button` de plantilla sin payload
 * usa su texto como id: así sigue llegando aunque la plantilla no tenga
 * payloads (las aprobadas con botones fijos los mandan igual).
 */
export function leerEleccion(msg: any): EleccionEntrante | null {
  if (!msg || typeof msg !== "object") return null;
  const contextoId = typeof msg.context?.id === "string" && msg.context.id ? msg.context.id : null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (msg.type === "interactive") {
    const br = msg.interactive?.button_reply;
    if (br && str(br.id)) return { id: str(br.id), titulo: str(br.title) || str(br.id), origen: "boton", contextoId };
    const lr = msg.interactive?.list_reply;
    if (lr && str(lr.id)) return { id: str(lr.id), titulo: str(lr.title) || str(lr.id), origen: "lista", contextoId };
    return null;
  }
  if (msg.type === "button") {
    const payload = str(msg.button?.payload);
    const texto = str(msg.button?.text);
    if (!payload && !texto) return null;
    return { id: payload || texto, titulo: texto || payload, origen: "plantilla", contextoId };
  }
  return null;
}

/** Lo que se guarda en la bandeja para que el equipo vea QUÉ tocó el paciente. */
export function textoBandejaDeEleccion(e: EleccionEntrante): string {
  return e.origen === "lista" ? `🔘 Eligió de la lista: «${e.titulo}»` : `🔘 Tocó el botón «${e.titulo}»`;
}

// ── Recordatorios ──────────────────────────────────────────────────────────

/**
 * Prefijos de los botones del recordatorio (y de los payloads de la plantilla
 * con botones). El id completo lleva el id del RECORDATORIO —
 * `rec.cancelar:<whatsAppReminder.id>`—: el toque dice exactamente qué cita
 * confirmar o cancelar, aunque el teléfono lo compartan varios pacientes con
 * citas por confirmar, y un botón de un recordatorio ya atendido no puede
 * actuar sobre OTRO recordatorio pendiente.
 */
export const REC_BOTON = {
  CONFIRMAR: "rec.confirmar",
  REAGENDAR: "rec.reagendar",
  CANCELAR: "rec.cancelar",
} as const;

export function botonesRecordatorio(reminderId: string): OpcionInteractiva[] {
  return [
    { id: `${REC_BOTON.CONFIRMAR}:${reminderId}`, titulo: "✅ Confirmar" },
    { id: `${REC_BOTON.REAGENDAR}:${reminderId}`, titulo: "🔁 Reagendar" },
    { id: `${REC_BOTON.CANCELAR}:${reminderId}`, titulo: "❌ Cancelar" },
  ];
}

export type AccionDeBotonRecordatorio = "confirm" | "cancel" | "reschedule";

/**
 * La acción EXACTA de un toque sobre un recordatorio, sin analizar texto, y de
 * qué recordatorio (null si el botón no lo dice). Acepta los ids propios y,
 * para una plantilla aprobada con botones cuyos payloads no controlamos, el
 * texto exacto del botón («Confirmar», «Cancelar», «Reagendar», con o sin
 * emoji). Cualquier otra cosa → null.
 */
export function accionDeBotonRecordatorio(
  e: EleccionEntrante | null,
): { accion: AccionDeBotonRecordatorio; reminderId: string | null } | null {
  if (!e) return null;
  const m = /^(rec\.(?:confirmar|reagendar|cancelar))(?::(.+))?$/.exec(e.id);
  if (m) {
    const accion: AccionDeBotonRecordatorio =
      m[1] === REC_BOTON.CONFIRMAR ? "confirm" : m[1] === REC_BOTON.CANCELAR ? "cancel" : "reschedule";
    return { accion, reminderId: m[2] ?? null };
  }
  if (e.origen !== "plantilla") return null;
  const t = e.titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
  if (t === "confirmar" || t === "confirmo") return { accion: "confirm", reminderId: null };
  if (t === "cancelar") return { accion: "cancel", reminderId: null };
  if (t === "reagendar" || t === "cambiar fecha" || t === "cambiar cita") return { accion: "reschedule", reminderId: null };
  return null;
}

/**
 * PROPUESTA de plantilla de recordatorio CON botones de respuesta rápida. NO
 * está en el catálogo que se crea solo (`WA_TEMPLATE_CATALOG`): cambiar la de
 * todas las clínicas pide una aprobación nueva de Meta en cada WABA. Rafael la
 * da de alta cuando quiera (ver REPORTE ws1-t3) y, en cuanto una clínica la
 * tenga registrada como su plantilla de recordatorio con este nombre, la cola
 * le manda los payloads de los tres botones sin tocar nada más.
 *
 * Mismo cuerpo y mismas 5 variables que `dc_recordatorio_cita` (el orden de
 * `templateParams` de la cola no cambia), con la última frase adaptada.
 */
export const PLANTILLA_RECORDATORIO_CON_BOTONES = {
  name: "dc_recordatorio_cita_botones",
  category: "UTILITY" as const,
  lang: "es_MX",
  body:
    "Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}} con {{5}}. " +
    "Toca un botón para confirmar, cambiarla o cancelarla.",
  sample: ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00", "Dra. Ana Ruiz"],
  /** Texto de cada botón QUICK_REPLY (≤ 25) y su payload, en orden de índice. */
  botones: [
    { texto: "✅ Confirmar", payload: REC_BOTON.CONFIRMAR },
    { texto: "🔁 Reagendar", payload: REC_BOTON.REAGENDAR },
    { texto: "❌ Cancelar", payload: REC_BOTON.CANCELAR },
  ],
};

/** Alta en Meta (`POST /{waba}/message_templates`) de la plantilla propuesta. */
export function payloadAltaPlantillaConBotones() {
  const p = PLANTILLA_RECORDATORIO_CON_BOTONES;
  return {
    name: p.name,
    language: p.lang,
    category: p.category,
    components: [
      { type: "BODY", text: p.body, example: { body_text: [p.sample] } },
      { type: "BUTTONS", buttons: p.botones.map((b) => ({ type: "QUICK_REPLY", text: b.texto })) },
    ],
  };
}

/**
 * ¿Esta plantilla trae botones de respuesta rápida que hay que rellenar? Solo
 * la propuesta con botones; cualquier otra (la actual `dc_recordatorio_cita`
 * incluida) sale exactamente como hoy.
 */
export function plantillaTieneBotones(nombre: string | null | undefined): boolean {
  return (nombre ?? "").trim().toLowerCase() === PLANTILLA_RECORDATORIO_CON_BOTONES.name;
}

/**
 * Payloads de los botones de la plantilla, en orden de índice. Con los botones
 * del recordatorio concreto (los tres, con su id) van esos; si no, los
 * genéricos de la plantilla. [] si la plantilla no tiene botones.
 */
export function payloadsDeBotonesDePlantilla(
  nombre: string | null | undefined,
  interactivo?: MensajeInteractivo | null,
): string[] {
  if (!plantillaTieneBotones(nombre)) return [];
  const genericos = PLANTILLA_RECORDATORIO_CON_BOTONES.botones.map((b) => b.payload);
  if (interactivo?.tipo === "botones" && interactivo.botones.length === genericos.length) {
    const ids = interactivo.botones.map((b) => b.id);
    // Mismo orden que la plantilla aprobada: Confirmar, Reagendar, Cancelar.
    if (ids.every((id, i) => id === genericos[i] || id.startsWith(`${genericos[i]}:`))) return ids;
  }
  return genericos;
}

/** Componentes `button`/`quick_reply` para el envío de una plantilla. */
export function componentesDeRespuestaRapida(payloads: string[]): Array<Record<string, unknown>> {
  return payloads.map((payload, i) => ({
    type: "button",
    sub_type: "quick_reply",
    index: String(i),
    parameters: [{ type: "payload", payload }],
  }));
}
