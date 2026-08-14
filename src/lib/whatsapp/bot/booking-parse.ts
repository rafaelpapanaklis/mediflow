import { getTzParts, todayInTz } from "@/lib/agenda/time-utils";

/**
 * Parsers y formateadores PUROS del flujo de agenda del bot (T4). No tocan BD ni
 * `server-only`: por eso viven aparte de booking-helpers (que sí usa Prisma).
 * Así booking-core y sus tests pueden importar esto sin arrastrar el cliente de
 * Prisma. booking-helpers re-exporta todo para los call sites previos
 * (webhook, booking).
 */

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

// 0=Domingo … 6=Sábado (igual que Date.getUTCDay). Con y sin acento.
const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6,
};

export function normalizeLast10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Parsea "hoy"/"mañana"/"pasado mañana", día de la semana ("lunes" → el próximo
 * lunes), ISO, DD/MM[/YYYY] y "10 de junio". Tolerante; null si no reconoce.
 */
export function parseDateInput(text: string, timezone: string): string | null {
  const t = text.trim().toLowerCase();
  const today = todayInTz(timezone);

  if (/pasado\s+ma(n|ñ)ana/.test(t)) return addDaysISO(today, 2);
  if (/\bhoy\b/.test(t)) return today;
  if (/ma(n|ñ)ana/.test(t)) return addDaysISO(today, 1);

  // Día de la semana → próxima ocurrencia (1..7 días adelante; el mismo día
  // de hoy se interpreta como la semana que viene para evitar ambigüedad).
  const dayNames = Object.keys(WEEKDAYS);
  for (let i = 0; i < dayNames.length; i++) {
    const name = dayNames[i];
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
      let delta = (WEEKDAYS[name] - todayDow + 7) % 7;
      if (delta === 0) delta = 7;
      return addDaysISO(today, delta);
    }
  }

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dm = t.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10);
    let year = dm[3] ? parseInt(dm[3], 10) : parseInt(today.slice(0, 4), 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const named = t.match(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?/);
  if (named) {
    const day = parseInt(named[1], 10);
    const month = MONTHS[named[2]];
    const year = named[3] ? parseInt(named[3], 10) : parseInt(today.slice(0, 4), 10);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }
  return null;
}

/** Parsea "16:30", "4pm", "4 pm". Devuelve "HH:MM" 24h o null. */
export function parseTimeInput(text: string): string | null {
  const t = text.trim().toLowerCase();
  const hm = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const mn = parseInt(hm[2], 10);
    if (h >= 0 && h <= 23 && mn >= 0 && mn <= 59) return `${pad2(h)}:${pad2(mn)}`;
  }
  const ap = t.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (ap) {
    let h = parseInt(ap[1], 10);
    if (ap[2] === "pm" && h < 12) h += 12;
    if (ap[2] === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) return `${pad2(h)}:00`;
  }
  return null;
}

/** Primer entero del texto como índice 0-based dentro de [1, max]; si no, null. */
export function parseChoiceIndex(text: string, max: number): number | null {
  const m = text.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (n >= 1 && n <= max) return n - 1;
  return null;
}

/**
 * Minúsculas sin acentos. El \b de JS no cierra palabra tras una vocal
 * acentuada, así que sin esto "sí" —la confirmación más común— nunca casaba
 * con \b(si)\b. Tras NFD+strip, "sí" → "si" y el resto del set no cambia.
 */
export function foldAccents(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Distancia de edición Damerau-Levenshtein (sustitución, inserción, borrado y
 * transposición de adyacentes) entre `stem` y el MEJOR PREFIJO de `token`: lo
 * que sobra al final del token NO cuenta.
 *
 * Con eso una raíz corta reconoce de golpe todas las flexiones ("confirmar",
 * "confirmo", "confirmado", "confirmación") a distancia 0 y los dedazos
 * ("cofirmar", "confimar", "cnofirmar", "comfirmar", "confrimar") a 1, sin
 * tener que listarlos uno por uno ni meter una librería.
 */
function stemDistance(stem: string, token: string): number {
  const n = stem.length;
  const m = token.length;
  const d: number[][] = [];
  for (let i = 0; i <= n; i++) {
    d[i] = new Array<number>(m + 1).fill(0);
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = stem[i - 1] === token[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && stem[i - 1] === token[j - 2] && stem[i - 2] === token[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  // El sobrante del token es gratis: nos quedamos con el mejor prefijo.
  let best = d[n][0];
  for (let j = 1; j <= m; j++) best = Math.min(best, d[n][j]);
  return best;
}

const CONFIRM_STEM = "confirm";
/** Un solo dedazo. Con 2 empiezan a colarse palabras reales ("confiar" está a 2). */
const CONFIRM_STEM_MAX_DIST = 1;
/** Palabras cortas fuera: a 1-2 letras de "sí"/"ok" hay medio diccionario. */
const CONFIRM_MIN_TOKEN_LEN = 6;

/**
 * ¿Alguna palabra del texto es "confirmar" (o una flexión suya) con hasta un
 * dedazo? Es la tolerancia a erratas del flujo de recordatorios: "Confirmarr"
 * con dos erres es literalmente el caso que dejaba citas sin confirmar.
 *
 * SOLO se aplica a confirmar, nunca a cancelar: confirmar de más cuesta un ✅
 * sobrante, cancelar de más libera el sillón y le dice al paciente que su cita
 * ya no existe. Un "canselar" mal escrito cae en el "no te entendí" del webhook
 * y el paciente lo vuelve a escribir; eso es recuperable, una cita borrada no.
 */
export function hasConfirmStem(text: string): boolean {
  for (const token of foldAccents(text).split(/[^a-z0-9]+/)) {
    if (token.length < CONFIRM_MIN_TOKEN_LEN) continue;
    if (stemDistance(CONFIRM_STEM, token) <= CONFIRM_STEM_MAX_DIST) return true;
  }
  return false;
}

export function isAffirmative(text: string): boolean {
  const t = foldAccents(text);
  if (/\b(si|claro|correcto|confirmo|confirmar|de acuerdo|va|ok|okay|dale|perfecto|sale)\b/.test(t)) {
    return true;
  }
  return hasConfirmStem(t);
}

export function isNegative(text: string): boolean {
  return /\b(no|nel|negativo|mejor no|otro|otra)\b/i.test(text.trim());
}

export function isCancelWord(text: string): boolean {
  return /\b(cancelar|cancela|cancelo|olv[ií]dalo|d[eé]jalo|ya no|salir|detente)\b/i.test(text.trim());
}

/** Comando global "menu"/"reiniciar": vuelve a empezar el flujo de agenda. */
export function isMenuWord(text: string): boolean {
  return /\b(men[uú]|reiniciar|reinicia|empezar de nuevo|volver a empezar)\b/i.test(text.trim());
}

export function formatDateHuman(dateISO: string, timezone: string): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

export function formatTimeHuman(date: Date, timezone: string): string {
  const p = getTzParts(date, timezone);
  return `${pad2(p.hour === 24 ? 0 : p.hour)}:${pad2(p.minute)}`;
}

export function toISODate(date: Date, timezone: string): string {
  const p = getTzParts(date, timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
