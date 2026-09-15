/**
 * Sabina — reglas PURAS de la pantalla del chat.
 *
 * Nada de Prisma, nada de `fetch`, nada de React: son los límites, los
 * saneadores y los pequeños parsers que comparte el cliente con sus tests.
 * Todo lo que toque `/api/sabina` vive en `./sabina-client.tsx`.
 */
import { celdasDe, empiezaTabla, esRenglonDeCuenta, sinMarcador, tipoDeElemento } from "./sabina-listas";

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
  | "apagada" // 403 `sabinaApagada`: el Super Admin apagó a Sabina para este usuario
  | "no_balance" // 402 sin saldo en el monedero
  | "rate_limited" // 429 pasado el límite
  | "plan_limit" // 429 del cupo del plan (`limitReached: true`): reintentar no lo arregla
  | "model_down" // 503 el modelo no responde
  | "network" // fetch nunca llegó a tener status (offline, CORS, DNS…)
  | "unknown"; // cualquier otro código — "nunca un 500 mudo", pero por si acaso

/**
 * `res.status` (o `null` si la petición ni siquiera respondió) → el motivo.
 *
 * El 429 tiene dos orígenes en `/api/sabina` y no se arreglan igual: el freno
 * por ráfaga (se pasa esperando un minuto) y el cupo del plan agotado —o un plan
 * sin IA—, que el motor marca con `limitReached: true` y que ningún reintento
 * arregla. Por eso se mira también el cuerpo.
 */
export function classifySabinaError(status: number | null, body?: unknown): SabinaErrorKind {
  if (status === null) return "network";
  switch (status) {
    case 401:
      return "auth";
    case 402:
      return "no_balance";
    case 403:
      // Solo el 403 que lo dice: otro 403 no es «te la apagaron».
      return (body as { sabinaApagada?: unknown } | null)?.sabinaApagada === true ? "apagada" : "unknown";
    case 429:
      return (body as { limitReached?: unknown } | null)?.limitReached === true ? "plan_limit" : "rate_limited";
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
  apagada: {
    title: "Sabina está apagada para tu usuario",
    message:
      "El Super Admin de la clínica apagó a Sabina para ti, así que no puede consultar ni hacer nada en tu nombre. Si crees que es un error, pídele que la vuelva a activar en Equipo.",
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
  plan_limit: {
    title: "Se acabó el cupo de IA del plan",
    message:
      "El plan de la clínica no incluye esta función de IA o ya se usó el cupo de este mes. Pídele a un administrador que revise el plan.",
    retryable: false,
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
  // `ordered` solo aparece en las numeradas («1. », «2) »).
  | { kind: "bullets"; items: string[]; tone: SabinaParagraphTone; ordered?: true }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "paragraph"; text: string; tone: SabinaParagraphTone };

/**
 * Markdown MUY ligero: encabezados `##`/`###`, listas (`- `, `• `, `* `, `1. `),
 * tablas `| a | b |` y párrafos. No es un parser general — cubre lo que un modelo
 * de chat suele escribir, nada más. Negritas/itálicas/código dentro de un bloque
 * se resuelven aparte con `tokenizeInline`, porque eso ya pinta JSX y este archivo
 * no importa React.
 *
 * Hasta el 14-sep-2026 se aplastaba en un solo párrafo todo lo que no fuera
 * `- `/`• `: la lista numerada, la tabla y hasta las líneas sueltas («Ana — $1,500»
 * y debajo «Luis — $800» se leían seguidas en una línea). Ahora el párrafo conserva
 * sus saltos de línea, dos o más líneas seguidas de «etiqueta — $cantidad» son una
 * lista aunque no traigan viñeta, y una lista de un solo elemento se pinta como
 * frase: una viñeta sola es ruido. Lo fino de cada caso está en `sabina-listas.ts`.
 */
export function parseSabinaMarkdown(raw: string): SabinaBlock[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: SabinaBlock[] = [];
  let buf: string[] = [];

  const pushParagraph = (renglones: string[]) => {
    const text = renglones.join("\n").trim();
    if (text) blocks.push({ kind: "paragraph", text, tone: classifyParagraphTone(text) });
  };

  const flush = () => {
    const renglones = buf.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    buf = [];
    let parrafo: string[] = [];
    let j = 0;
    while (j < renglones.length) {
      let fin = j;
      while (fin < renglones.length && esRenglonDeCuenta(renglones[fin])) fin++;
      if (fin - j >= 2) {
        pushParagraph(parrafo);
        parrafo = [];
        const items = renglones.slice(j, fin);
        blocks.push({ kind: "bullets", items, tone: classifyParagraphTone(items[0]) });
        j = fin;
      } else {
        parrafo.push(renglones[j]);
        j++;
      }
    }
    pushParagraph(parrafo);
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

    if (empiezaTabla(lines, i)) {
      flush();
      const header = celdasDe(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(celdasDe(lines[i]).slice(0, header.length));
        i++;
      }
      // Una tabla de una fila es una frase disfrazada: «Citas hoy: 4 · Canceladas: 1».
      if (rows.length === 1) {
        pushParagraph([header.map((h, j) => `${h}: ${rows[0][j] ?? ""}`).join(" · ")]);
      } else if (rows.length > 1) {
        blocks.push({ kind: "table", header, rows });
      }
      continue;
    }

    const tipo = tipoDeElemento(trimmed);
    if (tipo) {
      flush();
      const items: string[] = [];
      const primera = trimmed;
      while (i < lines.length) {
        const actual = lines[i].trim();
        if (actual && tipoDeElemento(actual) === tipo) {
          items.push(sinMarcador(actual));
          i++;
          continue;
        }
        // Un renglón en blanco entre dos elementos no parte la lista («1. Ana⏎⏎2. Luis»).
        let k = i;
        while (k < lines.length && !lines[k].trim()) k++;
        if (!actual && k < lines.length && tipoDeElemento(lines[k]) === tipo) {
          i = k;
          continue;
        }
        break;
      }
      // Sola, la viñeta sobra; el número no («1. Llama a Ana» sigue siendo un paso).
      if (items.length === 1) pushParagraph([tipo === "number" ? primera : items[0]]);
      else blocks.push({ kind: "bullets", items, tone: classifyParagraphTone(items[0] ?? ""), ...(tipo === "number" ? { ordered: true as const } : {}) });
      continue;
    }

    buf.push(trimmed);
    i++;
  }
  flush();

  return blocks;
}

// ── Formato inline (negrita / itálica / código / enlace) ────────────────
export interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Ruta de la propia app (el comprobante de una factura). */
  href?: string;
}

/**
 * `"cita **hoy** a las *3pm*"` → tokens que el cliente convierte a JSX.
 *
 * Enlaces `[texto](/ruta)` SOLO hacia rutas de la propia app (`/api/…`,
 * `/dashboard/…`): es lo que deja a Sabina dar el comprobante en PDF. Una URL con
 * dominio, `javascript:` o `//otro.sitio` se queda como texto plano: el modelo
 * escribe lo que leyó, y lo que leyó puede venir de un campo que tecleó cualquiera.
 */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]\n]{1,80})\]\((\/(?:api|dashboard)\/[A-Za-z0-9_\-./]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[5] !== undefined && (m[5].includes("..") || m[5].includes("//"))) continue;
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) tokens.push({ text: m[2], italic: true });
    else if (m[3] !== undefined) tokens.push({ text: m[3], code: true });
    else if (m[4] !== undefined) tokens.push({ text: m[4], href: m[5] });
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
