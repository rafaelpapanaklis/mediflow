/**
 * DaleControl INSTITUCIONAL — WhatsApp: TODO lo que se puede decidir sin
 * base de datos y sin red.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido: el `now` siempre se pasa). Lo importan el módulo de servidor
 * (src/lib/edu/whatsapp.ts), el cron de recordatorios y las dos pantallas.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS TRES REGLAS QUE VIVEN AQUÍ, Y POR QUÉ AQUÍ
 *
 * 1. LA VENTANA DE 24 h SE CONSIDERA SIEMPRE CERRADA.
 *
 *    Meta deja mandar texto libre durante las 24 h siguientes al último
 *    mensaje DEL PACIENTE. Saberlo exige INGERIR los mensajes que entran
 *    (webhook + bandeja), y este vertical no los ingiere: no hay Inbox del
 *    instituto ni nadie que conteste. La respuesta honesta es la
 *    conservadora — TODO sale por plantilla aprobada, o no sale. Suponer
 *    que está abierta es cómo se llega a un panel que dice "Enviado" sobre
 *    un mensaje que Meta rechazó con 131047.
 *
 * 2. SIN PLANTILLA APROBADA PARA UN TIPO, ESE AVISO NO SE INTENTA.
 *    `eduDecideWaSend` devuelve "blocked" con el motivo EN ESPAÑOL, escrito
 *    para leerse en una pantalla. No se encola para fallar después.
 *
 * 3. LOS PARÁMETROS SON POSICIONALES. Meta sustituye {{1}}…{{n}} por
 *    POSICIÓN, no por nombre: un orden distinto entrega el mensaje con los
 *    datos cambiados de sitio, y un número distinto lo rechaza con 132000.
 *    Por eso la especificación de cada tipo declara sus variables EN ORDEN
 *    y el envío se bloquea antes si no cuadran.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduWhatsappKind, EduWhatsappStatus } from "@prisma/client";

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS TIPOS DE MENSAJE
// ═══════════════════════════════════════════════════════════════════════

export const EDU_WA_KINDS: EduWhatsappKind[] = ["RECORDATORIO", "CONSENTIMIENTO", "RECIBO"];

export const EDU_WA_KIND_LABELS: Record<EduWhatsappKind, string> = {
  RECORDATORIO: "Recordatorio de cita",
  CONSENTIMIENTO: "Consentimiento para firmar",
  RECIBO: "Recibo de un cobro",
};

export const EDU_WA_KIND_DESCRIPTIONS: Record<EduWhatsappKind, string> = {
  RECORDATORIO:
    "Lo manda solo el sistema, las horas antes que decida el instituto. Nadie lo dispara a mano.",
  CONSENTIMIENTO:
    "La carta de consentimiento informado con su liga para firmarla desde el teléfono del paciente.",
  RECIBO:
    "El resumen del cobro: folio, total y saldo. No lleva expediente ni procedimientos clínicos.",
};

export const EDU_WA_STATUSES: EduWhatsappStatus[] = [
  "PENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
];

export const EDU_WA_STATUS_LABELS: Record<EduWhatsappStatus, string> = {
  PENDING: "En curso",
  SENT: "Entregado a WhatsApp",
  FAILED: "No salió",
  CANCELLED: "Cancelado",
  BLOCKED: "No se intentó",
};

/**
 * ⚠️ "Entregado a WhatsApp" y NO "Entregado", y la diferencia importa: lo
 * que sabemos es que Meta lo ACEPTÓ, no que el teléfono lo recibió. Saber
 * lo segundo exige los acuses del webhook, que este vertical no ingiere.
 * Decir "entregado" sin ellos es el fallo mudo de siempre.
 */
export const EDU_WA_STATUS_DETAILS: Record<EduWhatsappStatus, string> = {
  PENDING: "Se escribió la constancia y todavía no hay respuesta de WhatsApp.",
  SENT: "WhatsApp lo aceptó. No sabemos si el teléfono ya lo abrió: para eso harían falta los acuses de entrega, que este panel todavía no recibe.",
  FAILED: "WhatsApp lo rechazó. El motivo está abajo, tal como lo dijo Meta.",
  CANCELLED: "Se canceló antes de salir, porque la cita se movió o se cerró.",
  BLOCKED: "No se intentó siquiera, y el motivo está abajo. Un intento que se sabe rechazado gasta la llamada y no entrega nada.",
};

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL CATÁLOGO DE PLANTILLAS
//
// El TEXTO lo fija DaleControl, no la escuela: los valores viajan por
// posición, así que una plantilla con otro número de variables o en otro
// orden entrega el mensaje mal. La escuela solo registra el NOMBRE con el
// que Meta se la aprobó y en qué idioma.
//
// ⚠️ Reglas de Meta que estos cuerpos respetan y que cuesta caro descubrir
// tarde: el cuerpo NO puede empezar ni terminar con una variable, y no
// puede haber dos variables pegadas. Un cuerpo que las incumple se rechaza
// en la revisión, días después de haberlo mandado.
// ═══════════════════════════════════════════════════════════════════════

export interface EduWaTemplateSpec {
  kind: EduWhatsappKind;
  /** Nombre SUGERIDO. La escuela puede registrar otro: manda el registrado. */
  suggestedName: string;
  /** Categoría de Meta con la que hay que darla de alta. */
  category: "UTILITY";
  /** El cuerpo EXACTO que hay que dar de alta en Meta. */
  body: string;
  /** Qué es cada {{n}}, EN ORDEN. La longitud es el contrato. */
  variableKeys: string[];
  /** Ejemplo con el que Meta pide que se dé de alta la plantilla. */
  sample: string[];
}

export const EDU_WA_TEMPLATES: readonly EduWaTemplateSpec[] = [
  {
    kind: "RECORDATORIO",
    suggestedName: "edu_recordatorio_cita",
    category: "UTILITY",
    body:
      "Hola {{1}}, le recordamos su cita en {{2}} el {{3}} a las {{4}}. " +
      "Si no puede asistir, avísenos respondiendo a este mensaje. Gracias.",
    variableKeys: ["paciente", "instituto", "fecha", "hora"],
    sample: ["María", "Instituto de Especialidades Odontológicas", "lunes 14 de septiembre de 2026", "09:30"],
  },
  {
    kind: "CONSENTIMIENTO",
    suggestedName: "edu_consentimiento_firma",
    category: "UTILITY",
    body:
      "Hola {{1}}, {{2}} le comparte la carta de consentimiento informado de {{3}} " +
      "para que la lea y la firme desde su teléfono: {{4}} " +
      "Si tiene dudas, pregúntenos antes de firmar.",
    variableKeys: ["paciente", "instituto", "procedimiento", "liga"],
    sample: [
      "María",
      "Instituto de Especialidades Odontológicas",
      "Endodoncia unirradicular",
      "https://www.dalecontrol.com/instituto/consentimiento/abc123",
    ],
  },
  {
    kind: "RECIBO",
    suggestedName: "edu_recibo_cobro",
    category: "UTILITY",
    body:
      "Hola {{1}}, aquí está su recibo de {{2}}: folio {{3}}, total {{4}}. " +
      "Saldo pendiente: {{5}}. Guárdelo como comprobante y avísenos si algo no cuadra.",
    variableKeys: ["paciente", "instituto", "folio", "total", "saldo"],
    sample: ["María", "Instituto de Especialidades Odontológicas", "C-0042", "$1,200.00", "$0.00"],
  },
];

export function eduWaSpec(kind: EduWhatsappKind): EduWaTemplateSpec | null {
  return EDU_WA_TEMPLATES.find((t) => t.kind === kind) ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LO QUE LA ESCUELA REGISTRA (EduWhatsappConfig.templates)
// ═══════════════════════════════════════════════════════════════════════

export type EduWaTemplateStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface EduWaTemplateConfig {
  /** Nombre EXACTO con el que Meta la aprobó (minúsculas y guiones bajos). */
  name: string;
  /** Código de idioma de Meta: "es_MX", "es", "en_US"… */
  lang: string;
  /**
   * En qué estado la tiene Meta. AUSENTE = aprobada: la escuela solo
   * registra el nombre cuando Meta ya se lo aprobó, y el botón "Revisar en
   * Meta" es el que rellena esto con la verdad.
   */
  status?: EduWaTemplateStatus;
  /** Motivo de Meta cuando la rechaza. */
  reason?: string;
  /** Cuándo se comprobó contra Meta por última vez (ISO). */
  checkedAt?: string;
}

export type EduWaTemplateMap = Partial<Record<EduWhatsappKind, EduWaTemplateConfig>>;

/**
 * Nombre de plantilla de Meta: minúsculas, dígitos y guiones bajos. Se
 * valida ANTES de guardar porque un nombre inválido no se puede enviar y el
 * error de Meta ("132001") no le dice nada a nadie.
 */
export function eduWaTemplateNameIsValid(name: string): boolean {
  return /^[a-z0-9_]{1,80}$/.test(name);
}

/** "es_MX", "es", "en_US". */
export function eduWaTemplateLangIsValid(lang: string): boolean {
  return /^[a-z]{2}(_[A-Z]{2})?$/.test(lang);
}

/**
 * Lee la columna Json y devuelve SOLO lo bien formado.
 *
 * Una entrada corrupta se DESCARTA en vez de intentar enviarse: mandarle a
 * Meta un nombre inválido gasta el intento y devuelve un código que no
 * explica nada. Descartada, el envío se bloquea con "falta la plantilla",
 * que sí se puede arreglar.
 */
export function eduParseWaTemplates(raw: unknown): EduWaTemplateMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: EduWaTemplateMap = {};

  for (const kind of EDU_WA_KINDS) {
    const entry = source[kind];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string" || typeof row.lang !== "string") continue;

    const name = row.name.trim().toLowerCase();
    const lang = row.lang.trim();
    if (!eduWaTemplateNameIsValid(name) || !eduWaTemplateLangIsValid(lang)) continue;

    const cfg: EduWaTemplateConfig = { name, lang };
    if (row.status === "PENDING" || row.status === "APPROVED" || row.status === "REJECTED") {
      cfg.status = row.status;
    }
    if (typeof row.reason === "string" && row.reason.trim() !== "") {
      cfg.reason = row.reason.trim().slice(0, 300);
    }
    if (typeof row.checkedAt === "string" && row.checkedAt.trim() !== "") {
      cfg.checkedAt = row.checkedAt.trim();
    }
    out[kind] = cfg;
  }
  return out;
}

/**
 * Lo que llega del formulario → el mapa que se guarda. Un tipo sin nombre
 * se BORRA del mapa (es como se desregistra una plantilla), y uno con
 * nombre inválido revienta con un mensaje que dice cuál.
 *
 * 🔴 El estado NO se acepta del cliente. Lo pone Meta y lo escribe el botón
 * "Revisar en Meta": si la pantalla pudiera mandar `status: "APPROVED"`,
 * bastaría con un `fetch` a mano para desactivar la única comprobación que
 * evita gastar intentos contra una plantilla rechazada.
 */
export interface EduWaTemplatesSanitized {
  ok: boolean;
  /** Vacío cuando `ok` es false. */
  templates: EduWaTemplateMap;
  /** Null cuando `ok` es true. */
  error: string | null;
}

/**
 * ⚠️ Devuelve UNA sola forma con `ok`, `templates` y `error` en vez de una
 * unión discriminada, y no es por gusto: el tsconfig del repo tiene
 * `strict: false`, y con eso TypeScript NO estrecha una unión por `!res.ok`
 * — el `res.error` del caller sale como error de compilación. Una forma
 * plana no depende del estrechamiento.
 */
export function eduSanitizeWaTemplates(
  raw: unknown,
  previo: EduWaTemplateMap,
): EduWaTemplatesSanitized {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, templates: {}, error: "No mandaste las plantillas." };
  }
  const source = raw as Record<string, unknown>;
  const out: EduWaTemplateMap = {};

  for (const kind of EDU_WA_KINDS) {
    const entry = source[kind];
    if (entry === undefined) {
      // No viene en el cuerpo: se conserva lo que ya había. Guardar una
      // pantalla parcial no puede desregistrar lo que no estaba en ella.
      const anterior = previo[kind];
      if (anterior) out[kind] = anterior;
      continue;
    }
    if (entry === null) continue; // desregistrar a propósito

    const row = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim().toLowerCase() : "";
    const lang = typeof row.lang === "string" && row.lang.trim() ? row.lang.trim() : "es_MX";
    if (name === "") continue; // vacío = desregistrar

    if (!eduWaTemplateNameIsValid(name)) {
      return {
        ok: false,
        templates: {},
        error: `"${name}" no es un nombre de plantilla de Meta. Van en minúsculas, con dígitos y guiones bajos (por ejemplo ${eduWaSpec(kind)?.suggestedName ?? "edu_aviso"}).`,
      };
    }
    if (!eduWaTemplateLangIsValid(lang)) {
      return {
        ok: false,
        templates: {},
        error: `"${lang}" no es un código de idioma de Meta (es_MX, es, en_US).`,
      };
    }

    const anterior = previo[kind];
    const cfg: EduWaTemplateConfig = { name, lang };
    // El estado guardado solo sobrevive si NO cambió el nombre ni el idioma:
    // otra plantilla es otra revisión de Meta, y arrastrar el "APPROVED" de
    // la anterior haría que se intentara enviar una que quizá ni existe.
    if (anterior && anterior.name === name && anterior.lang === lang) {
      if (anterior.status) cfg.status = anterior.status;
      if (anterior.reason) cfg.reason = anterior.reason;
      if (anterior.checkedAt) cfg.checkedAt = anterior.checkedAt;
    }
    out[kind] = cfg;
  }

  return { ok: true, templates: out, error: null };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · ¿SALE O NO SALE?
// ═══════════════════════════════════════════════════════════════════════

export type EduWaSendDecision =
  | { mode: "template"; template: EduWaTemplateConfig; params: string[]; body: string }
  /** No se puede enviar. `reason` va tal cual a la pantalla y a la fila. */
  | { mode: "blocked"; reason: string };

export interface EduWaSendInput {
  kind: EduWhatsappKind;
  templates: EduWaTemplateMap;
  /** Valores de {{1}}…{{n}}, EN EL ORDEN de la especificación del tipo. */
  params: string[];
}

/**
 * Decide si un aviso sale y con qué.
 *
 * NUNCA devuelve "texto libre": ver la regla 1 del encabezado. Y cuando no
 * se puede enviar, devuelve el motivo en español pensado para leerse en el
 * panel, no un código.
 */
export function eduDecideWaSend(input: EduWaSendInput): EduWaSendDecision {
  const spec = eduWaSpec(input.kind);
  if (!spec) {
    return {
      mode: "blocked",
      reason: "Ese tipo de mensaje no tiene plantilla definida en el producto.",
    };
  }

  const template = input.templates[input.kind];
  if (!template) {
    return {
      mode: "blocked",
      reason:
        `Falta registrar la plantilla de "${EDU_WA_KIND_LABELS[input.kind]}". ` +
        "Fuera de la ventana de 24 h WhatsApp solo entrega plantillas aprobadas, " +
        "así que este aviso no se intenta: se configura en Ajustes → WhatsApp.",
    };
  }

  if (template.status === "PENDING") {
    return {
      mode: "blocked",
      reason:
        `Meta todavía no aprueba la plantilla "${template.name}". ` +
        "En cuanto la apruebe, estos avisos salen solos.",
    };
  }
  if (template.status === "REJECTED") {
    const motivo = template.reason ? ` Motivo de Meta: ${template.reason}` : "";
    return {
      mode: "blocked",
      reason: `Meta rechazó la plantilla "${template.name}", así que este aviso no se puede entregar.${motivo}`,
    };
  }

  const params = input.params.map((p) => String(p ?? "").trim());
  if (params.length !== spec.variableKeys.length) {
    return {
      mode: "blocked",
      reason:
        `La plantilla espera ${spec.variableKeys.length} datos y se prepararon ${params.length}. ` +
        "No se envió para no gastar un intento que WhatsApp rechazaría.",
    };
  }
  const vacio = params.findIndex((p) => p === "");
  if (vacio >= 0) {
    return {
      mode: "blocked",
      reason:
        `Falta el dato "${spec.variableKeys[vacio]}" de la plantilla. ` +
        "WhatsApp rechaza las variables vacías, así que no se intentó.",
    };
  }

  return { mode: "template", template, params, body: eduRenderWaBody(spec, params) };
}

/**
 * El texto que la persona LEE, con {{n}} sustituidos. Es lo que se guarda
 * en la constancia: guardar otra cosa sería enseñarle al instituto un
 * mensaje que nadie recibió.
 */
export function eduRenderWaBody(spec: EduWaTemplateSpec, params: string[]): string {
  return spec.body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => {
    const idx = Number(n) - 1;
    return params[idx] ?? match;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL TELÉFONO
// ═══════════════════════════════════════════════════════════════════════

/**
 * A 10 dígitos nacionales, o null.
 *
 * Copia deliberada de mxTenDigits (@/lib/phone-mx): aquélla vive en el
 * dental y este archivo lo importa también el navegador. Las reglas son las
 * mismas — se limpia el +52 / +521 y los separadores, no se rechazan.
 *
 * ⚠️ Un teléfono que no queda en 10 dígitos NO se manda a Meta a ver qué
 * pasa: Meta contesta 131026 ("no se puede entregar") y esa fila roja se lee
 * igual que un problema de la escuela. Se bloquea antes, diciendo la verdad:
 * el teléfono de la ficha no sirve.
 */
export function eduWaPhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const local =
    digits.length === 13 && digits.startsWith("521")
      ? digits.slice(3)
      : digits.length === 12 && digits.startsWith("52")
        ? digits.slice(2)
        : digits;
  return local.length === 10 ? local : null;
}

/** "55 1234 5678" — solo para pintarlo. */
export function eduWaPhoneLabel(raw: string | null | undefined): string {
  const ten = eduWaPhone(raw);
  if (!ten) return String(raw ?? "").trim() || "—";
  return `${ten.slice(0, 2)} ${ten.slice(2, 6)} ${ten.slice(6)}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL RECORDATORIO: CUÁNDO SALE Y CUÁL ES SU LLAVE
// ═══════════════════════════════════════════════════════════════════════

/** Mínimo y máximo de anticipación configurable, en horas. */
export const EDU_REMINDER_MIN_HOURS = 1;
export const EDU_REMINDER_MAX_HOURS = 168; // una semana
export const EDU_REMINDER_DEFAULT_HOURS = 24;

/**
 * Cuánto mira hacia adelante el barrido, en minutos. El cron corre cada 15;
 * con 20 no se salta ninguna cita si un tick llega tarde.
 */
export const EDU_REMINDER_LOOKAHEAD_MIN = 20;

/**
 * Cuánto tolera hacia atrás. Si un cron se cayó dos horas, los
 * recordatorios de esas dos horas SALEN igual — tarde, pero salen: un aviso
 * con veinte minutos de retraso sigue sirviendo, y ninguno no sirve de nada.
 *
 * 🔴 No es infinito a propósito: un recordatorio "de 24 h antes" entregado
 * cuatro horas antes de la cita es una llamada que se paga y un mensaje que
 * confunde. Pasado ese margen, el aviso se marca CANCELLED y no se manda.
 */
export const EDU_REMINDER_GRACE_MIN = 120;

/** Cuántas veces se reintenta un envío que falló antes de dejarlo en paz. */
export const EDU_WA_MAX_ATTEMPTS = 3;

/** Techo de filas que devuelve cualquier listado de envíos. */
export const EDU_WA_MAX_ROWS = 200;

export function eduClampReminderHours(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const entero = Math.trunc(n);
  if (entero < EDU_REMINDER_MIN_HOURS || entero > EDU_REMINDER_MAX_HOURS) return null;
  return entero;
}

/** El instante en que TIENE que salir el recordatorio de esta cita. */
export function eduReminderMoment(startsAt: Date, hoursBefore: number): Date {
  return new Date(startsAt.getTime() - hoursBefore * 60 * 60 * 1000);
}

/**
 * 🔴 LA LLAVE DE IDEMPOTENCIA, Y LLEVA DENTRO LA HORA DE LA CITA.
 *
 * En el dental la llave es cita+momento+canal, SIN la hora, y por eso mover
 * una cita deja una fila que tapa el recordatorio bueno: no es que llegue
 * tarde, es que no llega nunca. Con la hora dentro, mover la cita produce
 * una llave NUEVA y el aviso correcto pasa aunque nadie hubiera cancelado el
 * viejo. La cancelación explícita (recordatorios.ts) sigue existiendo —
 * hacen falta las dos: ésta deja pasar el bueno, aquélla impide que salga el
 * malo.
 *
 * Efecto secundario BUSCADO: mover una cita y devolverla a su hora original
 * recupera la llave vieja, así que un recordatorio ya enviado con esa misma
 * hora no se manda dos veces.
 */
export function eduReminderDedupeKey(
  appointmentId: string,
  hoursBefore: number,
  startsAt: Date,
): string {
  return `${appointmentId}:${hoursBefore}:${startsAt.toISOString()}`;
}

/**
 * Los estados en los que una cita TODAVÍA NO SE HA CERRADO.
 *
 * Son exactamente el complemento de los tres terminales (CANCELLED,
 * NO_SHOW, COMPLETED), y esa simetría es la que cierra el agujero: la
 * agenda cancela el recordatorio al pasar a cualquiera de los tres, y el
 * barrido solo mira estos cuatro. Si las dos listas no fueran
 * complementarias quedaría un estado en el que ni se manda ni se cancela, y
 * la fila se quedaría diciendo "en curso" para siempre.
 */
export const EDU_REMINDER_LIVE_APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "CHECKED_IN",
  "IN_CHAIR",
  "IN_PROGRESS",
] as const;

/**
 * ¿Este envío sigue pendiente de salir?
 *
 *   · PENDING → sí, obviamente.
 *   · FAILED  → sí, mientras queden reintentos. Un 500 de Meta o una
 *     tarjeta que se arregla merecen otra oportunidad; una plantilla
 *     rechazada, no tres mil.
 *   · BLOCKED → SÍ, y es lo menos obvio de esta función. Un bloqueo no es
 *     un fallo: es una condición que puede DEJAR DE SER VERDAD. El motivo
 *     típico es "el teléfono de la ficha no tiene 10 dígitos", y recepción
 *     lo corrige a media mañana. Si BLOCKED fuera terminal, ese paciente
 *     se quedaría sin su recordatorio aunque el dato ya estuviera bien —
 *     y volver a mirarlo no cuesta una llamada a Meta, porque el bloqueo se
 *     decide ANTES de la red.
 *   · SENT y CANCELLED → no. Ya salió, o ya se decidió que no salga.
 */
export function eduWaIsOpenStatus(status: EduWhatsappStatus, attempts: number): boolean {
  if (status === "PENDING" || status === "BLOCKED") return true;
  return status === "FAILED" && attempts < EDU_WA_MAX_ATTEMPTS;
}

// ── Reagendar y cancelar ────────────────────────────────────────────────

export interface EduReminderRow {
  id: string;
  status: EduWhatsappStatus;
  attempts: number;
  dedupeKey: string | null;
}

export interface EduReminderCancelPlan {
  /** Aún no salieron: se cancelan porque llevan la hora vieja dentro. */
  cancelIds: string[];
  /** Ya salieron (o ya se cerraron): NO se tocan, son la constancia. */
  keepIds: string[];
}

/**
 * QUÉ HACER CON LOS RECORDATORIOS DE UNA CITA QUE SE MOVIÓ O SE CERRÓ.
 *
 * 🔴 ES LA MITAD DE LA OLA Y NO SE VE. El texto del recordatorio se pinta al
 * ENCOLAR, con la fecha y la hora congeladas dentro. Si la cita se mueve y su
 * recordatorio sigue en cola, al paciente le llega la hora VIEJA — y viene
 * un día antes, o no viene. En el dental esto es un bug conocido y abierto.
 *
 * Puro a propósito: la decisión se prueba entera sin base de datos
 * (edu-whatsapp.test.ts), y quien escribe es applyEduReminderCancel
 * (src/lib/edu/recordatorios.ts).
 *
 * ⚠️ Un envío SENT no se toca. Ya salió: es historia, y borrarla dejaría al
 * instituto sin poder contestar "¿le avisamos?". Lo que se cancela es lo que
 * todavía no ha salido — incluidos los FAILED que iban a reintentarse, que
 * si no volverían a la cola con la hora vieja.
 */
export function planEduReminderCancel(rows: EduReminderRow[]): EduReminderCancelPlan {
  const cancelIds: string[] = [];
  const keepIds: string[] = [];
  for (const r of rows ?? []) {
    if (r.status === "PENDING" || r.status === "FAILED") cancelIds.push(r.id);
    else keepIds.push(r.id);
  }
  return { cancelIds, keepIds };
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL ESTADO DE LA CONEXIÓN, EN UNA FRASE
// ═══════════════════════════════════════════════════════════════════════

export type EduWaConnState =
  | "SIN_CONECTAR"
  | "CONECTADO"
  | "SIN_METODO_DE_PAGO"
  | "TOKEN_CAIDO";

export interface EduWaConnInput {
  connected: boolean;
  phoneNumberId: string | null;
  hasToken: boolean;
  billingOk: boolean;
  lastErrorCode: number | null;
}

/** Código de Meta: la WABA no tiene método de pago válido. */
export const EDU_WA_BILLING_ERROR_CODE = 131042;
/** Código de Meta: token caducado o revocado. */
export const EDU_WA_TOKEN_ERROR_CODE = 190;

/**
 * El estado de la conexión, decidido en UN sitio.
 *
 * 🔴 "SIN_METODO_DE_PAGO" existe como estado propio y no como una nota al
 * pie: es el problema que más va a pasar y el que peor se lee si se pinta
 * como un fallo genérico. Meta le cobra cada plantilla a la tarjeta de la
 * WABA del instituto; sin tarjeta rechaza con 131042 y el panel no puede
 * hacer nada — solo decirlo con esas palabras para que la escuela vaya a
 * Meta en vez de abrir un ticket contra DaleControl.
 */
export function eduWaConnState(c: EduWaConnInput): EduWaConnState {
  if (!c.phoneNumberId || !c.hasToken) return "SIN_CONECTAR";
  if (!c.connected) return "TOKEN_CAIDO";
  if (c.lastErrorCode === EDU_WA_BILLING_ERROR_CODE && !c.billingOk) return "SIN_METODO_DE_PAGO";
  return "CONECTADO";
}

export const EDU_WA_CONN_LABELS: Record<EduWaConnState, string> = {
  SIN_CONECTAR: "Sin conectar",
  CONECTADO: "Conectado",
  SIN_METODO_DE_PAGO: "Sin método de pago",
  TOKEN_CAIDO: "Se cayó la conexión",
};

export const EDU_WA_CONN_DETAILS: Record<EduWaConnState, string> = {
  SIN_CONECTAR:
    "Este instituto todavía no ha conectado su WhatsApp. Cada escuela conecta la suya: Meta le cobra las plantillas a la tarjeta de esa cuenta y no se puede mandar en nombre de otra.",
  CONECTADO: "El número está conectado y los avisos encendidos pueden salir.",
  SIN_METODO_DE_PAGO:
    "La cuenta de WhatsApp del instituto no tiene un método de pago válido, así que Meta está rechazando los envíos (código 131042). No es un problema del panel y desde aquí no se puede arreglar: hay que agregar la tarjeta en el Administrador comercial de Meta. En cuanto esté, los avisos vuelven a salir solos.",
  TOKEN_CAIDO:
    "Meta dejó de aceptar el token de este instituto (caducó o alguien lo revocó). Hay que volver a conectar el número: mientras tanto no sale ningún aviso, y es mejor así que seguir intentando y creer que salen.",
};

/**
 * Lo que se le pinta a alguien que abre la pantalla: la conexión en una
 * línea + qué avisos NO pueden salir y POR QUÉ. Cada motivo es accionable:
 * "falta la plantilla X", "está apagado", "sin método de pago".
 */
export interface EduWaKindReadiness {
  kind: EduWhatsappKind;
  label: string;
  /** ¿El interruptor de este aviso está encendido? */
  enabled: boolean;
  /** ¿Hay plantilla utilizable? */
  templateOk: boolean;
  templateName: string | null;
  templateStatus: EduWaTemplateStatus | null;
  /** null = este aviso puede salir. */
  problem: string | null;
}

export function eduWaReadiness(args: {
  conn: EduWaConnState;
  templates: EduWaTemplateMap;
  enabled: Record<EduWhatsappKind, boolean>;
}): EduWaKindReadiness[] {
  return EDU_WA_KINDS.map((kind) => {
    const tpl = args.templates[kind] ?? null;
    const decision = eduDecideWaSend({
      kind,
      templates: args.templates,
      // Se pasan tantos huecos como variables tenga la plantilla: aquí se
      // pregunta por la CONFIGURACIÓN, no por un envío concreto, y los
      // valores reales solo existen en el momento de mandar.
      params: (eduWaSpec(kind)?.variableKeys ?? []).map((k) => k),
    });
    const templateOk = decision.mode === "template";

    let problem: string | null = null;
    if (args.conn !== "CONECTADO") problem = EDU_WA_CONN_DETAILS[args.conn];
    else if (!args.enabled[kind]) problem = "Este aviso está apagado.";
    else if (!templateOk) problem = decision.mode === "blocked" ? decision.reason : null;

    return {
      kind,
      label: EDU_WA_KIND_LABELS[kind],
      enabled: args.enabled[kind],
      templateOk,
      templateName: tpl?.name ?? null,
      templateStatus: tpl?.status ?? null,
      problem,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · LO QUE VIAJA AL NAVEGADOR
//
// Los DTO viven AQUÍ y no en el módulo de servidor por una razón muy
// concreta del repo: src/lib/edu/whatsapp.ts importa prisma, y un
// componente "use client" que importe tipos de ahí se arrastra el módulo
// entero al bundle del navegador. `import type` se borra en compilación,
// pero basta un descuido (quitar el `type`) para meter Prisma en el
// cliente — y ese fallo ya se pagó en este repo. Con los tipos en el
// módulo puro, el descuido no tiene consecuencias.
//
// 🔴 NINGUNO LLEVA EL TOKEN. Ni cifrado ni recortado: lo único que la
// pantalla necesita saber es SI hay uno guardado, y eso lo dice `state`.
// ═══════════════════════════════════════════════════════════════════════

export interface EduWaConnectionDTO {
  state: EduWaConnState;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  displayPhone: string | null;
  connMethod: string | null;
  connectedAt: string | null;
  billingOk: boolean;
  billingCheckedAt: string | null;
  lastErrorCode: number | null;
  lastErrorMsg: string | null;
  lastErrorAt: string | null;
  remindersEnabled: boolean;
  reminderHoursBefore: number;
  consentEnabled: boolean;
  receiptEnabled: boolean;
  /** Plantilla registrada por tipo (nombre, idioma, estado). */
  templates: EduWaTemplateMap;
  /** Qué puede salir y qué no, con el porqué. */
  readiness: EduWaKindReadiness[];
}

export interface EduWaMessageRow {
  id: string;
  kind: EduWhatsappKind;
  kindLabel: string;
  status: EduWhatsappStatus;
  patientId: string | null;
  toName: string;
  toPhone: string;
  toPhoneLabel: string;
  appointmentId: string | null;
  consentId: string | null;
  chargeId: string | null;
  body: string;
  templateName: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  errorCode: number | null;
  errorMsg: string | null;
  attempts: number;
  sentByName: string | null;
  createdAt: string;
}
