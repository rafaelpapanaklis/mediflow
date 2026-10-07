import { foldAccents } from "./booking-parse";

// ws1-t3 (auditoría BEVADENT) — el menú de «¿qué necesitas?» del bot al agendar.
// Antes era TODO el catálogo activo, alfabético y con tope de 24: en un catálogo
// grande lo posterior a la «C» nunca salía. Ahora es corto:
//   A) de fábrica: Consulta o valoración · Limpieza · Urgencia o dolor ·
//      (Control de ortodoncia) · Otro tratamiento.
//   B) ws1-t9: la clínica elige las genéricas (casillas en Configurar bot) y marca
//      procedimientos «Se agenda por WhatsApp»; el menú los combina (máx. 8) + Otro tratamiento.
// Puro y sin base de datos: lo prueban los tests de los turnos del bot.

export const MAX_MARCADOS_EN_MENU = 8;

export type TipoMenu = "consulta" | "limpieza" | "urgencia" | "orto" | "otro";
export const PREFIJO_MENU = "menu:";
export const idMenu = (t: TipoMenu): string => `${PREFIJO_MENU}${t}`;
export function tipoDeId(id: string): TipoMenu | null {
  if (!id.startsWith(PREFIJO_MENU)) return null;
  const t = id.slice(PREFIJO_MENU.length);
  return t === "consulta" || t === "limpieza" || t === "urgencia" || t === "orto" || t === "otro" ? t : null;
}

export const ETIQUETA_MENU: Record<TipoMenu, string> = {
  consulta: "Consulta o valoración",
  limpieza: "Limpieza",
  urgencia: "Urgencia o dolor",
  orto: "Control de ortodoncia",
  otro: "Otro tratamiento",
};

export interface FilaCatalogo {
  id: string;
  name: string;
  duration: number | null;
}
export interface OpcionMenu {
  id: string;
  label: string;
}

/** Las tres opciones genéricas que la clínica puede marcar o desmarcar en «Configurar bot». */
export type TipoGenerico = "consulta" | "limpieza" | "urgencia";
export const TIPOS_GENERICOS: readonly TipoGenerico[] = ["consulta", "limpieza", "urgencia"];
export type GenericasBot = Record<TipoGenerico, boolean>;
/** Sin la columna (o sin config): todas activas, como era hasta ahora. */
export const GENERICAS_DE_FABRICA: GenericasBot = Object.freeze({ consulta: true, limpieza: true, urgencia: true });

/** De cualquier valor suelto (JSON de la base o del body) a las tres casillas; lo que no sea `false` cuenta como activo. */
export function normalizarGenericas(v: unknown): GenericasBot {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    consulta: o.consulta !== false,
    limpieza: o.limpieza !== false,
    urgencia: o.urgencia !== false,
  };
}

/**
 * ws1-t9 — las opciones del menú, en orden:
 * genéricas marcadas · Control de ortodoncia (si aplica) · procedimientos marcados · Otro tratamiento.
 * Las genéricas y los procedimientos se COMBINAN (ya no se ocultan unas por marcar otros).
 * Si no queda nada marcado, vuelven las genéricas de fábrica para no dejar el menú vacío.
 * Tope de MAX_MARCADOS_EN_MENU opciones antes de «Otro tratamiento»: lo que sobra son
 * los últimos procedimientos (alfabético); las genéricas y el control van primero.
 */
export function construirMenu(p: {
  marcados: FilaCatalogo[];
  conOrto: boolean;
  genericas?: GenericasBot;
}): OpcionMenu[] {
  const g = p.genericas ?? GENERICAS_DE_FABRICA;
  let tipos: TipoGenerico[] = TIPOS_GENERICOS.filter((t) => g[t]);
  if (tipos.length === 0 && p.marcados.length === 0) tipos = [...TIPOS_GENERICOS];
  const delTipo: OpcionMenu[] = tipos.map((t) => ({ id: idMenu(t), label: ETIQUETA_MENU[t] }));
  const orto: OpcionMenu[] = p.conOrto ? [{ id: idMenu("orto"), label: ETIQUETA_MENU.orto }] : [];
  const procs: OpcionMenu[] = p.marcados.map((s) => ({
    id: s.id,
    label: s.duration ? `${s.name} (${s.duration} min)` : s.name,
  }));
  return [...delTipo, ...orto, ...procs].slice(0, MAX_MARCADOS_EN_MENU).concat({ id: idMenu("otro"), label: ETIQUETA_MENU.otro });
}

/** Cuántas opciones pide la clínica antes de «Otro tratamiento» (para avisar en pantalla si pasa del tope). */
export function opcionesPedidas(genericas: GenericasBot, nProcedimientos: number): number {
  return TIPOS_GENERICOS.filter((t) => genericas[t]).length + nProcedimientos;
}

const PATRON_CATALOGO: Partial<Record<TipoMenu, RegExp[]>> = {
  consulta: [/\bvaloracion\b/, /\bconsulta\b/, /\brevision\b/],
  limpieza: [/\blimpieza\b/, /\bprofilaxis\b/],
  urgencia: [/\burgencia\b/, /\bemergencia\b/],
};

/** El procedimiento del catálogo que corresponde a una opción de fábrica, si existe. */
export function casarConCatalogo(tipo: TipoMenu, catalogo: FilaCatalogo[]): FilaCatalogo | null {
  const patrones = PATRON_CATALOGO[tipo];
  if (!patrones) return null;
  const candidatas = catalogo.filter((c) => !/ortodon/.test(foldAccents(c.name)));
  for (const re of patrones) {
    const hit = candidatas.find((c) => re.test(foldAccents(c.name)));
    if (hit) return hit;
  }
  return null;
}

const RE_NUMERO_SOLO = /^\s*(opcion\s*)?\d{1,2}\s*[.)]?\s*$/;
export const esNumeroSolo = (t: string): boolean => RE_NUMERO_SOLO.test(foldAccents(t));

const RE_TIPO: Array<[TipoMenu, RegExp]> = [
  ["otro", /^(otro|otra|otros|otras)\b|\botro tratamiento\b/],
  ["urgencia", /urgen|emergencia|\bduele|\bdolor|molest|muela|inflam|sangr|hinch|se me (rompio|cayo|safo)/],
  ["orto", /ortodon|bracket|alineador|invisalign/],
  ["limpieza", /limpieza|profilaxis|sarro/],
  ["consulta", /consulta|valoracion|revision|chequeo|check ?up|primera vez/],
];

/**
 * Entiende una respuesta escrita («limpieza», «me duele una muela») contra las
 * opciones del menú. Devuelve el índice o null. Los procedimientos marcados por
 * la clínica se casan por nombre; las opciones de fábrica, por palabras clave.
 */
export function indiceDeRespuesta(texto: string, opciones: OpcionMenu[]): number | null {
  const t = foldAccents(texto).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Procedimientos marcados: el nombre dentro de lo escrito, o lo escrito (≥4 letras) dentro del nombre.
  const porNombre = opciones.findIndex((o) => {
    if (tipoDeId(o.id)) return false;
    const n = foldAccents(o.label.replace(/\s*\(\d+ min\)\s*$/, "")).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
    return n.length > 0 && (t.includes(n) || (t.length >= 4 && n.includes(t)));
  });
  if (porNombre >= 0) return porNombre;
  for (const [tipo, re] of RE_TIPO) {
    if (!re.test(t)) continue;
    const idx = opciones.findIndex((o) => tipoDeId(o.id) === tipo);
    if (idx >= 0) return idx;
  }
  return null;
}

export const MAX_TEXTO_OTRO = 120;
/** «Otro tratamiento»: la frase del paciente, limpia y acotada para la nota de la cita. */
export function limpiarTextoOtro(t: string): string {
  return t.replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO_OTRO);
}
