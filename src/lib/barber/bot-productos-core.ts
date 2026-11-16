/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — lo que el BOT de WhatsApp sabe de la TIENDA.
   Núcleo puro (sin prisma ni "server-only"): se prueba sin base.

   Rafael (16-nov): «¿ya tiene acceso el bot de WhatsApp para mandar los
   productos?». Ahora sí, con estas reglas:

   · Solo conoce lo que la tienda pública enseña: activos y con «Mostrar en
     mi página». Lo oculto no existe para el bot (la lista viene de
     loadTienda, la MISMA de /b/<slug>/tienda).
   · De la existencia solo sabe SI HAY o NO (ya restado lo apartado). Jamás
     el número ni el costo: esos campos no llegan al modelo.
   · No aparta en el chat: manda la liga del producto (o de la tienda si son
     varios) y ahí se aparta con folio (y se paga en línea si la barbería
     conectó Mercado Pago). Agotado → lo dice y NO hay liga de apartar.
   · El costo no se dispara: al modelo van como mucho
     BARBER_BOT_PRODUCTS_MAX productos por consulta — los que coinciden con
     lo que pregunta, o si no, los más vendidos.
   ═══════════════════════════════════════════════════════════════════════ */

/** Tope de productos por respuesta de la herramienta (cuida tokens). */
export const BARBER_BOT_PRODUCTS_MAX = 8;

/** Lo que el bot lee de cada producto de la tienda (subconjunto de TiendaProduct). */
export interface BotStoreProduct {
  id: string;
  name: string;
  category: string | null;
  price: number;
  /** Stock − apartado (nunca negativo). Solo se usa para «hay / no hay». */
  available: number;
  /** Se puede apartar en línea (interruptor del producto + tabla de pedidos). */
  orderable: boolean;
}

/** Lo que de verdad viaja al modelo por producto. Sin existencias ni costo. */
export interface BotProductView {
  nombre: string;
  categoria: string | null;
  precio: string;
  hay: boolean;
  /** Liga del producto, SOLO si hay. Agotado = sin liga. */
  liga: string | null;
  /** true = en la liga se aparta con folio. false = solo se ve; se compra en la barbería. */
  seApartaEnLinea: boolean;
}

/** Minúsculas, sin acentos ni signos: «Pomáda!» → «pomada». */
export function normalizeProductText(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras que no dicen qué producto busca («¿tienen la cera para el pelo?»). */
const STOPWORDS = new Set([
  "tienen", "tienes", "hay", "venden", "vendes", "cuanto", "cuesta", "cuestan", "precio", "precios",
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "para", "que", "y", "o", "en",
  "me", "mi", "su", "sus", "con", "por", "algo", "algun", "alguna", "producto", "productos", "tienda",
  "quiero", "busco", "necesito", "vende", "venta", "es", "son", "a", "al", "lo", "le", "qué", "pelo",
  "cabello",
]);

function tokens(query: string): string[] {
  return normalizeProductText(query)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    // «ceras» → «cera», «pomadas» → «pomada»: plural simple del español.
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

export interface BotProductPick {
  /** Productos elegidos, en el orden en que se le dan al modelo. */
  products: BotStoreProduct[];
  /** ¿La pregunta nombró algo y SÍ hubo coincidencias? */
  matched: boolean;
  /** ¿La pregunta nombró algo concreto? (si sí y no hubo coincidencia → «no lo manejamos»). */
  askedSomething: boolean;
  /** Cuántos productos hay en la tienda en total. */
  total: number;
}

/**
 * Qué productos se le dan al modelo para esta pregunta.
 *   · Si la pregunta nombra algo («cera», «pomada mate»): los que coinciden
 *     en nombre o categoría, primero los que tienen más palabras en común.
 *   · Si no nombra nada («¿qué venden?»), o nada coincide: los más vendidos
 *     (salesRank: id → piezas vendidas), luego por nombre.
 * Siempre como mucho `max`.
 */
export function pickBotProducts(
  all: BotStoreProduct[],
  query: string | null | undefined,
  salesRank: ReadonlyMap<string, number> = new Map(),
  max: number = BARBER_BOT_PRODUCTS_MAX,
): BotProductPick {
  const words = tokens(query ?? "");
  const bySales = (a: BotStoreProduct, b: BotStoreProduct) =>
    (salesRank.get(b.id) ?? 0) - (salesRank.get(a.id) ?? 0) || a.name.localeCompare(b.name, "es");

  if (words.length > 0) {
    const scored = all
      .map((p) => {
        const hay = normalizeProductText(`${p.name} ${p.category ?? ""}`);
        const score = words.filter((w) => hay.includes(w)).length;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || bySales(a.p, b.p));
    if (scored.length > 0) {
      return { products: scored.slice(0, max).map((x) => x.p), matched: true, askedSomething: true, total: all.length };
    }
  }
  return {
    products: [...all].sort(bySales).slice(0, max),
    matched: false,
    askedSomething: words.length > 0,
    total: all.length,
  };
}

/** Base pública absoluta para las ligas que se mandan por WhatsApp. */
export function botPublicBase(env: { [k: string]: string | undefined } = process.env): string {
  const raw = env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "");
  const base = (raw || "https://www.dalecontrol.com").trim().replace(/\/+$/, "");
  return base.startsWith("http") ? base : `https://${base}`;
}

function money(value: number): string {
  // Mismo formato que los precios de servicios del bot ($180), con centavos si los trae.
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** Producto → lo que ve el modelo. Agotado no lleva liga. */
export function botProductView(p: BotStoreProduct, productUrl: string): BotProductView {
  const hay = p.available > 0;
  return {
    nombre: p.name,
    categoria: p.category,
    precio: money(p.price),
    hay,
    liga: hay ? productUrl : null,
    seApartaEnLinea: hay && p.orderable,
  };
}
