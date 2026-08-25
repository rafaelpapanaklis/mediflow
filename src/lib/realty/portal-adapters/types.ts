// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — MODELO CANÓNICO de "inmueble publicable" y
// contrato de los adaptadores de portal.
//
// 🔴 ESTE ARCHIVO ES LA REJA DE PRIVACIDAD DEL FEED PÚBLICO.
//
// El feed de /feeds/realty/** es PÚBLICO: lo jala cualquiera con la URL, sin
// sesión. La defensa contra fugas no es "acordarse de no poner el teléfono
// del dueño" en cada adaptador — eso falla al tercer adaptador. La defensa
// es que el dato privado NUNCA ENTRE al modelo canónico:
//
//   1. `src/lib/realty/feed.ts` hace un `select` de Prisma que enumera
//      EXPLÍCITAMENTE las columnas seguras. internalNotes, commissionPct,
//      ownerId, assignedUserId y los documentos NI SIQUIERA SE LEEN.
//   2. Esa fila se convierte a `RealtyPublishableProperty` — el tipo de
//      abajo, que no tiene un solo campo donde quepa un dato privado.
//   3. Los adaptadores reciben SOLO ese tipo. Un adaptador no puede filtrar
//      lo que nunca recibió, ni aunque el autor se equivoque.
//
// Módulo PURO y client-safe: sin prisma, sin "server-only". Lo importan el
// panel (para las etiquetas) y el servidor (para armar el feed).
// ═══════════════════════════════════════════════════════════════════════
import type {
  RealtyCurrency,
  RealtyOperation,
  RealtyPropertyKind,
  RealtyPropertyStatus,
  RealtyTourKind,
} from "@/lib/realty/types";

/** Foto lista para un feed público: absoluta, sin token y sin caducidad. */
export interface RealtyPublishablePhoto {
  url: string;
  isCover: boolean;
  width: number | null;
  height: number | null;
}

/**
 * Recorrido virtual. Es el campo que más se pierde y donde más sirve: los
 * portales tienen columna para él y un inmueble con tour se ve muchísimo
 * más. Solo entran URLs de la allowlist de src/lib/realty/tours.ts.
 */
export interface RealtyPublishableTour {
  kind: RealtyTourKind;
  provider: string;
  url: string;
}

/**
 * INMUEBLE PUBLICABLE — la única forma en que un inmueble sale de la casa.
 *
 * 🔴 Lo que NO existe aquí, y no debe existir nunca:
 *    internalNotes · commissionPct · ownerId / nombre / teléfono / correo
 *    del propietario · assignedUserId ni datos personales del asesor ·
 *    documentos (escrituras, predial, identificaciones) · exclusivas ·
 *    prospectos · el estatus comercial interno más allá de DISPONIBLE.
 *
 * 🔴 `address`, `lat` y `lng` valen null cuando showExactAddress está
 *    apagado. Las coordenadas SON la dirección exacta: publicarlas con
 *    7 decimales mientras se oculta la calle es la misma fuga con otro
 *    nombre. Ver sanitizeAddress() en feed.ts.
 */
export interface RealtyPublishableProperty {
  id: string;
  /** Clave corta que el asesor dicta por teléfono ("INM-7K3Q"). */
  folio: string | null;
  kind: RealtyPropertyKind;
  operation: RealtyOperation;
  /** Estatus comercial. El feed solo lleva DISPONIBLE; el tipo admite los
   *  cuatro porque el JSON-LD de la web propia sí pinta fichas vendidas. */
  status: RealtyPropertyStatus;

  /** Precio de la operación principal (venta si vende, renta si renta). */
  price: number;
  currency: RealtyCurrency;
  /** Desglose cuando la operación es AMBAS. */
  salePrice: number | null;
  rentPrice: number | null;
  maintenanceFee: number | null;

  landM2: number | null;
  builtM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBathrooms: number | null;
  parking: number | null;
  ageYears: number | null;
  /** Llaves de REALTY_AMENITIES ya validadas. Nunca el Json crudo. */
  amenities: string[];

  title: string;
  description: string | null;

  /** SOLO si showExactAddress. Si no, null. */
  address: string | null;
  // Colonia, ciudad, estado y CP salen SIEMPRE, incluso con la dirección
  // exacta apagada: sin ellos el portal no puede filtrar el anuncio y lo
  // descarta. Es una decisión tomada, no un descuido — un CP mexicano cubre
  // más o menos una colonia, así que no añade precisión sobre lo que ya se
  // publica. Lo que sí apunta a la puerta (calle y coordenadas) se quita.
  colonia: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** SOLO si showExactAddress. Si no, null (ver nota de arriba). */
  lat: number | null;
  lng: number | null;
  showExactAddress: boolean;

  photos: RealtyPublishablePhoto[];
  tours: RealtyPublishableTour[];

  /** Ficha en la web del cliente: absoluta, /i/<slug>/<slug-o-id>. */
  url: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * La cuenta que publica, tal como sale al feed. Es el CONTACTO del anuncio:
 * el teléfono y el correo del NEGOCIO, los mismos que ya enseña su web
 * pública. El teléfono del propietario del inmueble NO está aquí ni puede
 * estarlo — no es un campo de este tipo.
 */
export interface RealtyPublisherAccount {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  /** Web pública de la cuenta: absoluta, /i/<slug>. */
  webUrl: string;
}

/** Opciones que el feed le pasa al adaptador. */
export interface RealtyAdapterOptions {
  /** Fotos máximas por inmueble que se escriben en la salida. */
  maxPhotos: number;
  /** Fecha de generación (ISO). Se inyecta para que el módulo sea puro. */
  generatedAt: string;
  /** Destino concreto que pidió el feed, si lo hubo ("trovit", "meta"…). */
  destination?: string;
}

/**
 * CONTRATO DEL ADAPTADOR. Todos exponen lo mismo:
 *   build(properties, account, options) → string
 *
 * `transport` es lo que decide cómo se entrega:
 *   "feed" → el portal JALA la URL cada tanto. No hay credenciales ni API.
 *            Publicar = entrar al feed; despublicar = salir de él.
 *   "push" → hay que EMPUJAR por API con credenciales. Hoy no existe
 *            ninguno (los tres grandes de México no tienen API pública: se
 *            entra por convenio comercial). Cuando exista, implementa
 *            `push` y la cola de portals.ts lo reintenta sola.
 *
 * Cómo agregar uno nuevo: portal-adapters/README.md.
 */
export interface RealtyPortalAdapter {
  key: string;
  label: string;
  transport: "feed" | "push";
  /** Content-Type con el que se sirve la salida de build(). */
  contentType: string;
  /** Nombre de archivo público bajo /feeds/realty/<accountId>/. */
  filename: string;
  build(
    properties: RealtyPublishableProperty[],
    account: RealtyPublisherAccount,
    options: RealtyAdapterOptions,
  ): string;
  /**
   * Envío por API. OPCIONAL: solo los adaptadores "push" lo implementan.
   * Debe RESOLVER siempre (nunca lanzar) devolviendo el resultado; la cola
   * distingue `retryable` para decidir si reintenta o se rinde.
   */
  push?(
    property: RealtyPublishableProperty,
    account: RealtyPublisherAccount,
    credentials: { externalAccountId: string | null; apiKey: string | null },
  ): Promise<RealtyPortalPushResult>;
}

export interface RealtyPortalPushResult {
  ok: boolean;
  /** Id que devolvió el portal. Se guarda en RealtyPortalListing.externalId. */
  externalId?: string | null;
  /** Mensaje crudo del portal cuando falla. Se guarda en lastError. */
  error?: string;
  /** false = no tiene caso reintentar (credencial mala, inmueble inválido). */
  retryable?: boolean;
}

// ── Validación: por qué un inmueble NO puede salir a un portal ─────────

export interface RealtyPublishCheck {
  /** Impiden publicar. El portal lo rechazaría o lo enseñaría inservible. */
  blockers: string[];
  /** No impiden nada, pero el anuncio rinde mucho menos. */
  warnings: string[];
}

/**
 * Se corre sobre el modelo YA saneado, a propósito: así comprueba lo que de
 * verdad va a recibir el portal y no lo que hay en la base. Un inmueble con
 * diez fotos, todas en enlaces firmados que caducan, sale de aquí "sin
 * fotos" — que es la verdad desde el otro lado.
 */
export function checkPublishable(p: RealtyPublishableProperty): RealtyPublishCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!p.title || p.title.trim().length < 5) {
    blockers.push("Le falta un título de al menos 5 letras.");
  }
  if (!(p.price > 0)) {
    blockers.push(
      p.operation === "RENTA"
        ? "Le falta el precio de renta."
        : p.operation === "AMBAS"
          ? "Le falta el precio: captura el de venta, el de renta o los dos."
          : "Le falta el precio de venta.",
    );
  }
  if (!p.city && !p.colonia) {
    blockers.push("Le falta la ubicación: sin colonia ni ciudad el portal no lo puede filtrar.");
  }

  if (p.photos.length === 0) {
    warnings.push("No tiene fotos públicas. Un anuncio sin foto casi no recibe clics.");
  }
  if (!p.description || p.description.trim().length < 40) {
    warnings.push("La descripción es muy corta.");
  }
  if (p.builtM2 === null && p.landM2 === null) {
    warnings.push("No tiene metros cuadrados. Los buscadores del portal filtran por eso.");
  }
  if (p.tours.length === 0) {
    warnings.push("No tiene recorrido virtual. Los portales tienen campo para él y se nota.");
  }
  return { blockers, warnings };
}

// ── Utilidades de texto compartidas por los adaptadores ────────────────

/**
 * Caracteres de control que un documento XML 1.0 NO admite ni escapados.
 * Una descripción pegada desde Word trae \v y \f más seguido de lo que
 * nadie cree, y un solo byte de esos vuelve el feed entero ilegible para
 * el parser del portal — que responde "archivo inválido" sin decir dónde.
 */
export function stripXmlControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

/** Los 5 caracteres que rompen un documento XML (mismo helper que el RSS). */
export function xmlEscape(value: string | null | undefined): string {
  return stripXmlControlChars(String(value ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Envuelve en CDATA (lo que piden los feeds estilo Trovit/LIFULL).
 * El único texto que puede cerrar un CDATA antes de tiempo es "]]>" — se
 * parte en dos secciones. Sin esto, una descripción con "]]>" (raro pero
 * posible al pegar código o medidas) rompe el feed COMPLETO, no solo su
 * anuncio.
 */
export function cdata(value: string | null | undefined): string {
  const clean = stripXmlControlChars(String(value ?? "")).replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${clean}]]>`;
}

/** Aplana saltos de línea y espacios repetidos; recorta a `max`. */
export function flattenText(value: string | null | undefined, max = 4000): string {
  const clean = stripXmlControlChars(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * EL PRECIO QUE SE PUBLICA, y con qué operación.
 *
 * Vive aquí (módulo PURO) y no en feed.ts porque es la regla más peligrosa
 * de todo el módulo y tiene que poder probarse sin base de datos.
 *
 * 🔴 `RealtyProperty.price` es `Decimal @default(0)` y NOT NULL: NUNCA llega
 * null. Por eso aquí no sirve `??` — `venta ?? renta` jamás cae al segundo
 * lado, y un inmueble en AMBAS capturado solo con renta salía con precio 0 y
 * se quedaba fuera del feed.
 *
 * 🔴 Y una RENTA sin precio de renta NO cae al precio de venta. Ese "arreglo"
 * publica 4 500 000 como renta MENSUAL: es el peor error posible en un portal
 * porque se ve, se comparte y no hay forma de explicarlo. Sin precio de renta
 * el inmueble se queda fuera con un motivo claro.
 *
 * AMBAS con los dos precios → se anuncia la VENTA (la renta viaja aparte).
 * AMBAS con solo renta → se anuncia como RENTA: es lo que de verdad
 * cotizaron, y decir "venta" con el importe de la renta sería mentir.
 */
export function resolveFeedPrice(
  operation: RealtyOperation,
  salePrice: number | null,
  rentPrice: number | null,
): { operation: RealtyOperation; price: number } {
  const venta = salePrice !== null && salePrice > 0 ? salePrice : 0;
  const renta = rentPrice !== null && rentPrice > 0 ? rentPrice : 0;
  if (operation === "RENTA") return { operation, price: renta };
  if (operation === "VENTA") return { operation, price: venta };
  if (venta > 0) return { operation: "AMBAS", price: venta };
  if (renta > 0) return { operation: "RENTA", price: renta };
  return { operation: "AMBAS", price: 0 };
}

/** Número con hasta 2 decimales y sin separadores de miles (formato feed). */
export function feedNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
