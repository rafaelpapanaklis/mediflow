/**
 * Sabina — reglas PURAS de la pantalla del chat.
 *
 * Nada de Prisma, nada de `fetch`, nada de React: son los límites, los
 * saneadores y los pequeños parsers que comparte el cliente con sus tests.
 * Todo lo que toque `/api/sabina` vive en `./sabina-client.tsx`.
 */

// ── Límites del lado del cliente ────────────────────────────────────────
// Techo defensivo de la pregunta que se manda. El motor puede tener el suyo
// propio (no lo conocemos: no es nuestro archivo); este solo evita mandar un
// payload absurdo desde la pantalla.
export const SABINA_QUESTION_MAX_CHARS = 4000;
/** Título derivado de la primera pregunta, para la fila del historial. */
export const SABINA_TITLE_MAX = 60;

/**
 * Limpia la pregunta antes de mandarla: colapsa espacios y recorta al
 * máximo. `null` si no queda nada útil — el caller decide no mandar nada.
 */
export function sanitizeQuestion(raw: string): string | null {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, SABINA_QUESTION_MAX_CHARS);
}

/** Título de la fila del historial, derivado de la primera pregunta. */
export function titleFromQuestion(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, SABINA_TITLE_MAX) : "Consulta a Sabina";
}

// ── Herramientas usadas ──────────────────────────────────────────────────
// Etiquetas en español para el catálogo inicial del contrato
// (CONTRATO.md → "El catálogo inicial"). Una herramienta que el motor
// devuelva y no esté aquí cae al humanizador de `humanizeToolName`, así que
// un catálogo ampliado después no rompe la pantalla, solo pierde la
// etiqueta bonita hasta que se añada aquí.
export const SABINA_TOOL_LABELS: Record<string, string> = {
  citas_del_dia: "citas del día",
  agenda_ocupacion: "ocupación de la agenda",
  ausencias: "ausencias",
  pacientes_con_deuda: "pacientes con deuda",
  ingresos_por_periodo: "ingresos del periodo",
  tratamientos_por_ingreso: "tratamientos por ingreso",
  pacientes_nuevos: "pacientes nuevos",
  pacientes_inactivos: "pacientes inactivos",
  buscar_paciente: "búsqueda de paciente",
  resumen_clinica: "resumen de la clínica",
};

/** `citas_del_dia` → `citas del día` (catálogo) o `algo raro` (humanizado). */
export function humanizeToolName(name: string): string {
  const known = SABINA_TOOL_LABELS[name];
  if (known) return known;
  return name.replace(/_/g, " ").trim().toLowerCase();
}

/**
 * Lista de herramientas → frase legible en español ("citas del día,
 * ingresos del mes y pacientes con deuda"). `[]` o basura → `null`, el
 * caller decide no pintar nada.
 */
export function formatToolsUsed(tools: readonly string[] | null | undefined): string | null {
  if (!tools || !tools.length) return null;
  const labels = tools.map(humanizeToolName).filter(Boolean);
  if (!labels.length) return null;
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

// ── Errores del endpoint (CONTRATO.md → "El contrato del endpoint") ─────
export type SabinaErrorKind =
  | "auth" // 401 sin sesión
  | "no_balance" // 402 sin saldo en el monedero
  | "rate_limited" // 429 pasado el límite
  | "model_down" // 503 el modelo no responde
  | "network" // fetch nunca llegó a tener status (offline, CORS, DNS…)
  | "unknown"; // cualquier otro código — "nunca un 500 mudo", pero por si acaso

/** `res.status` (o `null` si la petición ni siquiera respondió) → el motivo. */
export function classifySabinaError(status: number | null): SabinaErrorKind {
  if (status === null) return "network";
  switch (status) {
    case 401:
      return "auth";
    case 402:
      return "no_balance";
    case 429:
      return "rate_limited";
    case 503:
      return "model_down";
    default:
      return "unknown";
  }
}

export interface SabinaErrorCopy {
  title: string;
  message: string;
  /** Si tiene sentido ofrecer "Reintentar" con la misma pregunta. */
  retryable: boolean;
}

export const SABINA_ERROR_COPY: Record<SabinaErrorKind, SabinaErrorCopy> = {
  auth: {
    title: "Tu sesión terminó",
    message: "Vuelve a iniciar sesión para seguir hablando con Sabina.",
    retryable: false,
  },
  no_balance: {
    title: "Sin saldo en el monedero de IA",
    message:
      "La clínica se quedó sin saldo. Pídele a un administrador que lo recargue para que Sabina siga respondiendo.",
    retryable: false,
  },
  rate_limited: {
    title: "Muchas preguntas seguidas",
    message: "Dale un momento a Sabina y vuelve a intentar en un minuto.",
    retryable: true,
  },
  model_down: {
    title: "Sabina no responde ahora mismo",
    message: "No es nada que hayas hecho. Vuelve a intentar en unos segundos.",
    retryable: true,
  },
  network: {
    title: "Sin conexión",
    message: "No se pudo contactar al servidor. Revisa tu conexión y vuelve a intentar.",
    retryable: true,
  },
  unknown: {
    title: "Algo salió mal",
    message: "Sabina no pudo responder esta vez. Vuelve a intentar.",
    retryable: true,
  },
};

// ── Formato ligero de la respuesta ──────────────────────────────────────
// Sabina separa hecho de opinión en el TEXTO (CONTRATO.md, regla 6). La
// pantalla no puede inventarse esa separación — no la conoce — pero sí puede
// pintar markdown ligero (negritas, listas, encabezados) para que lo que el
// motor ya estructura no se aplane en un párrafo gris, y dar un tratamiento
// visual propio al párrafo que arranca con una palabra de sugerencia
// ("Sugerencia:", "Yo movería…"), que es el vocabulario que pide el
// contrato. Si el motor no usa ese vocabulario, el párrafo cae a "plain" y
// se ve como cualquier otro — no se rompe nada por no acertar la heurística.
export type SabinaParagraphTone = "fact" | "opinion" | "plain";

const OPINION_RE =
  /^(sugerencia|recomendaci[oó]n|yo\s+(movería|sugiero|recomiendo|dejaría|probaría|intentaría)|te\s+(sugiero|recomiendo)|mi\s+recomendaci[oó]n)\b/i;
const FACT_RE = /^(medici[oó]n|medido|dato medido|seg[uú]n\s+(la\s+|los\s+)?(agenda|caja|facturaci[oó]n|datos))\b/i;

/** Tono de un párrafo YA sin marcado (`**`, `*`) en los extremos. */
export function classifyParagraphTone(text: string): SabinaParagraphTone {
  const stripped = text.replace(/\*\*/g, "").trim();
  if (OPINION_RE.test(stripped)) return "opinion";
  if (FACT_RE.test(stripped)) return "fact";
  return "plain";
}

export type SabinaBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "bullets"; items: string[]; tone: SabinaParagraphTone }
  | { kind: "paragraph"; text: string; tone: SabinaParagraphTone };

/**
 * Markdown MUY ligero: encabezados `##`/`###`, listas `- `/`• ` y párrafos.
 * No es un parser general — cubre lo que un modelo de chat suele escribir,
 * nada más. Negritas/itálicas/código dentro de un bloque se resuelven aparte
 * con `tokenizeInline`, porque eso ya pinta JSX y este archivo no importa React.
 */
export function parseSabinaMarkdown(raw: string): SabinaBlock[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: SabinaBlock[] = [];
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (text) blocks.push({ kind: "paragraph", text, tone: classifyParagraphTone(text) });
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      flush();
      i++;
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length === 2 ? 2 : 3, text: heading[2].trim() });
      i++;
      continue;
    }

    if (/^[-•]\s+/.test(trimmed)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^[-•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "bullets", items, tone: classifyParagraphTone(items[0] ?? "") });
      continue;
    }

    buf.push(trimmed);
    i++;
  }
  flush();

  return blocks;
}

// ── Formato inline (negrita / itálica / código) ─────────────────────────
export interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** `"cita **hoy** a las *3pm*"` → tokens que el cliente convierte a JSX. */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) tokens.push({ text: m[2], italic: true });
    else if (m[3] !== undefined) tokens.push({ text: m[3], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens.length ? tokens : [{ text }];
}

// ── Preguntas de ejemplo ─────────────────────────────────────────────────
// Cinco, mezclando directas y abiertas (CONTRATO.md → "Qué es Sabina").
export interface SabinaSuggestion {
  text: string;
  hint: string;
}

export const SABINA_SUGGESTIONS: SabinaSuggestion[] = [
  { text: "¿Quién me debe?", hint: "Pacientes con saldo pendiente" },
  { text: "¿Cuántas citas tengo hoy?", hint: "La agenda del día" },
  { text: "¿Cómo van mis ingresos este mes?", hint: "Facturación del periodo" },
  { text: "¿Qué pacientes no he visto en un tiempo?", hint: "Pacientes inactivos" },
  { text: "¿Qué hago para expandir mi clínica?", hint: "Análisis abierto" },
];

// ── Reloj del estado "pensando" ──────────────────────────────────────────
// Frases genéricas — NO afirman qué herramienta se está llamando de verdad,
// porque el contrato no manda ese dato hasta que la respuesta llega entera.
// Decir "consultando la agenda…" sin saberlo sería inventar, y Sabina no
// inventa (CONTRATO.md, regla 5) — tampoco su pantalla.
export const SABINA_THINKING_HINTS = [
  "Sabina está pensando…",
  "Revisando los datos de la clínica…",
  "Cruzando la información…",
];

/** A partir de aquí (ms) se avisa que una pregunta abierta tarda más. */
export const SABINA_SLOW_HINT_MS = 4500;
