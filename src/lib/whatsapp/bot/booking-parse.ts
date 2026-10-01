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

// 0=Domingo … 6=Sábado (igual que Date.getUTCDay). Sin acentos: el texto se
// compara ya pasado por foldAccents.
const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6,
};

/**
 * Una fecha sin año que quedó MÁS de esto en el pasado se lee como del año
 * que viene («10 de enero» dicho en diciembre). Con menos, se deja tal cual y
 * el flujo contesta «esa fecha ya pasó»: «el 30 de septiembre» dicho el 1 de
 * octubre es un error del paciente, no una cita para dentro de un año.
 */
const DIAS_PARA_PASAR_AL_ANO_SIGUIENTE = 60;

export function normalizeLast10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ¿Existe ese día en el calendario? (31/02 no). */
function esFechaReal(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function diasEntre(desdeISO: string, hastaISO: string): number {
  return Math.round(
    (new Date(`${hastaISO}T12:00:00Z`).getTime() - new Date(`${desdeISO}T12:00:00Z`).getTime()) / 86_400_000,
  );
}

/** Día y mes sin año → este año, o el que viene si ya quedó muy atrás. */
function conAnoImplicito(today: string, month: number, day: number): string | null {
  const year = parseInt(today.slice(0, 4), 10);
  if (!esFechaReal(year, month, day)) {
    // 29/02 en año no bisiesto: puede existir el año que viene.
    return esFechaReal(year + 1, month, day) ? `${year + 1}-${pad2(month)}-${pad2(day)}` : null;
  }
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  if (diasEntre(iso, today) > DIAS_PARA_PASAR_AL_ANO_SIGUIENTE && esFechaReal(year + 1, month, day)) {
    return `${year + 1}-${pad2(month)}-${pad2(day)}`;
  }
  return iso;
}

/**
 * «El 15» a secas → el próximo día 15: este mes si no ha pasado; si ya pasó o
 * el mes no lo tiene («el 31» en septiembre), el primer mes siguiente que sí.
 */
function proximoDiaDelMes(today: string, day: number): string | null {
  if (day < 1 || day > 31) return null;
  let year = parseInt(today.slice(0, 4), 10);
  let month = parseInt(today.slice(5, 7), 10);
  const hoyDia = parseInt(today.slice(8, 10), 10);
  for (let i = 0; i < 3; i++) {
    if ((i > 0 || day >= hoyDia) && esFechaReal(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

/**
 * Parsea la fecha que escribe el paciente, SIEMPRE contra el «hoy» de la
 * clínica (`timezone`), no el del servidor. Entiende, en este orden:
 *   1. ISO (2026-10-15) y DD/MM[/AAAA].
 *   2. "15 de octubre [de 2026]", "15 octubre", "1ro de octubre".
 *   3. Día de la semana: "el martes" → el próximo martes (hoy no cuenta: el
 *      mismo día se lee como la semana que viene, salvo "hoy jueves");
 *      "el jueves de la próxima/siguiente semana" → el jueves de la semana
 *      calendario siguiente (lunes a domingo). Si trae número ("martes 13"),
 *      manda el número.
 *   4. "pasado mañana", "hoy", "mañana" — pero "por/en/de la mañana" es un
 *      turno, no el día de mañana ("el martes por la mañana" es el martes).
 *   5. "el 15" / "día 15" → el próximo día 15.
 * Sin año, una fecha muy pasada se pasa al año siguiente (ver
 * DIAS_PARA_PASAR_AL_ANO_SIGUIENTE). `now` es inyectable para las pruebas.
 * Devuelve "YYYY-MM-DD" o null si no reconoce nada.
 */
export function parseDateInput(text: string, timezone: string, now: Date = new Date()): string | null {
  const t = foldAccents(text);
  const p = getTzParts(now, timezone);
  const today = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;

  const iso = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const [y, m, d] = [parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10)];
    return esFechaReal(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }

  const dm = t.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10);
    if (dm[3]) {
      let year = parseInt(dm[3], 10);
      if (year < 100) year += 2000;
      return esFechaReal(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
    }
    return conAnoImplicito(today, month, day);
  }

  const named = t.match(/\b(\d{1,2})\s*(?:ro|ero|o|°|º)?\s+(?:de\s+)?([a-z]+)(?:\s+(?:de|del)\s+(\d{4}))?/);
  if (named && MONTHS[named[2]]) {
    const day = parseInt(named[1], 10);
    const month = MONTHS[named[2]];
    if (named[3]) {
      const year = parseInt(named[3], 10);
      return esFechaReal(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
    }
    return conAnoImplicito(today, month, day);
  }

  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  // "mañana" como día (no como turno: "la mañana", "las mañanas").
  const dijoManana = /(?<!\blas?\s)\bmanana\b/.test(t) && !/pasado\s+manana/.test(t);
  const dijoHoy = /\bhoy\b/.test(t);

  for (const name of Object.keys(WEEKDAYS)) {
    if (!new RegExp(`\\b${name}\\b`).test(t)) continue;
    const target = WEEKDAYS[name];
    // "martes 13": el número manda (y el paciente ve el día real al confirmar).
    const numero = t.match(new RegExp(`\\b${name}\\s+(\\d{1,2})\\b`));
    if (numero) return proximoDiaDelMes(today, parseInt(numero[1], 10));
    if (/\b(proxima|siguiente|otra)\s+semana\b|\bsemana\s+que\s+viene\b/.test(t)) {
      // Semanas de lunes a domingo, como en el calendario de México.
      const lunesQueViene = 7 - ((todayDow + 6) % 7);
      return addDaysISO(today, lunesQueViene + ((target + 6) % 7));
    }
    if (target === todayDow && dijoHoy) return today;
    let delta = (target - todayDow + 7) % 7;
    if (delta === 0) delta = 7;
    return addDaysISO(today, delta);
  }

  if (/pasado\s+manana/.test(t)) return addDaysISO(today, 2);
  if (dijoHoy) return today;
  if (dijoManana) return addDaysISO(today, 1);

  const soloDia = t.match(/\b(?:el|dia)\s+(\d{1,2})\b(?!\s*(?::|am\b|pm\b|hrs?\b|horas?\b))/);
  if (soloDia) return proximoDiaDelMes(today, parseInt(soloDia[1], 10));

  return null;
}

/**
 * ¿El mensaje pide una cita (o moverla)? Lo usa el motor antes de la IA
 * libre. Deliberadamente sin «horario» suelto: «¿qué horario tienen?» es la
 * FAQ del horario de atención, no una reserva. Lo que se escape aquí lo
 * recoge la IA libre con su centinela de agenda (ai-prompt.ts).
 */
export function detectaIntencionDeAgenda(text: string): "book" | "reschedule" | null {
  const n = foldAccents(text ?? "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/(reagendar|reprogramar|cambiar (de|la|mi) cita|mover (la|mi) cita)/.test(n)) return "reschedule";
  if (/(agendar|reservar|sacar (una )?cita|quiero (una )?cita|nueva cita|hacer (una )?cita|pedir (una )?cita)/.test(n)) {
    return "book";
  }
  if (/\b(agendame|agendarme|agendo|agende|apartar (una )?cita)\b/.test(n)) return "book";
  if (
    /\b(quiero|quisiera|me gustaria|necesito|ocupo|puedo|podria|se puede|busco)( sacar| hacer| pedir| tener| agendar)?( una| un)? (cita|consulta|valoracion|revision)\b/.test(n)
  ) {
    return "book";
  }
  if (/\b(hay|tienen|tendran|habra|tiene) (espacio|lugar|disponibilidad|citas?)\b|\bdisponibilidad\b/.test(n)) {
    return "book";
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
 * ws1-t1 (Ortodoncia conectada al bot) — ¿el mensaje que pidió agendar
 * menciona ortodoncia? Deliberadamente estrecho, mismo criterio que
 * `detectaIntencionDeSaldo`/`detectaIntencionDeControlOrto` (saldo-core.ts):
 * un falso positivo aquí le ofrecería "Valoración de ortodoncia" a alguien
 * que solo quería una limpieza.
 */
export function detectaInteresOrtodoncia(texto: string): boolean {
  return /\b(ortodon\w*|brackets?|alineador(es)?|invisalign)\b/.test(foldAccents(texto ?? ""));
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

/**
 * "jueves, 15 de octubre". Lleva el año solo si NO es el año en curso de la
 * clínica (ws1-t5): una cita del año que viene no debe parecer de este.
 * `dateISO` ya es la fecha civil: se formatea en UTC a mediodía para que
 * ninguna zona la corra de día.
 */
export function formatDateHuman(dateISO: string, timezone: string, now: Date = new Date()): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  const otroAno = dateISO.slice(0, 4) !== String(getTzParts(now, timezone).year);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(otroAno ? { year: "numeric" as const } : {}),
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
