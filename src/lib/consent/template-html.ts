// ─────────────────────────────────────────────────────────────────────────────
// Ida y vuelta entre el HTML de una plantilla y el TEXTO PLANO de la carta.
//
// `DocumentTemplate.body` guarda HTML (el del editor de Administración →
// Plantillas). La carta de consentimiento, en cambio, se firma como TEXTO PLANO:
// es el snapshot que sella `contentHash`, el que lee el paciente en su teléfono
// y el que imprime el PDF. Entre los dos mundos solo hay estas dos funciones.
//
//   · `consentTextToHtml`  — para SEMBRAR las plantillas del catálogo;
//   · `consentHtmlToText`  — para convertir la plantilla (ya editada por la
//     clínica, con las etiquetas que sea) en el texto que se va a firmar.
//
// El HTML que sale de aquí usa solo <h1>, <h2>, <p>, <ul> y <li>, con el texto
// escapado: no hay saneador razonable que lo rechace.
//
// PURO: sin DOM, sin Prisma y sin red. Corre igual en el servidor y en el test.
// ─────────────────────────────────────────────────────────────────────────────

import { parseConsentText, splitConsentBody } from "./render";

/**
 * Marca interna de "aquí va una línea en blanco" (carácter NUL) y espacio duro.
 * Se construyen con `String.fromCharCode` en vez de escribirse como literal: un
 * editor que no respete el archivo los corrompe en silencio.
 */
const GAP = String.fromCharCode(0);
const SPACES = new RegExp("[ \\t" + String.fromCharCode(0xa0) + "]+", "g");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * `grouped`: los renglones seguidos de un mismo bloque van en UN <p> separados por
 * <br> ("Nombre: …", "Edad: …" juntos, como en el PDF). Solo para PINTAR la hoja:
 * al sembrar plantillas no se usa, porque ahí cada renglón tiene que volver a ser
 * un renglón al hacer el camino de vuelta.
 */
function bodyToHtml(body: string, grouped = false): string {
  return splitConsentBody(body)
    .map((block) =>
      block.kind === "bullets"
        ? `<ul>${block.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : grouped
          ? `<p>${block.lines.map(escapeHtml).join("<br>")}</p>`
          // Un renglón = un párrafo: "Nombre: …" y "Edad: …" no se funden.
          : block.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(""),
    )
    .join("");
}

/** Carta en texto plano → HTML de plantilla. */
export function consentTextToHtml(text: string): string {
  const doc = parseConsentText(text);
  const parts: string[] = [];
  if (doc.title) parts.push(`<h1>${escapeHtml(doc.title)}</h1>`);
  if (doc.preamble) parts.push(bodyToHtml(doc.preamble));
  for (const section of doc.sections) {
    const heading = section.number == null ? section.title : `${section.number}. ${section.title}`;
    parts.push(`<h2>${escapeHtml(heading)}</h2>`);
    parts.push(bodyToHtml(section.body));
  }
  return parts.join("\n");
}

/**
 * Carta en texto plano → HTML del CUERPO de la hoja del panel.
 *
 * Igual que `consentTextToHtml` pero sin el <h1>: en la hoja el título ya lo
 * pone la cabecera del documento, y repetirlo arriba del texto lo duplicaba. El
 * texto guardado NO se toca: esto solo lo presenta. Una carta sin secciones
 * numeradas (las del sistema viejo, o una reescrita a mano) sale entera como
 * párrafos: no puede desaparecer por no seguir el formato.
 *
 * Solo <h2>, <p>, <br>, <ul> y <li>, sin atributos y con el texto escapado: es lo
 * único que autoriza a inyectarlo en `DocumentoCuerpo`.
 */
export function consentTextToBodyHtml(text: string): string {
  const doc = parseConsentText(text);
  const parts: string[] = [];
  if (doc.preamble) parts.push(bodyToHtml(doc.preamble, true));
  for (const section of doc.sections) {
    const heading = section.number == null ? section.title : `${section.number}. ${section.title}`;
    parts.push(`<h2>${escapeHtml(heading)}</h2>`);
    parts.push(bodyToHtml(section.body, true));
  }
  return parts.join("\n");
}

/**
 * HTML de plantilla → carta en texto plano.
 *
 * Tolerante a propósito: la clínica edita la plantilla en un editor que todavía
 * no conocemos, así que no se asume ninguna estructura. Todo cierre de bloque es
 * un salto de línea, cada <li> una viñeta "• " y el resto de las etiquetas se
 * van. Las líneas EN BLANCO salen solo de tres sitios —antes de un encabezado,
 * después del título <h1> y de un párrafo vacío que la clínica deje adrede—: si
 * salieran de cada cierre de bloque, las viñetas quedarían separadas entre sí y
 * la carta sembrada no volvería a ser el texto del catálogo.
 *
 * <script> y <style> se quitan CON su contenido: aunque el saneador ya los
 * habrá filtrado, su texto jamás puede acabar impreso en un documento legal.
 */
export function consentHtmlToText(html: string): string {
  const text = (html ?? "")
    .split(GAP).join("")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Los saltos del fuente no significan nada en HTML; los de verdad salen de
    // las etiquetas de bloque.
    .replace(/[\r\n]+/g, " ")
    .replace(/<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p\s*>/gi, `\n${GAP}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<h[1-6]\b[^>]*>/gi, `\n${GAP}\n`)
    .replace(/<\/h1\s*>/gi, `\n${GAP}\n`)
    .replace(/<\/?(p|div|h[2-6]|li|ul|ol|tr|table|blockquote|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const lines = decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(SPACES, " ").trim())
    // Las líneas vacías de los cierres de bloque se van; quedan las marcadas.
    .filter((line) => line !== "")
    .map((line) => (line === GAP ? "" : line));

  // Como mucho UNA línea en blanco seguida, y ninguna al principio ni al final.
  const out: string[] = [];
  // Los editores tipo TipTap escriben <li><p>Texto</p></li>: la viñeta queda
  // sola en su renglón y el texto en el siguiente. Se vuelven a juntar.
  let orphanBullet = false;
  for (const raw of lines) {
    if (raw === "•") { orphanBullet = true; continue; }
    const line = orphanBullet && raw !== "" && !raw.startsWith("• ") ? `• ${raw}` : raw;
    if (raw !== "") orphanBullet = false;
    if (orphanBullet) continue;
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
