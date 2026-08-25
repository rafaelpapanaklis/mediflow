// ═══════════════════════════════════════════════════════════════════════
// REGISTRO DE ADAPTADORES + CATÁLOGO DE DESTINOS.
//
// Esta es la pieza que hace que mañana enchufar un portal nuevo sea AGREGAR
// UN ARCHIVO y una fila aquí, no rehacer el módulo. Ver README.md.
//
// 🔴 POR QUÉ NO HAY CONECTOR A INMUEBLES24, LAMUDI NI CASAS Y TERRENOS.
// No existe "una API de portales inmobiliarios". Los tres grandes de México
// no publican API abierta: se entra por CONVENIO COMERCIAL, y esa gestión
// todavía no está hecha. Construir un conector contra credenciales que no
// tenemos sería código muerto que además hace creer al equipo de ventas que
// la función existe. Aparecen en el catálogo marcados como NO DISPONIBLES,
// con el motivo escrito, porque el asesor VA a preguntar por ellos y la
// pantalla tiene que contestarle la verdad.
//
// Módulo PURO y client-safe: lo importa el panel para pintar la lista.
// ═══════════════════════════════════════════════════════════════════════
import { genericXmlAdapter } from "@/lib/realty/portal-adapters/generic-xml";
import { metaCatalogAdapter } from "@/lib/realty/portal-adapters/meta-catalog";
import { googleListingAdapter } from "@/lib/realty/portal-adapters/google-listing";
import type { RealtyPortalAdapter } from "@/lib/realty/portal-adapters/types";

export { genericXmlAdapter, metaCatalogAdapter, googleListingAdapter };
export * from "@/lib/realty/portal-adapters/types";
export { realtyListingLd, serializeRealtyLd } from "@/lib/realty/portal-adapters/google-listing";

/** Todos los adaptadores, por su key. */
export const REALTY_PORTAL_ADAPTERS: Record<string, RealtyPortalAdapter> = {
  [genericXmlAdapter.key]: genericXmlAdapter,
  [metaCatalogAdapter.key]: metaCatalogAdapter,
  [googleListingAdapter.key]: googleListingAdapter,
};

export function getRealtyPortalAdapter(key: string): RealtyPortalAdapter | null {
  return REALTY_PORTAL_ADAPTERS[key] ?? null;
}

/**
 * Un DESTINO es lo que el cliente ve en la pantalla ("Trovit"), y apunta a
 * un ADAPTADOR ("generic-xml"), que es el formato. Varios destinos comparten
 * adaptador: los cinco de LIFULL leen el mismo XML.
 *
 * `key` se guarda en RealtyPortalAccount.portal y RealtyPortalListing.portal
 * (String en la base). Cambiar una key rompe las filas existentes: si hay
 * que renombrar, se renombra la ETIQUETA, nunca la key.
 */
export interface RealtyPortalDestination {
  key: string;
  label: string;
  /** Familia comercial, para agrupar en la UI. */
  group: "lifull" | "meta" | "propia" | "otros" | "convenio";
  adapter: string;
  /**
   * `false` = no se puede publicar ahí todavía. `unavailableReason` explica
   * por qué, con palabras que el asesor entiende.
   */
  available: boolean;
  unavailableReason?: string;
  /** ¿El portal cobra su propia suscripción al cliente? */
  paidBySubscriber: boolean;
  /** Explicación corta que se pinta bajo el nombre. */
  help: string;
  /** Dónde va el cliente a dar de alta la URL del feed. */
  setupUrl?: string;
}

/**
 * ⚠️ Los datos comerciales de cada portal (si cobra, cómo se da de alta la
 * URL) CAMBIAN sin avisarnos. El texto está escrito para que siga siendo
 * cierto aunque cambie el detalle: decimos "sube la URL en tu cuenta del
 * portal", no inventamos el nombre exacto del botón.
 */
export const REALTY_PORTAL_DESTINATIONS: RealtyPortalDestination[] = [
  // ── LIFULL Connect: la familia de agregadores que lee este formato ────
  {
    key: "trovit",
    label: "Trovit",
    group: "lifull",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Agregador de LIFULL Connect. Se suscribe a la URL de tu feed y la vuelve a leer cada tanto.",
  },
  {
    key: "mitula",
    label: "Mitula",
    group: "lifull",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Del mismo grupo que Trovit. Usa la misma URL de feed.",
  },
  {
    key: "nuroa",
    label: "Nuroa",
    group: "lifull",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Del mismo grupo que Trovit. Usa la misma URL de feed.",
  },
  {
    key: "nestoria",
    label: "Nestoria",
    group: "lifull",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Del mismo grupo que Trovit. Usa la misma URL de feed.",
  },
  {
    key: "icasas",
    label: "iCasas",
    group: "lifull",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Del mismo grupo que Trovit. Usa la misma URL de feed.",
  },

  // ── Meta ──────────────────────────────────────────────────────────────
  {
    key: "meta",
    label: "Anuncios de Facebook e Instagram",
    group: "meta",
    adapter: "meta-catalog",
    available: true,
    paidBySubscriber: true,
    help: "Catálogo para tus campañas de Facebook e Instagram. NO publica en Marketplace: Meta cerró las publicaciones de propiedades hechas por páginas de negocio y por plataformas como la nuestra.",
  },

  // ── Tu propia web ─────────────────────────────────────────────────────
  {
    key: "web-propia",
    label: "Tu propia web",
    group: "propia",
    adapter: "google-listing",
    available: true,
    paidBySubscriber: false,
    help: "Los datos que Google lee de tus fichas para enseñar precio, recámaras y foto en el buscador. No le pagas a nadie y no hay que dar de alta nada.",
  },

  // ── Portales chicos y cualquier otro que acepte un XML ────────────────
  {
    key: "beleta",
    label: "Beleta",
    group: "otros",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Comparte la URL del feed y confirma con ellos el formato que esperan.",
  },
  {
    key: "clasco",
    label: "Clasco",
    group: "otros",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Comparte la URL del feed y confirma con ellos el formato que esperan.",
  },
  {
    key: "otro",
    label: "Otro portal",
    group: "otros",
    adapter: "generic-xml",
    available: true,
    paidBySubscriber: true,
    help: "Cualquier portal que acepte un XML con tus propiedades. Le pasas la URL y listo.",
  },

  // ── Requieren convenio comercial: NO se puede publicar todavía ────────
  // Están aquí a propósito. El asesor pregunta por ellos SIEMPRE, y una
  // lista donde no aparecen se lee como "no lo saben hacer"; una donde
  // aparecen encendidos sería mentira. Aparecen apagados, con el motivo.
  {
    key: "inmuebles24",
    label: "Inmuebles24",
    group: "convenio",
    adapter: "generic-xml",
    available: false,
    unavailableReason:
      "Inmuebles24 no tiene una conexión abierta: se entra por convenio con el portal y DaleControl todavía no lo tiene. En cuanto exista, tus inmuebles salen por aquí sin que cambies nada.",
    paidBySubscriber: true,
    help: "Portal de paga. Hoy tienes que subir los anuncios a mano en su sitio.",
  },
  {
    key: "lamudi",
    label: "Lamudi",
    group: "convenio",
    adapter: "generic-xml",
    available: false,
    unavailableReason:
      "Lamudi no tiene una conexión abierta: se entra por convenio con el portal y DaleControl todavía no lo tiene.",
    paidBySubscriber: true,
    help: "Portal de paga. Hoy tienes que subir los anuncios a mano en su sitio.",
  },
  {
    key: "casasyterrenos",
    label: "Casas y Terrenos",
    group: "convenio",
    adapter: "generic-xml",
    available: false,
    unavailableReason:
      "Casas y Terrenos no tiene una conexión abierta: se entra por convenio con el portal y DaleControl todavía no lo tiene.",
    paidBySubscriber: true,
    help: "Portal de paga. Hoy tienes que subir los anuncios a mano en su sitio.",
  },
];

export const REALTY_PORTAL_GROUP_LABELS: Record<RealtyPortalDestination["group"], string> = {
  lifull: "Agregadores que leen tu feed",
  meta: "Publicidad",
  propia: "Tu propia web",
  otros: "Otros portales con feed",
  convenio: "Requieren convenio con el portal",
};

export function getRealtyPortalDestination(key: string): RealtyPortalDestination | null {
  return REALTY_PORTAL_DESTINATIONS.find((d) => d.key === key) ?? null;
}

/** Etiqueta de un destino; cae a la propia key si es uno personalizado. */
export function realtyPortalLabel(key: string): string {
  return getRealtyPortalDestination(key)?.label ?? key;
}

/** Destinos a los que HOY se puede publicar. */
export function availableRealtyPortalDestinations(): RealtyPortalDestination[] {
  return REALTY_PORTAL_DESTINATIONS.filter((d) => d.available);
}

/** El adaptador de un destino; cae al XML genérico si el destino es libre. */
export function adapterForDestination(key: string): RealtyPortalAdapter {
  const dest = getRealtyPortalDestination(key);
  return (dest && getRealtyPortalAdapter(dest.adapter)) ?? genericXmlAdapter;
}

/**
 * Nombres de archivo públicos del feed → adaptador. Es lo que valida la
 * ruta /feeds/realty/<accountId>/<archivo>: cualquier otro nombre es 404.
 * `propiedades.json` no está aquí porque no lo arma un adaptador: es el
 * modelo canónico crudo, para depurar.
 */
export const REALTY_FEED_FILES: Record<string, RealtyPortalAdapter> = {
  [genericXmlAdapter.filename]: genericXmlAdapter,
  [metaCatalogAdapter.filename]: metaCatalogAdapter,
  [googleListingAdapter.filename]: googleListingAdapter,
};
