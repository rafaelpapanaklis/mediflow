// Lectura de VALORES de una hoja de otro sistema: montos, teléfonos, nombres
// completos, horas y zonas horarias. PURO (sin Prisma ni red): se prueba solo.
//
// Regla que atraviesa el archivo: lo que no se puede leer con certeza NO se
// adivina en silencio. Un monto ambiguo («45.000») se marca para que el usuario
// lo confirme; una hora ilegible es un error, jamás un «09:00» inventado (esa
// hora puede acabar en un WhatsApp al paciente).

import { consentTimeZone } from "@/lib/consent/dates";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";

// ═══════════════════════════════════════════════════════════════════════════
// MONTOS
// ═══════════════════════════════════════════════════════════════════════════

/** ES = punto de miles y coma decimal («1.250,50»). US = coma de miles y punto decimal («1,250.50»). */
export type EstiloNumerico = "ES" | "US";

export type AnalisisMonto =
  | { tipo: "vacio" }
  | { tipo: "invalido" }
  /** `estilo` = lo que este valor demuestra sobre el formato del archivo (null si no demuestra nada, p. ej. «1500»). */
  | { tipo: "ok"; valor: number; estilo: EstiloNumerico | null }
  /** Un solo separador seguido de EXACTAMENTE tres dígitos: «45.000» puede ser 45 000 o 45,000. */
  | { tipo: "ambiguo"; miles: number; decimal: number; separador: "." | ","; raw: string };

const MAX_MONTO = 1e12;

/** Analiza UN valor, sin mirar el resto del archivo. */
export function analizarMonto(v: unknown): AnalisisMonto {
  if (v === undefined || v === null) return { tipo: "vacio" };
  if (typeof v === "number") return Number.isFinite(v) ? { tipo: "ok", valor: v, estilo: null } : { tipo: "invalido" };
  const original = String(v).trim();
  if (!original) return { tipo: "vacio" };

  // Signo: «-45», «45-», «(45)» y el menos tipográfico «−».
  let t = original.replace(/[−–]/g, "-");
  // «500.-» y «500,-» (notación chilena de «pesos exactos») NO son negativos: el guion final es adorno.
  t = t.replace(/[.,]\s*-\s*$/, "");
  // Un guion entre dígitos («1-2») no es un signo: no se lee como 12.
  if (/\d\s*-\s*\d/.test(t)) return { tipo: "invalido" };
  const negativo = /^\(.*\)$/.test(t) || t.startsWith("-") || t.endsWith("-");
  // Solo dígitos y separadores: fuera $, «MXN», «CLP» y demás decoración. Cualquier otra cosa
  // («12a5», «cuarenta») no es un monto.
  const sinMoneda = t.replace(/\b(mxn|mx|clp|usd|cop|pen|ars|eur|pesos?|m\.n\.)\b/gi, "").replace(/[$€£]/g, "");
  if (!/^[\s()\-\d.,'’]+$/.test(sinMoneda)) return { tipo: "invalido" };
  const s = sinMoneda.replace(/[^0-9,.]/g, "");
  if (!/[0-9]/.test(s)) return { tipo: "invalido" };

  const signo = negativo ? -1 : 1;
  const comas = (s.match(/,/g) ?? []).length;
  const puntos = (s.match(/\./g) ?? []).length;
  const ok = (valor: number, estilo: EstiloNumerico | null): AnalisisMonto =>
    Number.isFinite(valor) && Math.abs(valor) < MAX_MONTO ? { tipo: "ok", valor: signo * valor, estilo } : { tipo: "invalido" };

  if (comas > 0 && puntos > 0) {
    // Los dos: el ÚLTIMO es el decimal, y solo puede aparecer una vez.
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const mil = dec === "," ? "." : ",";
    if ((s.match(dec === "," ? /,/g : /\./g) ?? []).length !== 1) return { tipo: "invalido" };
    const [ent, frac] = s.split(dec);
    const grupos = ent.split(mil);
    // «1.250,50»: el primer grupo de 1–3 dígitos y los demás de 3. Si no, no es un monto.
    if (!/^\d{1,3}$/.test(grupos[0]) || !grupos.slice(1).every((g) => /^\d{3}$/.test(g))) return { tipo: "invalido" };
    if (!/^\d+$/.test(frac)) return { tipo: "invalido" };
    return ok(Number(`${grupos.join("")}.${frac}`), dec === "," ? "ES" : "US");
  }

  if (comas === 0 && puntos === 0) return ok(Number(s), null);

  const sep = comas > 0 ? "," : ".";
  const veces = comas > 0 ? comas : puntos;
  const estiloDeSep: EstiloNumerico = sep === "," ? "US" : "ES"; // sep como MILES: coma→US, punto→ES

  if (veces > 1) {
    // «1.250.000»: solo puede ser separador de miles, con grupos de 3.
    const grupos = s.split(sep);
    if (!/^\d{1,3}$/.test(grupos[0]) || !grupos.slice(1).every((g) => /^\d{3}$/.test(g))) return { tipo: "invalido" };
    return ok(Number(grupos.join("")), estiloDeSep);
  }

  const [ent, frac] = s.split(sep);
  const estiloDeDecimal: EstiloNumerico = sep === "," ? "ES" : "US"; // sep como DECIMAL: coma→ES, punto→US
  if (frac === "") return ok(Number(ent || "0"), null); // «45.» → 45
  if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(ent)) {
    // Un grupo de 1–3 dígitos (sin cero a la izquierda) + tres dígitos: miles… o tres decimales.
    return {
      tipo: "ambiguo",
      miles: signo * Number(`${ent}${frac}`),
      decimal: signo * Number(`${ent}.${frac}`),
      separador: sep,
      raw: original,
    };
  }
  // Uno o dos decimales («45,50», «12.5»), o más de tres, o «0.500»: es decimal sin duda.
  return ok(Number(`${ent || "0"}.${frac}`), estiloDeDecimal);
}

/** Decisión del usuario sobre los montos ambiguos del archivo. */
export type DecisionMontos = "miles" | "decimales";

export interface LecturaMonto {
  /** null = vacío o ilegible (mira `error`). */
  valor: number | null;
  vacio: boolean;
  error?: string;
  /** Ambiguo y sin decisión: el usuario tiene que confirmarlo. `valor` es solo la lectura provisional. */
  pendiente?: string;
  /** Aviso para la fila cuando se resolvió por el resto del archivo o por la decisión. */
  aviso?: string;
}

export interface LectorMontos {
  leer(v: unknown): LecturaMonto;
  /** Estilo que demuestra el archivo: ES, US, "mixto" (se contradice) o null (no demuestra nada). */
  estilo: EstiloNumerico | "mixto" | null;
}

/**
 * Un lector por archivo. Mira TODOS los valores de las columnas de monto: si
 * el archivo demuestra el formato ≥2 VECES («1.250,50» solo puede ser punto de
 * miles), los ambiguos se leen con ese formato. Es dinero: UNA sola muestra no
 * es evidencia suficiente para un archivo con formatos mezclados (columnas
 * pegadas de sistemas distintos), así que con una sola muestra el ambiguo
 * sigue pendiente, igual que si el archivo no demostrara nada (decisión del
 * 28-sep-2026 tras el QA de ws1-t10, hallazgo B1). Si nada lo demuestra lo
 * suficiente, quedan pendientes hasta que el usuario decida (`decision`, que
 * viene del valueMapping).
 */
export function crearLectorMontos(muestras: unknown[], decision?: string | null): LectorMontos {
  const conteo = new Map<EstiloNumerico, number>();
  for (const m of muestras) {
    const a = analizarMonto(m);
    if (a.tipo === "ok" && a.estilo) conteo.set(a.estilo, (conteo.get(a.estilo) ?? 0) + 1);
  }
  const vistos = Array.from(conteo.keys());
  const estilo: LectorMontos["estilo"] =
    vistos.length === 2 ? "mixto" : vistos.length === 1 && (conteo.get(vistos[0]) ?? 0) >= 2 ? vistos[0] : null;
  const dec: DecisionMontos | null = decision === "miles" || decision === "decimales" ? decision : null;

  return {
    estilo,
    leer(v) {
      const a = analizarMonto(v);
      if (a.tipo === "vacio") return { valor: null, vacio: true };
      if (a.tipo === "invalido") return { valor: null, vacio: false, error: `Monto inválido "${String(v).trim()}"` };
      if (a.tipo === "ok") return { valor: a.valor, vacio: false };
      // Ambiguo.
      const comoMiles = `«${a.raw}» se leyó como ${fmt(a.miles)}`;
      const comoDecimal = `«${a.raw}» se leyó como ${fmt(a.decimal)}`;
      if (dec) return { valor: dec === "miles" ? a.miles : a.decimal, vacio: false, aviso: `${dec === "miles" ? comoMiles : comoDecimal} (según lo que confirmaste)` };
      if (estilo === "ES" || estilo === "US") {
        // ES: el punto es de miles y la coma decimal. US, al revés.
        const esMiles = (a.separador === "." && estilo === "ES") || (a.separador === "," && estilo === "US");
        return {
          valor: esMiles ? a.miles : a.decimal,
          vacio: false,
          aviso: `${esMiles ? comoMiles : comoDecimal} (el archivo usa ${estilo === "ES" ? "punto para miles y coma para decimales" : "coma para miles y punto para decimales"})`,
        };
      }
      return { valor: a.miles, vacio: false, pendiente: a.raw };
    },
  };
}

function fmt(n: number): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: 3 });
}

/**
 * Compatibilidad con el `parseAmount` de siempre: número o null. Un monto
 * AMBIGUO se lee como miles y ya no hay quien lo confirme: las entidades usan
 * `crearLectorMontos`, que sí lo marca.
 */
export function montoSinConfirmar(v: unknown): number | null {
  const a = analizarMonto(v);
  if (a.tipo === "ok") return a.valor;
  if (a.tipo === "ambiguo") return a.miles;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// TELÉFONOS
// ═══════════════════════════════════════════════════════════════════════════

/** Prefijo de país → largos del número nacional que admitimos con él. */
const PAISES: Array<[string, number[]]> = [
  ["52", [10]], // México
  ["56", [9]], // Chile
  ["57", [10]], // Colombia
  ["51", [9]], // Perú
  ["54", [10, 11]], // Argentina
  ["34", [9]], // España
  ["1", [10]], // EE. UU. / Canadá
];

function sinPais(d: string): string {
  for (const [cod, largos] of PAISES) {
    if (d.startsWith(cod) && largos.includes(d.length - cod.length)) {
      let nacional = d.slice(cod.length);
      // México móvil antiguo: +52 1 55… (el 1 sobra).
      if (cod === "52" && nacional.length === 11 && nacional.startsWith("1")) nacional = nacional.slice(1);
      return nacional;
    }
  }
  // «+52 1 55 1234 5678» = 52 + 1 + 10 dígitos.
  if (d.startsWith("521") && d.length === 13) return d.slice(3);
  return d;
}

/**
 * Llave para emparejar un teléfono aunque venga con y sin prefijo de país:
 * «+52 55 1234 5678», «525512345678» y «55 1234 5678» dan la misma; «+56 9 1234
 * 5678» y «912345678» también. (Los «últimos 10 dígitos» de antes fallaban con
 * Chile: 9 dígitos + «56» = 11, y el «6» sobrante rompía la comparación.)
 */
export function phoneKey(v: unknown): string {
  const raw = String(v ?? "").trim();
  let d = raw.replace(/\D/g, "");
  if (!d) return "";
  const conPrefijo = /^(\+|00)/.test(raw);
  if (conPrefijo && d.startsWith("00")) d = d.slice(2);
  if (conPrefijo || d.length > 10) d = sinPais(d);
  return d.length > 10 ? d.slice(-10) : d;
}

// ═══════════════════════════════════════════════════════════════════════════
// NOMBRES
// ═══════════════════════════════════════════════════════════════════════════

const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "san", "santa", "da", "das", "do", "dos", "van", "von", "di", "le"]);

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** «María del Carmen», «José de Jesús»…: nombres de pila compuestos con partícula. */
const COMPUESTO_CON_PARTICULA =
  /^(maria|ma|jose|juan)\s+(del|de la|de los|de las|de)\s+(carmen|jesus|dios|luz|paz|rosario|pilar|socorro|lourdes|guadalupe|angeles|refugio|consuelo|sagrario|montserrat|natividad|la o)\b/;

const PRIMER_NOMBRE = new Set([
  "maria", "jose", "juan", "ana", "luis", "carlos", "miguel", "jesus", "francisco", "pedro", "rosa", "laura", "carmen",
  "guadalupe", "jorge", "manuel", "antonio", "sofia", "mariana", "daniela", "fernanda", "victor", "marco", "juana", "ma",
]);
const SEGUNDO_NOMBRE = new Set([
  "maria", "jose", "carlos", "luis", "antonio", "angel", "alberto", "ana", "isabel", "guadalupe", "fernanda", "eduardo",
  "manuel", "miguel", "fernando", "javier", "francisco", "alejandra", "patricia", "elena", "teresa", "paula", "sofia",
  "gabriela", "cristina", "andres", "ricardo", "rafael", "arturo", "alfredo", "de", "del",
]);

/** Agrupa las palabras en «unidades»: una partícula se pega a la palabra que sigue («de la Cruz»). */
function unidades(palabras: string[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  palabras.forEach((p, i) => {
    buf.push(p);
    if (PARTICULAS.has(sinAcentos(p)) && i < palabras.length - 1) return;
    out.push(buf.join(" "));
    buf = [];
  });
  return out;
}

export interface NombrePartido {
  firstName: string;
  lastName: string;
  /** Hubo que decidir entre dos lecturas plausibles (tres palabras): que el usuario lo revise. */
  dudoso: boolean;
}

/**
 * Parte «Juan Carlos Pérez García» en nombre(s) y apellido(s) con el uso
 * latinoamericano: dos apellidos al final. «Pérez García, Juan Carlos» (con
 * coma) manda lo que dice la coma. Con tres palabras hay dos lecturas
 * («Juan / Pérez García» o «María José / Pérez»): se elige por un diccionario de
 * nombres compuestos comunes y se marca como dudoso.
 */
export function partirNombreCompleto(entrada: string): NombrePartido {
  const limpio = String(entrada ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return { firstName: "", lastName: "", dudoso: false };

  if (limpio.includes(",")) {
    const i = limpio.indexOf(",");
    const apellidos = limpio.slice(0, i).trim();
    const nombres = limpio.slice(i + 1).trim();
    if (apellidos && nombres) return { firstName: nombres, lastName: apellidos, dudoso: false };
  }

  const palabras = limpio.split(" ");
  // Nombres de pila con partícula al principio: se consumen enteros.
  let consumidas = 0;
  const m = sinAcentos(limpio).match(COMPUESTO_CON_PARTICULA);
  if (m) consumidas = m[0].split(" ").length;
  const dados = palabras.slice(0, consumidas).join(" ");
  const resto = unidades(palabras.slice(consumidas));

  if (consumidas > 0) {
    if (resto.length === 0) return { firstName: dados, lastName: "", dudoso: false };
    return { firstName: dados, lastName: resto.join(" "), dudoso: false };
  }

  const n = resto.length;
  if (n === 1) return { firstName: resto[0], lastName: "", dudoso: false };
  if (n === 2) return { firstName: resto[0], lastName: resto[1], dudoso: false };
  if (n === 3) {
    const a = sinAcentos(resto[0]);
    const b = sinAcentos(resto[1]);
    if (PRIMER_NOMBRE.has(a) && SEGUNDO_NOMBRE.has(b)) return { firstName: `${resto[0]} ${resto[1]}`, lastName: resto[2], dudoso: true };
    return { firstName: resto[0], lastName: `${resto[1]} ${resto[2]}`, dudoso: true };
  }
  if (n === 4) return { firstName: `${resto[0]} ${resto[1]}`, lastName: `${resto[2]} ${resto[3]}`, dudoso: false };
  return { firstName: resto.slice(0, n - 2).join(" "), lastName: resto.slice(n - 2).join(" "), dudoso: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// FECHAS Y HORAS
// ═══════════════════════════════════════════════════════════════════════════

/** Hora de reloj de una celda (la lleva la fecha que arma engine.cellToRaw). */
export interface HoraDeReloj {
  h: number;
  m: number;
}

/**
 * Resultado de leer una hora: `undefined` = no hay nada escrito; `null` = hay
 * algo pero no es una hora; objeto = la hora. `dudosa` = 24 h sin AM/PM en la
 * madrugada («03:30»): casi siempre es «15:30» mal escrito.
 */
export type LecturaHora = undefined | null | (HoraDeReloj & { dudosa?: boolean });

/** Una celda de fecha o de hora de .xlsx, ya con su hora de reloj pegada (ver engine.cellToRaw). */
export function horaAdjunta(v: unknown): HoraDeReloj | undefined {
  if (v instanceof Date) {
    const h = (v as Date & { hora?: HoraDeReloj }).hora;
    if (h && Number.isInteger(h.h) && Number.isInteger(h.m)) return h;
  }
  return undefined;
}

export function parseHora(v: unknown): LecturaHora {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) {
    const h = horaAdjunta(v);
    return h ? { h: h.h, m: h.m } : null;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null;
    const frac = v - Math.floor(v);
    // Un entero ≥ 1 es una fecha, no una hora. 0 es medianoche.
    if (frac === 0 && v !== 0) return null;
    const min = Math.round(frac * 1440) % 1440;
    return { h: Math.floor(min / 60), m: min % 60 };
  }
  let s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  s = s.replace(/([ap])\s*\.?\s*m\s*\.?/g, "$1m").replace(/\s*(hrs?|hs)\.?$/, "").replace(/\s+/g, " ");
  // Minutos siempre de dos dígitos: «9.5» no es 09:05.
  const r = s.match(/^(\d{1,2})(?:[:.h](\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!r) return null;
  let h = Number(r[1]);
  const m = r[2] === undefined ? 0 : Number(r[2]);
  const mer = r[3];
  if (m > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
    return { h, m };
  }
  if (h > 23) return null;
  return { h, m, ...(h >= 1 && h <= 6 ? { dudosa: true } : {}) };
}

/** Separa «05/10/2026 15:30» o «2026-10-05T15:30:00» en fecha y hora. */
export function separarFechaHora(v: string): { fecha: string; hora: string | null } {
  const s = v.trim();
  const m = s.match(/^(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})(?:[T\s,]+)(\d{1,2}[:.h]\d{2}.*)$/i);
  return m ? { fecha: m[1], hora: m[2].trim() } : { fecha: s, hora: null };
}

/**
 * Fecha + hora de reloj → instante UTC en la zona de la CLÍNICA. Devuelve null
 * si esa hora no existe en esa zona (el salto de horario de verano se la come).
 */
export function horaLocalAUtc(
  y: number,
  mes: number,
  d: number,
  h: number,
  mi: number,
  timezone?: string | null,
): Date | null {
  const tz = consentTimeZone(timezone);
  const iso = `${String(y).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let utc = tzLocalToUtc(iso, h, mi, tz);
  const ve = (u: Date) => {
    const p = getTzParts(u, tz);
    return p.year === y && p.month === mes && p.day === d && (p.hour === 24 ? 0 : p.hour) === h && p.minute === mi;
  };
  if (!ve(utc)) {
    // Segunda pasada: la primera se equivoca junto a un cambio de horario.
    const p = getTzParts(utc, tz);
    const visto = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute);
    const queria = Date.UTC(y, mes - 1, d, h, mi);
    utc = new Date(utc.getTime() + (queria - visto));
    if (!ve(utc)) return null;
  }
  return Number.isNaN(utc.getTime()) ? null : utc;
}

/** «05/10/2026 15:30» en la zona indicada, para mensajes. */
export function textoLocal(d: Date, timezone?: string | null): string {
  const p = getTzParts(d, consentTimeZone(timezone));
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(p.day)}/${dos(p.month)}/${p.year} ${dos(p.hour === 24 ? 0 : p.hour)}:${dos(p.minute)}`;
}
