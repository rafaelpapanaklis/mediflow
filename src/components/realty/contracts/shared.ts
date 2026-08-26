// ═══════════════════════════════════════════════════════════════════════
// INMUEBLES · CONTRATOS — la parte PURA y CLIENT-SAFE del módulo.
//
// ── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────
// `src/lib/realty/contracts.ts` y `signature.ts` llevan `import
// "server-only"` (tocan prisma y node:crypto). Un componente "use client"
// que importe de ahí AUNQUE SEA UNA CONSTANTE arrastra el módulo entero al
// grafo del navegador y `next build` falla en seco con "You're importing a
// component that needs server-only". Es la misma lección que ya dejó
// escrita properties-shared.ts.
//
// Los `import type` sí se borran en compilación y no cuentan; el que rompe
// es el import de VALORES. Así que aquí viven los tipos, el catálogo de
// variables y las etiquetas — sin una sola dependencia de servidor — y de
// aquí importan LAS DOS partes: las pantallas y el servidor.
//
// ⚠️ El servidor importa DESDE components/ y no al revés. Se ve raro, pero
// la alternativa era un `src/lib/realty/contracts-shared.ts` que esta
// terminal no tiene permitido crear. El módulo es puro: no arrastra React
// ni JSX (este archivo es .ts, no .tsx).
// ═══════════════════════════════════════════════════════════════════════

// ── Los cuatro tipos de contrato ───────────────────────────────────────
export const REALTY_CONTRACT_KINDS = [
  "ARRENDAMIENTO",
  "EXCLUSIVA",
  "PROMESA",
  "COMISION",
] as const;
export type RealtyContractKind = (typeof REALTY_CONTRACT_KINDS)[number];

export function isContractKind(v: unknown): v is RealtyContractKind {
  return typeof v === "string" && (REALTY_CONTRACT_KINDS as readonly string[]).includes(v);
}

/** De dónde saca sus datos cada tipo. Lo usa la pantalla para pedir el origen. */
export const CONTRACT_SOURCE: Record<RealtyContractKind, "lease" | "exclusive" | "deal" | "none"> = {
  ARRENDAMIENTO: "lease",
  EXCLUSIVA: "exclusive",
  PROMESA: "deal",
  // El de colaboración entre asesores no sale de ninguna tabla: lo captura
  // el asesor a mano sobre una operación (deal) opcional.
  COMISION: "none",
};

// ── Estados ────────────────────────────────────────────────────────────
// BORRADOR  → se puede editar el cuerpo.
// ENVIADO   → SELLADO: el cuerpo ya no se toca. Hay ligas fuera.
// PARCIAL   → alguien ya firmó, faltan otros.
// FIRMADO   → firmaron todos los que tenían que firmar.
// ARCHIVADO → fuera del tablero, pero SIGUE en el expediente.
// ANULADO   → se dejó sin efecto. NO se borra: queda con su motivo.
export const REALTY_CONTRACT_STATUSES = [
  "BORRADOR",
  "ENVIADO",
  "PARCIAL",
  "FIRMADO",
  "ARCHIVADO",
  "ANULADO",
] as const;
export type RealtyContractStatus = (typeof REALTY_CONTRACT_STATUSES)[number];

export function isContractStatus(v: unknown): v is RealtyContractStatus {
  return typeof v === "string" && (REALTY_CONTRACT_STATUSES as readonly string[]).includes(v);
}

/** Tono de la píldora. Los mismos que usa `Pill` de rentals/ui.tsx. */
export const CONTRACT_STATUS_TONE: Record<
  RealtyContractStatus,
  "success" | "brand" | "info" | "warning" | "danger" | "neutral"
> = {
  BORRADOR: "neutral",
  ENVIADO: "info",
  PARCIAL: "warning",
  FIRMADO: "success",
  ARCHIVADO: "neutral",
  ANULADO: "danger",
};

/** Un contrato SELLADO ya no admite cambios en el cuerpo. Punto único. */
export function isSealed(status: RealtyContractStatus): boolean {
  return status !== "BORRADOR";
}

/** ¿Sigue vivo para firmarse? Un archivado o anulado ya no. */
export function acceptsSignatures(status: RealtyContractStatus): boolean {
  return status === "ENVIADO" || status === "PARCIAL";
}

// ── Papeles de quien firma ─────────────────────────────────────────────
export const REALTY_PARTY_ROLES = [
  "ARRENDADOR",
  "INQUILINO",
  "AVAL",
  "PROPIETARIO",
  "INMOBILIARIA",
  "COMPRADOR",
  "VENDEDOR",
  "ASESOR",
] as const;
export type RealtyPartyRole = (typeof REALTY_PARTY_ROLES)[number];

export function isPartyRole(v: unknown): v is RealtyPartyRole {
  return typeof v === "string" && (REALTY_PARTY_ROLES as readonly string[]).includes(v);
}

/** Qué papeles tiene sentido pedir en cada tipo de contrato. */
export const ROLES_BY_KIND: Record<RealtyContractKind, RealtyPartyRole[]> = {
  ARRENDAMIENTO: ["ARRENDADOR", "INQUILINO", "AVAL"],
  EXCLUSIVA: ["PROPIETARIO", "INMOBILIARIA"],
  PROMESA: ["VENDEDOR", "COMPRADOR"],
  COMISION: ["ASESOR", "INMOBILIARIA"],
};

// ── Variables de plantilla ─────────────────────────────────────────────
/**
 * 🔴 EL CATÁLOGO ES LA REJA. Al guardar una plantilla se comprueba que
 * TODA `{{variable}}` que aparezca esté aquí, para el tipo de contrato que
 * se está editando. Una variable inventada se rechaza con su nombre en el
 * mensaje — que es justo lo que pedía "las variables marcadas para que no
 * se rompan al editar": el editor las pinta como fichas y el servidor no
 * deja guardar una que no exista.
 *
 * Sin esto, un dedazo (`{{inquilino.nombr}}`) se guardaría tan campante y
 * el contrato saldría impreso con la llave cruda en medio de una cláusula.
 */
export interface ContractVariable {
  /** Nombre tal cual va entre llaves dobles. */
  name: string;
  /** Cómo se lee en el editor. */
  label: string;
  /** Ejemplo, para la ficha del editor y la vista previa en vacío. */
  sample: string;
}

const V = (name: string, label: string, sample: string): ContractVariable => ({
  name,
  label,
  sample,
});

/** Variables que existen en TODOS los tipos. */
const COMUNES: ContractVariable[] = [
  V("folio", "Folio del contrato", "CTR-000001"),
  V("fecha.hoy", "Fecha de firma (larga)", "5 de agosto de 2026"),
  V("fecha.lugar", "Ciudad donde se firma", "Guadalajara, Jalisco"),
  V("inmobiliaria.nombre", "Nombre comercial", "Inmobiliaria del Valle"),
  V("inmobiliaria.razonSocial", "Razón social", "Inmobiliaria del Valle, S.A. de C.V."),
  V("inmobiliaria.direccion", "Domicilio", "Av. Vallarta 1234, Guadalajara"),
  V("inmobiliaria.telefono", "Teléfono", "33 1234 5678"),
  V("inmobiliaria.correo", "Correo", "contacto@ejemplo.mx"),
  V("inmobiliaria.licencia", "Licencia inmobiliaria", "JAL-2026-0001"),
];

/** Variables del inmueble. Las comparten los cuatro tipos. */
const INMUEBLE: ContractVariable[] = [
  V("inmueble.titulo", "Nombre del inmueble", "Casa en Providencia"),
  V("inmueble.tipo", "Tipo", "Casa"),
  V("inmueble.direccion", "Calle y número", "Pino Suárez 45"),
  V("inmueble.colonia", "Colonia", "Providencia"),
  V("inmueble.ciudad", "Ciudad", "Guadalajara"),
  V("inmueble.estado", "Estado", "Jalisco"),
  V("inmueble.cp", "Código postal", "44630"),
  V("inmueble.recamaras", "Recámaras", "3"),
  V("inmueble.banos", "Baños", "2"),
  V("inmueble.estacionamientos", "Cajones de estacionamiento", "2"),
  V("inmueble.m2Construidos", "Metros construidos", "180"),
  V("inmueble.m2Terreno", "Metros de terreno", "240"),
];

const PERSONA = (pre: string, quien: string): ContractVariable[] => [
  V(`${pre}.nombre`, `${quien}: nombre`, "María Hernández"),
  V(`${pre}.telefono`, `${quien}: teléfono`, "33 1234 5678"),
  V(`${pre}.correo`, `${quien}: correo`, "maria@ejemplo.mx"),
  V(`${pre}.rfc`, `${quien}: RFC`, "HEMA800101AB1"),
];

export const CONTRACT_VARIABLES: Record<RealtyContractKind, ContractVariable[]> = {
  ARRENDAMIENTO: [
    ...COMUNES,
    ...INMUEBLE,
    ...PERSONA("arrendador", "Arrendador"),
    ...PERSONA("inquilino", "Inquilino"),
    ...PERSONA("aval", "Aval"),
    V("renta.monto", "Renta mensual", "$18,000.00"),
    V("renta.montoLetra", "Renta con letra", "DIECIOCHO MIL PESOS 00/100 M.N."),
    V("renta.moneda", "Moneda", "MXN"),
    V("renta.diaPago", "Día de pago", "5"),
    V("renta.deposito", "Depósito en garantía", "$18,000.00"),
    V("renta.depositoLetra", "Depósito con letra", "DIECIOCHO MIL PESOS 00/100 M.N."),
    V("vigencia.inicio", "Inicio del contrato", "1 de septiembre de 2026"),
    V("vigencia.fin", "Fin del contrato", "31 de agosto de 2027"),
    V("vigencia.meses", "Duración en meses", "12"),
    V("aumento.regla", "Regla de aumento", "INPC"),
    V("aumento.porcentaje", "Porcentaje pactado", "5.00%"),
  ],
  EXCLUSIVA: [
    ...COMUNES,
    ...INMUEBLE,
    ...PERSONA("propietario", "Propietario"),
    V("exclusiva.inicio", "Inicio de la exclusiva", "1 de septiembre de 2026"),
    V("exclusiva.fin", "Fin de la exclusiva", "28 de febrero de 2027"),
    V("exclusiva.meses", "Duración en meses", "6"),
    V("exclusiva.comisionPct", "Comisión pactada", "5.00%"),
    V("inmueble.precio", "Precio de lista", "$4,500,000.00"),
    V("inmueble.precioLetra", "Precio con letra", "CUATRO MILLONES QUINIENTOS MIL PESOS 00/100 M.N."),
  ],
  PROMESA: [
    ...COMUNES,
    ...INMUEBLE,
    ...PERSONA("vendedor", "Vendedor"),
    ...PERSONA("comprador", "Comprador"),
    V("operacion.tipo", "Tipo de operación", "Venta"),
    V("operacion.monto", "Precio de la operación", "$4,300,000.00"),
    V("operacion.montoLetra", "Precio con letra", "CUATRO MILLONES TRESCIENTOS MIL PESOS 00/100 M.N."),
    V("operacion.comision", "Comisión de la casa", "$215,000.00"),
    V("operacion.cierre", "Fecha estimada de cierre", "30 de noviembre de 2026"),
  ],
  COMISION: [
    ...COMUNES,
    ...INMUEBLE,
    ...PERSONA("asesorA", "Primer asesor"),
    ...PERSONA("asesorB", "Segundo asesor"),
    V("operacion.monto", "Precio de la operación", "$4,300,000.00"),
    V("comision.total", "Comisión total", "$215,000.00"),
    V("comision.totalLetra", "Comisión con letra", "DOSCIENTOS QUINCE MIL PESOS 00/100 M.N."),
    V("comision.pctA", "Parte del primer asesor", "50.00%"),
    V("comision.pctB", "Parte del segundo asesor", "50.00%"),
  ],
};

/** Nombres válidos de un tipo, en Set para comprobar rápido. */
export function variableNames(kind: RealtyContractKind): Set<string> {
  return new Set(CONTRACT_VARIABLES[kind].map((v) => v.name));
}

/**
 * Todas las `{{x}}` que aparecen en un texto, en orden y sin repetir.
 *
 * La expresión acepta espacios dentro de las llaves porque un editor de
 * texto los mete solo al copiar y pegar; lo que NO acepta es cualquier
 * carácter raro: solo letras, números y puntos. Así `{{ inquilino.nombre }}`
 * y `{{inquilino.nombre}}` son la misma variable, y `{{ borrar tabla }}`
 * ni siquiera se reconoce como una.
 */
export function usedVariables(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Array.from y NO for..of sobre el iterador: el tsconfig del repo no fija
  // `target`, así que iterar matchAll saca TS2802 en el build.
  for (const m of Array.from(String(body ?? "").matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g))) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Las variables del texto que NO existen en el catálogo del tipo.
 * Vacío = la plantilla se puede guardar.
 */
export function unknownVariables(kind: RealtyContractKind, body: string): string[] {
  const validas = variableNames(kind);
  return usedVariables(body).filter((n) => !validas.has(n));
}

/**
 * Sustituye las variables por sus valores.
 *
 * 🔴 UNA SOLA PASADA con replace y función: sustituir en bucle (una variable
 * tras otra) permitiría que el VALOR de la primera contenga `{{otra}}` y se
 * expandiera en la segunda vuelta. Los valores salen de datos que captura
 * el cliente (el nombre de un inquilino), así que eso sería una plantilla
 * inyectada desde un campo de texto.
 *
 * Una variable sin valor se sustituye por `faltante` (por defecto una línea
 * de guiones bajos, como el papel que se llena a mano) y NUNCA se queda
 * como `{{x}}` en el documento impreso.
 */
export function renderTemplate(
  body: string,
  values: Record<string, string>,
  faltante = "__________",
): string {
  return String(body ?? "").replace(
    /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g,
    (_full, name: string) => {
      const v = values[name];
      return typeof v === "string" && v.trim() !== "" ? v : faltante;
    },
  );
}

// ── DTOs que viajan al navegador ───────────────────────────────────────
/**
 * 🔴 `body` NO viaja en el listado, a propósito: un contrato son varios KB
 * por fila y la tabla no lo pinta. Solo el detalle lo trae.
 */
export interface ContractPartyDTO {
  id: string;
  role: RealtyPartyRole;
  name: string;
  email: string | null;
  phone: string | null;
  mustSign: boolean;
  sortOrder: number;
  /** ISO, o null si todavía no firma. */
  signedAt: string | null;
  /** Estado de su liga: si hay una viva, si ya venció, si nunca se mandó. */
  link: "SIN_ENVIAR" | "ENVIADA" | "VENCIDA" | "USADA";
  /** ISO de cuándo se le mandó la última liga. */
  sentAt: string | null;
  sentVia: string | null;
}

export interface ContractRowDTO {
  id: string;
  kind: RealtyContractKind;
  folio: string;
  title: string;
  status: RealtyContractStatus;
  propertyId: string | null;
  propertyTitle: string | null;
  /** El contacto del expediente (inquilino, comprador). La bóveda filtra por él. */
  contactId: string | null;
  leaseId: string | null;
  exclusiveId: string | null;
  dealId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
  signedAt: string | null;
  /** Cuántas partes tienen que firmar y cuántas ya firmaron. */
  signed: number;
  required: number;
  /** Días para que venza. null = sin vigencia capturada. Negativo = venció. */
  daysToEnd: number | null;
  /** 30 | 60 | 90 si está por vencer; null si no. */
  expiryWindow: number | null;
}

export interface ContractDetailDTO extends ContractRowDTO {
  body: string;
  documentHash: string;
  parties: ContractPartyDTO[];
  signatures: ContractSignatureDTO[];
  sealedAt: string | null;
  archivedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * La evidencia, tal como se enseña en pantalla.
 *
 * 🔴 El TRAZO no viaja aquí. La imagen de la firma se ve en el PDF, que se
 * arma en el servidor. Mandar los trazos de todas las partes en el JSON del
 * detalle engordaría la pantalla con imágenes que nadie mira ahí.
 */
export interface ContractSignatureDTO {
  id: string;
  partyId: string;
  signerName: string;
  signedAt: string;
  /** El hash del documento EN EL MOMENTO de firmar. */
  documentHash: string;
  ip: string | null;
  userAgent: string | null;
  /** false = el documento cambió después de esta firma. No debería pasar nunca. */
  matchesCurrent: boolean;
}

/** Lo que ve quien abre la liga de firma. Sin ids internos, sin la cuenta. */
export interface PublicSigningDTO {
  folio: string;
  title: string;
  kind: RealtyContractKind;
  body: string;
  /** Huella del documento, la misma que se imprime en el acuse. */
  documentHash: string;
  accountName: string;
  /**
   * Idioma de la INMOBILIARIA, no del navegador de quien firma.
   *
   * La pantalla de firma no tiene sesión ni preferencia guardada, y el
   * documento está redactado en el idioma que eligió la cuenta: poner los
   * botones en inglés encima de un contrato en español sería peor que no
   * traducir nada.
   */
  locale: "es" | "en";
  /** Quién es esta persona en el contrato. */
  signerName: string;
  signerRole: RealtyPartyRole;
  /** ISO si ya firmó (la liga pasa a modo lectura). */
  signedAt: string | null;
  /** Los demás firmantes: nombre, papel y si ya firmaron. Sin sus datos. */
  others: Array<{ name: string; role: RealtyPartyRole; signed: boolean }>;
  /** true cuando ya firmaron todos. */
  complete: boolean;
}

// ── Formato ────────────────────────────────────────────────────────────
/**
 * Dinero del módulo. Vive aquí y no se importa de rent-charges porque este
 * archivo tiene que poder cargarse en el navegador sin arrastrar nada más;
 * el formato es idéntico (es-MX, dos decimales) a propósito.
 */
export function formatContractMoney(amount: number, currency = "MXN"): string {
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** Ventana de vencimiento: 30, 60, 90 o null. Misma escalera que rentas. */
export function expiryWindowFor(daysToEnd: number | null): number | null {
  if (daysToEnd === null) return null;
  if (daysToEnd > 90) return null;
  if (daysToEnd <= 30) return 30;
  if (daysToEnd <= 60) return 60;
  return 90;
}

/** Ancho fijo para que "CTR-9" no ordene después de "CTR-10". */
export const CONTRACT_FOLIO_PREFIX = "CTR-";
export const CONTRACT_FOLIO_DIGITS = 6;

export function formatContractFolio(n: number): string {
  const safe = Math.max(1, Math.floor(n || 0));
  return `${CONTRACT_FOLIO_PREFIX}${String(safe).padStart(CONTRACT_FOLIO_DIGITS, "0")}`;
}

export function parseContractFolio(folio: string | null | undefined): number {
  if (!folio || typeof folio !== "string") return 0;
  if (!folio.startsWith(CONTRACT_FOLIO_PREFIX)) return 0;
  const n = parseInt(folio.slice(CONTRACT_FOLIO_PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── Topes ──────────────────────────────────────────────────────────────
/** Un contrato largo son ~40 KB de texto. 200 KB es techo de sobra. */
export const MAX_CONTRACT_BODY = 200_000;
/** Una plantilla no es más larga que el contrato que produce. */
export const MAX_TEMPLATE_BODY = 200_000;
/** Arrendador + inquilino + dos avales + inmobiliaria y sobra. */
export const MAX_PARTIES = 8;
/** Una firma de canvas pesa ~10 KB. 2 MB es red de seguridad, no objetivo. */
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
/** Días que vive una liga de firma. */
export const SIGNATURE_LINK_DAYS = 14;
/** Intentos de FIRMA fallidos antes de quemar la liga. */
export const SIGNATURE_MAX_ATTEMPTS = 5;
