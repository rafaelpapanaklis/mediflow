// ─────────────────────────────────────────────────────────────────────────────
// Lector de la carta de consentimiento: texto plano → secciones tituladas.
//
// El contenido se guarda como TEXTO PLANO y así debe seguir (es el snapshot que
// se firma, el que imprime el PDF y el que sella `contentHash`; meter HTML ahí
// sería empezar a tener dos versiones del mismo documento). Pero pintarlo como
// un único bloque `pre-wrap` es lo que hacía que la carta se viera como un
// volcado de terminal — en el modal del panel y, peor, en el teléfono del
// paciente.
//
// Este módulo es la pieza intermedia: PARTE el texto para presentarlo, sin
// tocarlo. Lo consumen el modal de alta (vista previa) y la página pública
// `/consentimiento/[token]`, para que las dos superficies lean la misma carta
// exactamente igual.
//
// PURO: sin React, sin Prisma, sin red.
// ─────────────────────────────────────────────────────────────────────────────

/** Una sección numerada de la carta ("3. ACTO QUE SE AUTORIZA" + su cuerpo). */
export interface ConsentSection {
  /** Número del encabezado. `null` cuando la sección no venía numerada. */
  number: number | null;
  /** Encabezado sin el número: "ACTO QUE SE AUTORIZA". */
  title: string;
  /** Cuerpo íntegro, con sus saltos de línea y sus viñetas "• ". */
  body: string;
}

export interface ParsedConsent {
  /** Título del documento ("CARTA DE CONSENTIMIENTO INFORMADO"). "" si no hay. */
  title: string;
  /** Lo que va antes de la primera sección: establecimiento, lugar y fecha. */
  preamble: string;
  /** Secciones en el orden del documento. VACÍO si el texto no las tiene. */
  sections: ConsentSection[];
}

/**
 * Encabezado candidato: "12. FIRMAS". Tope de 80 caracteres porque un párrafo
 * que empiece con un número no es un título.
 */
const HEADING_RE = /^(\d{1,2})\.\s+(\S[^\n]{0,79})$/;

/**
 * ¿La línea es un encabezado de sección?
 *
 * Además del número exige MAYÚSCULAS, y esa es la parte que importa: el
 * profesional puede editar la carta antes de crearla y escribir su propia lista
 * numerada dentro de un apartado ("1. Tomar el analgésico cada 8 horas"). Sin
 * este requisito esa lista partiría el documento en secciones falsas y el
 * paciente vería la carta descuartizada.
 */
function matchHeading(line: string): { number: number; title: string } | null {
  const m = line.trim().match(HEADING_RE);
  if (!m) return null;
  const title = m[2]!.trim();
  if (title !== title.toLocaleUpperCase("es-MX")) return null;
  return { number: Number(m[1]), title };
}

/**
 * Título del documento: la primera línea, si va en mayúsculas y no es un dato
 * con etiqueta ("Establecimiento: Clínica X" se queda en el preámbulo).
 */
function isDocTitle(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > 90 || s.includes(":")) return false;
  return s === s.toLocaleUpperCase("es-MX") && /[A-ZÁÉÍÓÚÑÜ]/.test(s);
}

/** Quita las líneas en blanco del principio y del final (las de en medio no). */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * Parte la carta en secciones.
 *
 * Si el texto no trae encabezados numerados —porque el profesional lo reescribió
 * a mano— `sections` sale VACÍO y todo el contenido queda en `preamble`. Quien
 * pinta debe contemplar ese caso y mostrar el texto tal cual: la carta es lo que
 * el paciente firma, no puede desaparecer porque no siga el formato esperado.
 */
export function parseConsentText(text: string): ParsedConsent {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");

  const head: string[] = [];
  const sections: ConsentSection[] = [];
  let current: { number: number; title: string; body: string[] } | null = null;

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      if (current) {
        sections.push({
          number: current.number,
          title: current.title,
          body: trimBlankLines(current.body).join("\n"),
        });
      }
      current = { number: heading.number, title: heading.title, body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else head.push(line);
  }
  if (current) {
    sections.push({
      number: current.number,
      title: current.title,
      body: trimBlankLines(current.body).join("\n"),
    });
  }

  const headLines = trimBlankLines(head);
  let title = "";
  if (headLines.length > 0 && isDocTitle(headLines[0]!)) {
    title = headLines.shift()!.trim();
  }

  return {
    title,
    preamble: trimBlankLines(headLines).join("\n"),
    sections,
  };
}

/**
 * Cuerpo de una sección partido en párrafos y viñetas, listo para pintar.
 *
 * Las viñetas se generan con "• " en `buildConsentContent`; aquí se reconocen
 * para poder maquetarlas como lista en vez de como un párrafo que empieza por
 * un punto suelto.
 */
export interface ConsentBlock {
  kind: "paragraph" | "bullets";
  /**
   * Renglones del bloque. NO se concatenan: en esta carta cada renglón es una
   * unidad ("Nombre del paciente: …", "Edad: …", "Número de expediente: …" van
   * seguidos y sin línea en blanco entre ellos). Quien pinta debe respetar el
   * corte de línea y separar los BLOQUES con más aire que los renglones.
   */
  lines: string[];
}

export function splitConsentBody(body: string): ConsentBlock[] {
  const blocks: ConsentBlock[] = [];
  for (const line of (body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bullet = /^[•·*-]\s+(.*)$/.exec(trimmed);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === "bullets") last.lines.push(bullet[1]!.trim());
      else blocks.push({ kind: "bullets", lines: [bullet[1]!.trim()] });
    } else if (last?.kind === "paragraph") {
      // Renglones consecutivos = el mismo párrafo. El generador ya separa los
      // apartados con línea en blanco, así que unirlos no pega dos ideas.
      last.lines.push(trimmed);
    } else {
      blocks.push({ kind: "paragraph", lines: [trimmed] });
    }
  }
  return blocks;
}
