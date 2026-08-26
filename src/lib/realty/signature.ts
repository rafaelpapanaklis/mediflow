import "server-only";

// ═══════════════════════════════════════════════════════════════════════
// INMUEBLES · FIRMA ELECTRÓNICA — hash, liga y evidencia.
//
// ── LA BASE LEGAL, EN TRES LÍNEAS ──────────────────────────────────────
// El Código de Comercio (arts. 89 y 89 bis) y el CFPC (210-A) le dan a la
// firma electrónica la MISMA validez que a la autógrafa, con dos
// condiciones: que sea ATRIBUIBLE al firmante y que se pueda DETECTAR una
// alteración posterior del documento. La NOM-151 NO es requisito de
// validez: aporta sello de tiempo y conservación, nada más.
//
// Este archivo es exactamente esas dos condiciones:
//   · ATRIBUIBLE  → la liga es un secreto de 256 bits que solo tuvo esa
//                   persona, y con cada firma se guarda IP, dispositivo y
//                   la hora del SERVIDOR.
//   · INALTERABLE → el sha256 del documento canónico. Si cambia una coma,
//                   cambia el hash y la evidencia lo delata.
//
// ⚠️ Las PLANTILLAS de contrato (el texto de las cláusulas) las tiene que
// revisar un abogado antes de que un cliente firme con ellas. Este archivo
// garantiza que el documento no se alteró; no que el documento diga lo
// correcto.
//
// ── SE COPIÓ EL MECANISMO DEL DENTAL, NO SE INVENTÓ ────────────────────
// El módulo de consentimientos informados (src/lib/consent/**) ya hacía
// esto: trazo en canvas → validación por magic number → bucket privado →
// hash del texto → PDF con la evidencia impresa. Aquí se repite con tres
// diferencias, todas a propósito y comentadas abajo: el token va HASHEADO,
// el trazo tiene red de abajo, y la firma es de VARIAS partes.
// ═══════════════════════════════════════════════════════════════════════

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { validateMagicNumber } from "@/lib/validate-upload";
import {
  MAX_SIGNATURE_BYTES,
  SIGNATURE_LINK_DAYS,
  type RealtyContractKind,
} from "@/components/realty/contracts/shared";

// ── 1. La huella del documento ─────────────────────────────────────────

/** Versión del canónico. Si algún día cambia la receta, cambia esto y los
 *  hashes viejos siguen siendo verificables con su propia versión. */
export const CANONICAL_VERSION = "dc-realty-contract-v1";

export interface CanonicalInput {
  kind: RealtyContractKind;
  folio: string;
  title: string;
  body: string;
}

/**
 * El texto EXACTO sobre el que se calcula el hash.
 *
 * 🔴 POR QUÉ NO SE HASHEA EL PDF. Sería lo intuitivo y está mal: el PDF no
 * es determinista. @react-pdf incrusta la fecha de creación y subconjuntos
 * de fuentes, así que renderizar dos veces el MISMO contrato da dos
 * archivos con bytes distintos. Un hash así no se podría volver a
 * comprobar nunca — que es lo único para lo que sirve un hash.
 *
 * Se hashea el CONTENIDO, normalizado para que no dependa de detalles que
 * no cambian lo que dice el documento:
 *   · Unicode a NFC — "á" tecleada y "á" pegada son la misma letra.
 *   · CRLF y CR a LF — Windows y Mac no pueden dar hashes distintos.
 *   · Se quitan los espacios al FINAL de cada renglón, que se cuelan solos
 *     al editar y son invisibles.
 *   · Se recortan los saltos de línea sobrantes al principio y al final.
 * Todo lo demás —cada espacio interior, cada coma— SÍ cuenta.
 *
 * El folio y el tipo entran en el canónico para que dos contratos con el
 * mismo cuerpo (dos rentas idénticas del mismo edificio) no compartan
 * huella.
 */
export function canonicalDocument(input: CanonicalInput): string {
  const norm = (s: string): string =>
    String(s ?? "")
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/^\n+/, "")
      .replace(/\n+$/, "");

  return [
    CANONICAL_VERSION,
    `kind:${norm(input.kind)}`,
    `folio:${norm(input.folio)}`,
    `title:${norm(input.title)}`,
    "body:",
    norm(input.body),
  ].join("\n");
}

/** sha256 en hexadecimal del documento canónico. 64 caracteres. */
export function computeDocumentHash(input: CanonicalInput): string {
  return createHash("sha256").update(canonicalDocument(input), "utf8").digest("hex");
}

/**
 * ¿El documento sigue siendo el que se firmó?
 *
 * Comparación en tiempo constante. Aquí el secreto no es el hash (es
 * público, se imprime en el PDF), pero el hábito de comparar así vale la
 * costumbre y no cuesta nada.
 */
export function hashMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** Los 12 primeros del hash, para enseñarlo en pantalla sin ocupar tres líneas. */
export function shortHash(hash: string | null | undefined): string {
  return typeof hash === "string" && hash.length >= 12 ? hash.slice(0, 12) : "—";
}

// ── 2. La liga de firma ────────────────────────────────────────────────

/**
 * Token de 256 bits en base64url (43 caracteres).
 *
 * 🔴 SE DEVUELVE EN CLARO UNA SOLA VEZ Y NO SE GUARDA ASÍ. En la base va
 * `tokenHash`. Es la diferencia deliberada con el resto del repo: los
 * consentimientos del dental, el portal del paciente y /share/p guardan su
 * token en claro con @unique, y funcionan; pero un token en claro es una
 * credencial durmiendo en una tabla, y esta abre un documento que se está
 * a punto de firmar. Con el hash, quien se lleve un volcado de la base no
 * puede firmar por nadie: no hay forma de reconstruir la liga.
 *
 * El precedente correcto que ya existe en el propio vertical es
 * RealtyClientAuthToken.codeHash (portal del cliente): ahí también el
 * secreto en claro no toca la base. Aquí se usa sha256 y no bcrypt porque
 * esto son 256 bits aleatorios, no un código de 6 dígitos: no hay
 * diccionario que probar, así que un hash lento no compra nada y sí
 * costaría una comparación cara en cada visita a la liga.
 */
export function mintSignatureToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** El sha256 con el que se busca la fila. Nunca al revés. */
export function hashToken(token: string): string {
  return createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");
}

/**
 * Forma del token, ANTES de tocar la base.
 *
 * Un `/i/firmar/loquesea` no merece una consulta: se descarta aquí. Además
 * evita que un token absurdamente largo llegue al índice.
 */
export function looksLikeToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

/** Caducidad de una liga recién emitida. */
export function signatureLinkExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SIGNATURE_LINK_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * La URL que se le manda a la persona.
 *
 * `origin` viene del request porque NEXT_PUBLIC_APP_URL no está puesta en
 * todos los ambientes; se prefiere la variable cuando existe para que una
 * liga mandada desde una preview de Vercel no apunte a la preview.
 */
export function signatureUrl(token: string, origin?: string | null): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || origin || "").replace(/\/+$/, "");
  return `${base}/i/firmar/${token}`;
}

// ── 3. El trazo ────────────────────────────────────────────────────────

const ALLOWED_STROKE_MIMES = ["image/png", "image/jpeg", "image/webp"];

export interface StrokeCheck {
  /** null = el trazo es válido. */
  error: string | null;
  /** Código HTTP sugerido (400 formato, 413 tamaño). */
  status: number;
  buffer: Buffer;
  /** El data URL ya normalizado, para la red de abajo (ver contracts.ts). */
  dataUrl: string;
}

const EMPTY = Buffer.alloc(0);

/**
 * Valida el data URL que sale de `canvas.toDataURL("image/png")`.
 *
 * Copia deliberada de validateSignatureDataUrl (src/lib/consent/signature.ts)
 * con dos cambios: el tope baja de 5 MB a 2 MB (una firma de canvas pesa
 * ~10 KB; 5 MB era holgura del módulo dental, que también acepta fotos) y
 * se devuelve el data URL normalizado porque aquí sirve de respaldo.
 *
 * 🔴 EL MAGIC NUMBER NO ES PARANOIA. El `data:image/png;base64,` lo escribe
 * quien manda la petición, y esta ruta es PÚBLICA (la abre cualquiera con
 * la liga). Sin comprobar los bytes de verdad, esto sería un endpoint para
 * subir cualquier archivo al bucket con la etiqueta de una imagen.
 */
export async function validateSignatureStroke(input: unknown): Promise<StrokeCheck> {
  if (typeof input !== "string" || !input.startsWith("data:image/")) {
    return { error: "La firma no llegó bien. Vuelve a trazarla.", status: 400, buffer: EMPTY, dataUrl: "" };
  }
  if (input.length > MAX_SIGNATURE_BYTES * 2) {
    // base64 abulta ~4/3; este corte es antes de decodificar, para no
    // materializar en memoria lo que ya sabemos que no cabe.
    return { error: "La firma es demasiado pesada.", status: 413, buffer: EMPTY, dataUrl: "" };
  }
  const buffer = Buffer.from(input.split(",")[1] ?? "", "base64");
  if (buffer.length === 0) {
    return { error: "La firma está vacía. Traza tu firma en el recuadro.", status: 400, buffer: EMPTY, dataUrl: "" };
  }
  if (buffer.length > MAX_SIGNATURE_BYTES) {
    return { error: "La firma es demasiado pesada.", status: 413, buffer: EMPTY, dataUrl: "" };
  }
  const magicError = await validateMagicNumber(buffer, ALLOWED_STROKE_MIMES);
  if (magicError) {
    return {
      error: "Ese archivo no es una firma válida.",
      status: 400,
      buffer: EMPTY,
      dataUrl: "",
    };
  }
  return { error: null, status: 200, buffer, dataUrl: input };
}

/** sha256 de los bytes del trazo. Va en la evidencia junto al del documento. */
export function strokeHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Dónde vive el trazo dentro del bucket PRIVADO realty-files.
 *
 * Empieza por accountId como todo lo demás del vertical: así un listado por
 * prefijo nunca cruza inquilinos y `pathBelongsToAccount` lo valida.
 */
export function signatureStoragePath(
  accountId: string,
  contractId: string,
  partyId: string,
): string {
  return `${accountId}/contratos/${contractId}/firmas/${partyId}.png`;
}

// ── 4. La evidencia del dispositivo ────────────────────────────────────

export interface SignerEvidence {
  ip: string | null;
  userAgent: string | null;
}

/**
 * IP y dispositivo de quien firma.
 *
 * Misma cascada de cabeceras que extractAuditMeta (src/lib/audit.ts) y que
 * getClientIp (src/lib/failban.ts): x-forwarded-for → x-real-ip →
 * cf-connecting-ip. Se toma el PRIMER valor del XFF, que es el cliente; los
 * siguientes son los proxys.
 *
 * El user-agent se recorta a 400 caracteres, igual que el consentimiento:
 * hay navegadores que mandan cadenas absurdas y esto es evidencia, no un
 * registro de telemetría.
 *
 * 🔴 LA FECHA NO SALE DE AQUÍ. La hora de la firma es la del SERVIDOR
 * (DEFAULT CURRENT_TIMESTAMP en la tabla). Un reloj de teléfono lo cambia
 * cualquiera desde ajustes, y una evidencia con la hora que dijo el
 * firmante no prueba nada.
 */
export function signerEvidence(headers: Headers): SignerEvidence {
  const xff = headers.get("x-forwarded-for");
  const ip =
    (xff ? xff.split(",")[0]?.trim() : "") ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    null;
  const ua = (headers.get("user-agent") ?? "").slice(0, 400);
  return { ip: ip || null, userAgent: ua || null };
}
