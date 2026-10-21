// Lo que pasa entre el HTML GUARDADO (document_templates.body, patient_documents.body:
// el formato de siempre, con marcadores `[NOMBRE_PACIENTE]` en el texto) y el HTML
// que entiende el editor (fichas `<span data-marcador>`), y la vuelta: lo que el
// editor serializa se NORMALIZA al contrato antes de viajar al servidor.
//
// PURO: cadenas, sin DOM. El HTML que entra aquí es siempre bien formado (lo
// escribió el saneador del servidor o ProseMirror), por eso un tokenizador de
// etiquetas basta y no hace falta un parser. El servidor vuelve a sanear de
// todas formas: esto es para que lo guardado sea igual a lo de siempre, no una
// barrera de seguridad.

import { PATRON_MARCADOR } from "./contrato";

// ── Tokenizador mínimo ──────────────────────────────────────────────────────

interface Etiqueta {
  tipo: "etiqueta";
  nombre: string;
  cierre: boolean;
  texto: string;
}
interface Texto {
  tipo: "texto";
  texto: string;
}
type Token = Etiqueta | Texto;

const VACIAS = new Set(["br", "img", "hr", "col"]);

function tokenizar(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const t = m[0];
    if (t.startsWith("<!--")) continue;
    const e = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(t);
    if (e) tokens.push({ tipo: "etiqueta", nombre: e[2].toLowerCase(), cierre: e[1] === "/", texto: t });
    else tokens.push({ tipo: "texto", texto: t });
  }
  return tokens;
}

/** Los atributos de una etiqueta de apertura, en orden, como pares (nombre, valor). */
function atributosDe(texto: string): [string, string][] {
  const cuerpo = texto.replace(/^<[a-zA-Z][a-zA-Z0-9]*/, "").replace(/\/?>$/, "");
  const pares: [string, string][] = [];
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cuerpo))) {
    const nombre = m[1].toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(nombre)) continue;
    pares.push([nombre, m[2] ?? m[3] ?? m[4] ?? ""]);
  }
  return pares;
}

// ── Marcadores ⇄ fichas ─────────────────────────────────────────────────────

/**
 * `[NOMBRE_PACIENTE]` en el TEXTO → `<span data-marcador="NOMBRE_PACIENTE"></span>`,
 * solo para las claves conocidas. Lo que no sea una clave se queda escrito tal cual.
 */
export function marcadoresAFichas(html: string, claves: Iterable<string>): string {
  const conocidas = new Set(claves);
  if (!conocidas.size) return html;
  return tokenizar(html)
    .map((t) =>
      t.tipo === "texto"
        ? t.texto.replace(PATRON_MARCADOR, (todo, clave: string) =>
            conocidas.has(clave) ? `<span data-marcador="${clave}"></span>` : todo,
          )
        : t.texto,
    )
    .join("");
}

/** La vuelta: cada ficha pasa a ser `[CLAVE]`, el formato que rellena `interpolateConsent`. */
export function fichasAMarcadores(html: string): string {
  return html.replace(
    /<span\b[^>]*\bdata-marcador="([A-Z][A-Z0-9_]*)"[^>]*>(?:\s|&nbsp;)*<\/span>/g,
    (_todo, clave: string) => `[${clave}]`,
  );
}

// ── Normalización al guardar ────────────────────────────────────────────────

/** Qué atributos conserva cada etiqueta. Fuera de esta tabla no sobrevive ninguno. */
const ATRIBUTOS: Readonly<Record<string, readonly string[]>> = {
  p: ["data-sangria", "data-alineacion"],
  h1: ["data-sangria", "data-alineacion"],
  h2: ["data-sangria", "data-alineacion"],
  h3: ["data-sangria", "data-alineacion"],
  span: ["data-tamano"],
  img: ["data-archivo", "data-ancho", "data-alineacion", "alt"],
  div: ["data-tipo", "data-n", "data-lado"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

function etiquetaLimpia(t: Etiqueta): string {
  if (t.cierre) return `</${t.nombre}>`;
  const permitidos = ATRIBUTOS[t.nombre] ?? [];
  const partes: string[] = [];
  for (const [nombre, valor] of atributosDe(t.texto)) {
    if (!permitidos.includes(nombre)) continue;
    // colspan="1" / rowspan="1" es «sin unir»: no se escribe, como no se escribía antes.
    if ((nombre === "colspan" || nombre === "rowspan") && (valor === "1" || valor === "")) continue;
    partes.push(`${nombre}="${valor.replace(/"/g, "&quot;")}"`);
  }
  return `<${t.nombre}${partes.length ? " " + partes.join(" ") : ""}>`;
}

/**
 * El HTML que serializa el editor, listo para el servidor:
 *  - fichas → `[CLAVE]`;
 *  - `<li><p>texto</p></li>` → `<li>texto</li>` (párrafos extra dentro del ítem se separan con `<br>`),
 *    que es como lo escribía el editor viejo y como lo lee el PDF de hoy;
 *  - sin `<colgroup>` ni `<col>` (ancho de columnas de la tabla: no se guarda);
 *  - solo los atributos del contrato, sin `style`, `class`, `src` ni `colspan="1"`.
 */
export function normalizarParaGuardar(html: string): string {
  const tokens = tokenizar(fichasAMarcadores(html));
  const salida: string[] = [];
  // Pila de etiquetas abiertas; para cada <li> se anota si ya se vio su primer hijo.
  const pila: { nombre: string; esLi: boolean; hijos: number; pEnLi: "quitar" | "br" | null }[] = [];
  let enColgroup = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.tipo === "texto") {
      if (enColgroup) continue;
      salida.push(t.texto);
      const padre = pila[pila.length - 1];
      if (padre && t.texto.trim()) padre.hijos++;
      continue;
    }
    if (t.nombre === "colgroup" || t.nombre === "col") {
      if (t.nombre === "colgroup") enColgroup += t.cierre ? -1 : 1;
      continue;
    }
    if (enColgroup) continue;

    if (!t.cierre) {
      const padre = pila[pila.length - 1];
      let pEnLi: "quitar" | "br" | null = null;
      if (t.nombre === "p" && padre?.esLi) {
        // Primer párrafo del ítem: se quita. Los siguientes: un <br> en su lugar.
        pEnLi = padre.hijos === 0 ? "quitar" : "br";
        salida.push(pEnLi === "br" ? "<br>" : "");
      } else {
        salida.push(etiquetaLimpia(t));
      }
      if (padre) padre.hijos++;
      if (!VACIAS.has(t.nombre)) pila.push({ nombre: t.nombre, esLi: t.nombre === "li", hijos: 0, pEnLi });
      continue;
    }
    // Cierre: se saca de la pila la apertura que le corresponde.
    let abierta = pila.pop();
    while (abierta && abierta.nombre !== t.nombre) abierta = pila.pop();
    if (abierta?.pEnLi) continue; // el </p> de un párrafo quitado o convertido en <br>
    salida.push(`</${t.nombre}>`);
  }
  return salida.join("");
}

/** Sin texto, sin imagen y sin tabla: no hay nada que guardar. */
export function estaVacioHtml(html: string): boolean {
  if (/<(img|table)\b/i.test(html)) return false;
  const texto = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/ /g, " ");
  return texto.trim().length === 0;
}

/** El HTML guardado, listo para el editor: las claves conocidas pasan a fichas. */
export function htmlParaEditor(html: string, claves: Iterable<string>): string {
  return marcadoresAFichas(html ?? "", claves);
}
