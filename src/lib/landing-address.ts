/* ============================================================
   DIRECCIONES DE CAMPO DEL EDITOR VISUAL.

   Dentro del iframe, cada texto y cada foto llevan pegada una
   DIRECCIÓN: una cadena corta como "sec:servicios:titulo" o
   "servicio:2:price". Esa cadena es lo único que viaja por
   postMessage cuando la clínica termina de escribir.

   Aquí se traduce a una escritura concreta. Dos reglas:

   1. El juego de direcciones es CERRADO. `leerDireccion` solo
      entiende las formas escritas abajo; cualquier otra cosa
      devuelve null y el mensaje se tira. El iframe NO puede pedir
      que se escriba una ruta arbitraria.

   2. Toda dirección aterriza en una COLUMNA de primer nivel que ya
      estaba permitida. El tipo `ColumnaDeTexto` lo obliga: es la
      intersección de CampoEditable (lo que el PATCH acepta,
      @/lib/landing-fields) con LivePreviewField (lo que la vista
      previa acepta, _shared/live-preview). Si una columna faltara en
      cualquiera de las dos listas, esto no compila.

   Sin "use client": lo leen el editor (cliente) y las pruebas.
   ============================================================ */
import type { CampoEditable } from "@/lib/landing-fields";
import type { LivePreviewField } from "@/app/[slug]/_shared/live-preview";
import { allPhotoSlotIds, allSectionIds } from "@/app/[slug]/_shared/template-manifest";
import type {
  CampoDeFaq, CampoDeSeccion, CampoDeServicio, CampoDeTestimonio, ColumnaSuelta,
} from "@/lib/landing-address-parts";

// Las plantillas ARMAN direcciones con estos y no deben arrastrar el
// manifiesto al bundle público; por eso viven en landing-address-parts.
export {
  dirClinica, dirFaq, dirFoto, dirSeccion, dirServicio, dirTestimonio,
} from "@/lib/landing-address-parts";
export type { ColumnaSuelta } from "@/lib/landing-address-parts";

/* ── el mismo juego de formas, ahora con sus datos ───────────
   `satisfies` contra los tipos de landing-address-parts: si una lista
   se separara de la otra, esto deja de compilar. */

/** Cuánto admite cada columna suelta, y si puede quedarse vacía. */
const COLUMNAS_SUELTAS = {
  name:              { etiqueta: "Nombre de la clínica", maxLen: 120,  requerido: true },
  phone:             { etiqueta: "Teléfono",             maxLen: 40,   requerido: false },
  address:           { etiqueta: "Dirección",            maxLen: 300,  requerido: false },
  description:       { etiqueta: "Descripción",          maxLen: 5000, requerido: false },
  landingTagline:    { etiqueta: "Eslogan",              maxLen: 300,  requerido: false },
  landingPatients:   { etiqueta: "Pacientes atendidos",  maxLen: 60,   requerido: false },
  landingUrgentText: { etiqueta: "Aviso de urgencias",   maxLen: 1000, requerido: false },
} satisfies Record<ColumnaSuelta, { etiqueta: string; maxLen: number; requerido: boolean }>;

const CAMPOS_DE_SERVICIO   = ["name", "desc", "price"]  satisfies CampoDeServicio[];
const CAMPOS_DE_FAQ        = ["q", "a"]                 satisfies CampoDeFaq[];
const CAMPOS_DE_TESTIMONIO = ["name", "text", "meta"]   satisfies CampoDeTestimonio[];
const CAMPOS_DE_SECCION    = ["titulo", "subtitulo"]    satisfies CampoDeSeccion[];

/** Las columnas donde el editor visual puede escribir. Ni una más. */
export type ColumnaDeTexto = Extract<
  CampoEditable & LivePreviewField,
  | "name" | "phone" | "address" | "description"
  | "landingTagline" | "landingPatients" | "landingUrgentText"
  | "landingSections" | "landingServices" | "landingFaqs" | "landingTestimonials"
  | "landingPhotos"
>;

/** Índice máximo aceptado en una lista. Coincide con el tope del PATCH. */
const MAX_INDICE = 59;

/** ¿La clave es PROPIA del objeto? Nada de heredarla del prototipo. */
const propia = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export type Direccion =
  | { tipo: "clinica";    columna: ColumnaSuelta }
  | { tipo: "seccion";    seccion: string; campo: CampoDeSeccion }
  | { tipo: "servicio";   indice: number;  campo: CampoDeServicio }
  | { tipo: "faq";        indice: number;  campo: CampoDeFaq }
  | { tipo: "testimonio"; indice: number;  campo: CampoDeTestimonio }
  | { tipo: "foto";       ranura: string };

/* ── leerla (lo usa el editor, con lo que llega del iframe) ──── */

const esIndice = (s: string): number | null => {
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= MAX_INDICE ? n : null;
};

/**
 * Convierte la cadena en una dirección conocida, o devuelve null.
 *
 * Esta función es la frontera: todo lo que entra viene de un
 * postMessage y por tanto es texto de fuera. Nada de construir rutas
 * a partir de trozos de la cadena — cada forma se reconoce entera.
 */
export function leerDireccion(raw: unknown): Direccion | null {
  if (typeof raw !== "string" || raw.length > 80) return null;
  const partes = raw.split(":");

  if (partes.length === 2 && partes[0] === "clinica") {
    const c = partes[1];
    // hasOwnProperty y NO `in`: `in` recorre la cadena de prototipos, así que
    // "clinica:constructor" y "clinica:__proto__" pasarían el filtro y
    // acabarían marcando el borrador como sucio con una columna inventada.
    return propia(COLUMNAS_SUELTAS, c) ? { tipo: "clinica", columna: c as ColumnaSuelta } : null;
  }

  if (partes.length === 2 && partes[0] === "foto") {
    return allPhotoSlotIds().includes(partes[1]) ? { tipo: "foto", ranura: partes[1] } : null;
  }

  if (partes.length !== 3) return null;
  const [tipo, medio, campo] = partes;

  if (tipo === "sec") {
    // Contra el manifiesto, no contra una expresión regular: así el lienzo no
    // puede inventarse secciones que ninguna plantilla pinta y que se quedarían
    // en landingSections para siempre.
    if (!allSectionIds().includes(medio)) return null;
    if (!(CAMPOS_DE_SECCION as readonly string[]).includes(campo)) return null;
    return { tipo: "seccion", seccion: medio, campo: campo as any };
  }

  const indice = esIndice(medio);
  if (indice === null) return null;

  if (tipo === "servicio"   && (CAMPOS_DE_SERVICIO   as readonly string[]).includes(campo)) return { tipo: "servicio",   indice, campo: campo as any };
  if (tipo === "faq"        && (CAMPOS_DE_FAQ        as readonly string[]).includes(campo)) return { tipo: "faq",        indice, campo: campo as any };
  if (tipo === "testimonio" && (CAMPOS_DE_TESTIMONIO as readonly string[]).includes(campo)) return { tipo: "testimonio", indice, campo: campo as any };
  return null;
}

/* ── aplicarla sobre el borrador ─────────────────────────────── */

/** Lo que el editor lleva en memoria; solo las columnas que toca. */
export interface BorradorLanding {
  name: string;
  phone: string | null;
  address: string | null;
  description: string | null;
  landingTagline: string | null;
  landingPatients: string | null;
  landingUrgentText: string | null;
  landingSections: unknown;
  landingServices: unknown;
  landingFaqs: unknown;
  landingTestimonials: unknown;
  landingPhotos: unknown;
}

export interface Escritura {
  columna: ColumnaDeTexto;
  valor: unknown;
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const mapa  = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

/**
 * Texto que se guarda: vacío es null.
 *
 * "Los defaults de la plantilla NUNCA se materializan": si la clínica
 * borra el título de una sección, se guarda null y la plantilla vuelve
 * a pintar SU texto por defecto. Guardar la cadena por defecto la
 * congelaría, y al cambiar de plantilla reaparecería el copy de la
 * anterior.
 */
const limpio = (v: string | null): string | null => {
  if (v === null) return null;
  const t = v.replace(/\r\n/g, "\n").trim();
  return t === "" ? null : t;
};

/**
 * Traduce (dirección, valor) a la escritura de UNA columna permitida.
 *
 * Devuelve null cuando el cambio no aplica: un índice que ya no existe
 * (la clínica borró el servicio en otra pestaña) o un campo obligatorio
 * que quedó vacío. Null = no se toca nada, y el editor deja el texto
 * como estaba.
 */
export function aplicarDireccion(
  borrador: BorradorLanding,
  dir: Direccion,
  valor: string | null,
): Escritura | null {
  const v = limpio(valor);

  if (dir.tipo === "clinica") {
    const meta = COLUMNAS_SUELTAS[dir.columna];
    if (meta.requerido && v === null) return null;
    if (v !== null && v.length > meta.maxLen) return null;
    // `name` es la única columna NOT NULL del grupo.
    return { columna: dir.columna, valor: dir.columna === "name" ? (v as string) : v };
  }

  if (dir.tipo === "foto") {
    const fotos = mapa(borrador.landingPhotos);
    if (v === null) delete fotos[dir.ranura];
    else fotos[dir.ranura] = v;
    return { columna: "landingPhotos", valor: fotos };
  }

  if (dir.tipo === "seccion") {
    if (v !== null && v.length > 2000) return null;
    const actuales = lista(borrador.landingSections);
    const i = actuales.findIndex(s => s?.id === dir.seccion);
    const copia = actuales.map(s => ({ ...s }));
    if (i === -1) copia.push({ id: dir.seccion, visible: true, orden: copia.length, [dir.campo]: v });
    else copia[i] = { ...copia[i], [dir.campo]: v };
    return { columna: "landingSections", valor: copia };
  }

  const columna: ColumnaDeTexto =
    dir.tipo === "servicio" ? "landingServices" :
    dir.tipo === "faq"      ? "landingFaqs"     : "landingTestimonials";

  const actuales = lista(borrador[columna]);
  if (dir.indice >= actuales.length) return null;

  // Sin estos, el elemento desaparece de la lista al pintarla
  // (serviceList / faqList / testimonialList los filtran) y ya no habría
  // dónde volver a hacer clic para recuperarlo.
  const obligatorio =
    (dir.tipo === "servicio"   && dir.campo === "name") ||
    (dir.tipo === "faq") ||
    (dir.tipo === "testimonio" && dir.campo === "text");
  if (obligatorio && v === null) return null;
  if (v !== null && v.length > 2000) return null;

  const copia = actuales.map(x => ({ ...x }));
  copia[dir.indice] = { ...copia[dir.indice], [dir.campo]: v ?? "" };

  // Las FAQs del formulario viejo son {question, answer}; faqList lee las dos
  // formas. Al escribir se pasa el elemento entero a {q, a} — arrastrando el
  // campo que NO se tocó, que si no se perdería.
  if (dir.tipo === "faq") {
    const item = copia[dir.indice] as any;
    if (typeof item.q !== "string") item.q = typeof item.question === "string" ? item.question : "";
    if (typeof item.a !== "string") item.a = typeof item.answer === "string" ? item.answer : "";
    delete item.question;
    delete item.answer;
  }

  return { columna, valor: copia };
}
