/**
 * «El próximo lunes», «mañana», «el 15»: las fechas relativas de Sabina,
 * calculadas por el SISTEMA y no por el modelo (ws1-t5, revisión en panel.108).
 *
 * El fallo: jueves 1-oct-2026, «agenda un control el próximo lunes a las
 * 10:00» propuso el martes 6, y «¿qué día es el próximo lunes?» contestó 6-oct.
 * La fecha de hoy le llegaba bien (zona de la clínica, `hoyParaPrompt`), pero
 * sola: el modelo tenía que contar los días de la semana de cabeza y se iba
 * uno. El bot de WhatsApp no falla en lo mismo porque recibe la tabla de los
 * próximos días ya escrita (`whatsapp/bot/fecha-contexto.ts`). Aquí se hace lo
 * mismo, y además se le dice qué fecha es cada forma de decirlo.
 *
 * Puro: aritmética sobre `YYYY-MM-DD` (el día civil de la clínica, que se
 * calcula fuera con su zona) armada a mediodía UTC, sin `getDay()` del proceso.
 *
 * Convención (español de México):
 *  - «el lunes», «este lunes», «el próximo lunes», «el lunes que viene»: el
 *    primer lunes DESPUÉS de hoy (de 1 a 7 días).
 *  - Si hoy ES lunes: «este lunes» es hoy; «el lunes» y «el próximo lunes»
 *    son dentro de 7 días.
 *  - «el 15» sin mes: el 15 que sigue contando hoy; si ya pasó este mes, el del
 *    mes siguiente (y si ese mes no tiene ese día —«el 31» en noviembre—, el
 *    siguiente que lo tenga).
 */

export const DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function aUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function aISO(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function masDias(iso: string, dias: number): string {
  const dt = aUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + dias);
  return aISO(dt);
}

/** 0 = lunes … 6 = domingo (la convención de ClinicSchedule). */
export function diaDeLaSemana(iso: string): number {
  return (aUTC(iso).getUTCDay() + 6) % 7;
}

/** «lunes 5 de octubre de 2026». */
export function fechaLarga(iso: string): string {
  const dt = aUTC(iso);
  return `${DIAS_SEMANA[diaDeLaSemana(iso)]} ${dt.getUTCDate()} de ${MESES[dt.getUTCMonth()]} de ${dt.getUTCFullYear()}`;
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * El día de la semana `objetivo` (0 = lunes) que corresponde a la expresión.
 * `incluyeHoy`: «este lunes» dicho un lunes es hoy.
 */
export function proximoDiaDeLaSemana(hoyISO: string, objetivo: number, incluyeHoy = false): string {
  const hoy = diaDeLaSemana(hoyISO);
  let delta = (objetivo - hoy + 7) % 7;
  if (delta === 0 && !incluyeHoy) delta = 7;
  return masDias(hoyISO, delta);
}

/** «el N» sin mes: el día N que sigue, contando hoy. null si N no es de 1 a 31. */
export function proximoDiaDelMes(hoyISO: string, n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  const [y, m, d] = hoyISO.split("-").map((x) => parseInt(x, 10));
  // Este mes si aún no pasa; si no, los siguientes hasta dar con uno que lo tenga
  // (a lo más dos saltos: ningún par de meses seguidos se queda sin día 31).
  for (let salto = n >= d ? 0 : 1; salto < 4; salto++) {
    const dt = new Date(Date.UTC(y, m - 1 + salto, n, 12, 0, 0));
    if (dt.getUTCDate() === n) return aISO(dt);
  }
  return null;
}

/**
 * Resuelve una expresión relativa a `YYYY-MM-DD`, o null si no la reconoce.
 * Es lo que el bloque del prompt escribe ya calculado; las pruebas la usan
 * para fijar la convención.
 */
export function resolverFechaRelativa(expresion: string, hoyISO: string): string | null {
  const t = sinAcentos(expresion.toLowerCase()).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (t === "hoy") return hoyISO;
  if (t === "manana") return masDias(hoyISO, 1);
  if (t === "pasado manana") return masDias(hoyISO, 2);

  const dias = DIAS_SEMANA.map(sinAcentos).join("|");
  const re = new RegExp(`^(el |este |el proximo |proximo |el siguiente )?(${dias})( que viene| que entra)?$`);
  const m = t.match(re);
  if (m) {
    const objetivo = DIAS_SEMANA.map(sinAcentos).indexOf(m[2]);
    return proximoDiaDeLaSemana(hoyISO, objetivo, m[1] === "este ");
  }

  const n = t.match(/^(el )?(dia )?(\d{1,2})$/);
  if (n) return proximoDiaDelMes(hoyISO, parseInt(n[3], 10));
  return null;
}

function ultimoDiaDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0, 12, 0, 0)).getUTCDate();
}

/**
 * El bloque del system prompt: las fechas relativas ya resueltas para HOY de
 * la clínica. Cada línea sale de `resolverFechaRelativa`, así que prompt y
 * pruebas dicen lo mismo.
 */
export function bloqueFechasRelativas(hoyISO: string): string {
  const r = (e: string) => resolverFechaRelativa(e, hoyISO)!;
  const conNombre = (iso: string) => `${fechaLarga(iso)} (${iso})`;
  const hoyDia = diaDeLaSemana(hoyISO);

  // En orden de calendario a partir de mañana; el día de hoy, al final.
  const lineasDia = DIAS_SEMANA.map((_, k) => (hoyDia + 1 + k) % 7).map((i) => {
    const dia = DIAS_SEMANA[i];
    if (i === hoyDia) {
      return `- Hoy es ${dia}: «este ${dia}» es hoy; «el ${dia}» o «el próximo ${dia}» es el ${conNombre(r(`el ${dia}`))}.`;
    }
    return `- «El ${dia}», «este ${dia}» o «el próximo ${dia}»: ${conNombre(r(`el ${dia}`))}.`;
  });

  const [y, m, d] = hoyISO.split("-").map((x) => parseInt(x, 10));
  const ultimo = ultimoDiaDelMes(y, m);
  const siguiente = new Date(Date.UTC(y, m, 1, 12, 0, 0));
  const mesSig = `${MESES[siguiente.getUTCMonth()]} de ${siguiente.getUTCFullYear()}`;
  const lineaN =
    d === 1
      ? `- «El N» sin mes: el día N de ${MESES[m - 1]} de ${y}.`
      : `- «El N» sin mes: del ${d} al ${ultimo} es de ${MESES[m - 1]} de ${y}; del 1 al ${d - 1}, de ${mesSig}.`;

  return [
    "FECHAS YA CALCULADAS (el sistema, en la zona de la clínica). Úsalas tal cual; NO cuentes días de la semana tú:",
    `- Mañana: ${conNombre(r("mañana"))}. Pasado mañana: ${conNombre(r("pasado mañana"))}.`,
    ...lineasDia,
    lineaN,
    "- Si piden una semana después («el lunes de la otra semana»), suma 7 días a la fecha de arriba.",
  ].join("\n");
}
