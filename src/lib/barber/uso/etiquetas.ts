// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — USO DEL PANEL: qué texto de botón se puede GUARDAR.
//
// El texto de un botón puede traer datos de un cliente: una lista de
// clientes son botones con nombres, «Cobrar $720.00» lleva un monto,
// «Llamar a …» un teléfono. Regla: solo se guarda un texto que sea DEL PANEL,
// es decir, que esté en el diccionario de barber (es o en). Si el texto del
// diccionario lleva un hueco («Cobrar {amount}»), se guarda la PLANTILLA y
// nunca lo que llenó el hueco. Cualquier otro texto se tira.
//
// PURO salvo `etiquetaDelPanel`, que carga los diccionarios una sola vez.
// ═══════════════════════════════════════════════════════════════════════
import type { Dictionary } from "@/i18n/t";
import { getBarberDict } from "@/i18n/dictionaries/barber";

/** Un texto del diccionario más largo que esto no es un botón: no se usa. */
const MAX_TEXTO_BOTON = 60;
/** Lo fijo de una plantilla con hueco tiene que tener al menos esto (sin espacios). */
const MIN_FIJO_PLANTILLA = 3;

export interface ComparadorEtiquetas {
  /** El texto (o la plantilla) del panel que corresponde a `etiqueta`, o null. */
  (etiqueta: string | null | undefined): string | null;
}

function normalizar(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/\d/g, "0").toLowerCase();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textosDe(dict: Dictionary, salida: string[]): void {
  for (const v of Object.values(dict)) {
    if (typeof v === "string") salida.push(v);
    else if (v && typeof v === "object") textosDe(v, salida);
  }
}

/** Arma el comparador a partir de diccionarios (las pruebas le pasan los suyos). */
export function crearComparadorEtiquetas(dicts: Dictionary[]): ComparadorEtiquetas {
  const exactos = new Map<string, string>();
  const plantillas: Array<{ re: RegExp; plantilla: string }> = [];
  const vistos = new Set<string>();

  const todos: string[] = [];
  for (const d of dicts) textosDe(d, todos);

  for (const texto of todos) {
    const t = texto.replace(/\s+/g, " ").trim();
    if (!t || t.length > MAX_TEXTO_BOTON || vistos.has(t)) continue;
    vistos.add(t);
    if (/\{[^}]+\}/.test(t)) {
      // Lo fijo (sin los huecos) tiene que decir algo: «{name}» solo
      // aceptaría cualquier texto, y eso es justo lo que no se quiere.
      const fijo = t.replace(/\{[^}]+\}/g, "").replace(/[\s.,:;·—–-]/g, "");
      if (fijo.length < MIN_FIJO_PLANTILLA) continue;
      const partes = t.split(/\{[^}]+\}/).map((p) => escaparRegex(normalizar(p)));
      plantillas.push({ re: new RegExp(`^${partes.join(".+?")}$`), plantilla: t });
    } else {
      const k = normalizar(t);
      if (!exactos.has(k)) exactos.set(k, t);
    }
  }
  // La plantilla más ESPECÍFICA primero (más texto fijo): «Cobrar {amount} en efectivo»
  // antes que «Cobrar {amount}».
  plantillas.sort((a, b) => b.re.source.length - a.re.source.length);

  return (etiqueta) => {
    if (typeof etiqueta !== "string") return null;
    const k = normalizar(etiqueta);
    if (!k) return null;
    const exacto = exactos.get(k);
    if (exacto) return exacto;
    for (const p of plantillas) if (p.re.test(k)) return p.plantilla;
    return null;
  };
}

let comparador: ComparadorEtiquetas | null = null;

/** El texto del panel (es o en) que corresponde a la etiqueta, o null. */
export function etiquetaDelPanel(etiqueta: string | null | undefined): string | null {
  if (!comparador) comparador = crearComparadorEtiquetas([getBarberDict("es"), getBarberDict("en")]);
  return comparador(etiqueta);
}
