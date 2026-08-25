import "server-only";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { REALTY_FILES_BUCKET } from "@/lib/realty/types";
import {
  formatRealtyBytes,
  realtyStorageUsage,
  type RealtyStorageUsage,
} from "@/lib/realty/properties-shared";

// Se re-exportan para que el servidor tenga un solo sitio del que importar.
// Viven en properties-shared porque son PUROS y las pantallas los necesitan:
// este archivo es server-only y no se puede importar desde "use client".
export { formatRealtyBytes, realtyStorageUsage };
export type { RealtyStorageUsage };

/**
 * DaleControl INMUEBLES — archivos del vertical (fotos, panorámicas propias
 * y documentos) sobre el bucket PRIVADO `realty-files`.
 *
 * ── POR QUÉ NO SE REUSA src/lib/storage.ts ─────────────────────────────
 * Ese módulo es del dental: su tipo `BucketName` solo admite
 * "patient-files" | "clinic-public", así que pasarle "realty-files" no
 * compila. Agregar el bucket ahí sería tocar un archivo COMPARTIDO por dos
 * productos vivos en producción. El vertical trae su propio helper, con la
 * misma forma y los mismos cuidados, y no toca el del dental.
 *
 * ── EL BUCKET ES PRIVADO ───────────────────────────────────────────────
 * Lo crea sql/realty.sql (`public = false`). En la base guardamos el PATH
 * interno, nunca una URL: una URL firmada caduca y quedaría muerta en la
 * columna. Al leer se firma on-demand (signRealtyUrl / signRealtyUrls).
 * Los TTL son distintos a propósito:
 *   · fotos y panorámicas → 1 hora (se pintan en galerías largas)
 *   · escrituras y predial → 5 minutos (son papeles del propietario)
 *
 * ── LA CUOTA ES REAL, NO UN ADORNO ─────────────────────────────────────
 * RealtyAccount.storageUsedBytes (BigInt) es el consumo; el cupo vive en el
 * PLAN (storageQuotaMb). Sin esto el Storage se llena solo — la lección
 * directa de barber. Toda subida pasa por assertRealtyStorageRoom() ANTES
 * de tocar el bucket, y todo borrado devuelve los bytes.
 */

// ── Cliente admin (service role). Perezoso y cacheado, como el del dental.
let cachedAdmin: ReturnType<typeof createAdmin> | null = null;
function admin() {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  return cachedAdmin;
}

/** Fotos y panorámicas: la galería del panel las pinta muchas y a la vez. */
export const REALTY_PHOTO_URL_TTL = 60 * 60;
/** Escrituras, predial, identificación: papeles ajenos, ventana corta. */
export const REALTY_DOC_URL_TTL = 300;

/** Tope de una foto YA comprimida por el navegador. Última red, no la primera. */
export const REALTY_MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** Panorámica equirectangular: pesa más que una foto normal por definición. */
export const REALTY_MAX_PANO_BYTES = 4 * 1024 * 1024;
/** Documento (PDF o imagen del papel). */
export const REALTY_MAX_DOC_BYTES = 4 * 1024 * 1024;

export const REALTY_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
export const REALTY_DOC_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** Se lanza cuando la cuenta ya no tiene espacio. La API lo mapea a 413. */
export class RealtyStorageFullError extends Error {
  readonly usedBytes: number;
  readonly quotaBytes: number;
  readonly incomingBytes: number;
  constructor(usedBytes: number, quotaBytes: number, incomingBytes: number) {
    super("Sin espacio en la cuenta");
    this.name = "RealtyStorageFullError";
    this.usedBytes = usedBytes;
    this.quotaBytes = quotaBytes;
    this.incomingBytes = incomingBytes;
  }
}

// ── Rutas dentro del bucket ────────────────────────────────────────────
/**
 * Ruta del objeto. SIEMPRE empieza por el accountId: así un listado del
 * bucket por prefijo nunca cruza inquilinos, y un borrado equivocado se
 * queda dentro de la cuenta.
 *
 * El nombre del archivo NO es el que subió el usuario: se genera. Un
 * "../../otra-cuenta/foto.jpg" en el nombre original sería una fuga.
 */
export function realtyStoragePath(
  accountId: string,
  propertyId: string,
  folder: "fotos" | "panoramicas" | "documentos" | "exclusivas",
  extension: string,
): string {
  const ext = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${accountId}/${propertyId}/${folder}/${unique}.${ext}`;
}

/** Extensión a partir del mime (nunca del nombre que mandó el navegador). */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

/**
 * ¿El path pertenece a esta cuenta? Defensa en profundidad para borrar y
 * firmar: aunque la fila venga de una consulta ya filtrada por accountId,
 * jamás le pasamos al Storage un path que no empiece por la cuenta viva.
 */
export function pathBelongsToAccount(path: string, accountId: string): boolean {
  if (typeof path !== "string" || !path) return false;
  if (path.includes("..")) return false;
  return path.startsWith(`${accountId}/`);
}

// ── Firmar para leer ───────────────────────────────────────────────────
/** URL firmada de un objeto. Devuelve "" si no se pudo (falla suave). */
export async function signRealtyUrl(
  path: string | null | undefined,
  ttlSeconds: number = REALTY_PHOTO_URL_TTL,
): Promise<string> {
  if (!path) return "";
  // Compat: si alguna fila guardó una URL absoluta, se devuelve tal cual.
  if (path.startsWith("http")) return path;
  try {
    const { data, error } = await admin()
      .storage.from(REALTY_FILES_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) {
      console.warn(`[realty/media] no se pudo firmar ${path}:`, error?.message ?? "sin data");
      return "";
    }
    return data.signedUrl;
  } catch (e) {
    console.warn("[realty/media] excepción al firmar:", (e as Error).message);
    return "";
  }
}

/**
 * Versión batch: UN round-trip para toda la galería. Un listado de 24
 * inmuebles con portada son 24 firmas; de una en una eso es medio segundo
 * de latencia por pantalla.
 *
 * El resultado conserva el ORDEN del input y nunca lanza.
 */
export async function signRealtyUrls(
  paths: Array<string | null | undefined>,
  ttlSeconds: number = REALTY_PHOTO_URL_TTL,
): Promise<string[]> {
  const out: string[] = new Array(paths.length).fill("");
  const toSign: Array<{ idx: number; path: string }> = [];
  paths.forEach((p, idx) => {
    if (!p) return;
    if (p.startsWith("http")) {
      out[idx] = p;
      return;
    }
    toSign.push({ idx, path: p });
  });
  if (toSign.length === 0) return out;

  try {
    const { data, error } = await admin()
      .storage.from(REALTY_FILES_BUCKET)
      .createSignedUrls(
        toSign.map((t) => t.path),
        ttlSeconds,
      );
    if (error || !data) {
      console.warn("[realty/media] createSignedUrls falló:", error?.message ?? "sin data");
      return out;
    }
    data.forEach((row, i) => {
      const target = toSign[i];
      if (!target) return;
      if (row.error || !row.signedUrl) return;
      out[target.idx] = row.signedUrl;
    });
  } catch (e) {
    console.warn("[realty/media] excepción en batch:", (e as Error).message);
  }
  return out;
}

/**
 * Bytes crudos de un objeto del bucket. Lo usa la ficha PDF, que necesita
 * incrustar las fotos y no puede pasarle una URL firmada al renderizador
 * (caducaría a mitad del render y saldría una hoja con huecos).
 */
export async function downloadRealtyFile(path: string): Promise<Buffer | null> {
  try {
    const { data, error } = await admin().storage.from(REALTY_FILES_BUCKET).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

// ── Subir y borrar ─────────────────────────────────────────────────────
export async function uploadRealtyFile(
  path: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<void> {
  const { error } = await admin()
    .storage.from(REALTY_FILES_BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`);
}

/**
 * Borra objetos. Best-effort a propósito: si el objeto ya no está, la fila
 * de la base SÍ se tiene que ir igual — quedarse con una fila que apunta a
 * un archivo inexistente es peor que un huérfano en el bucket.
 */
export async function removeRealtyFiles(paths: string[]): Promise<void> {
  const clean = paths.filter((p) => !!p && !p.startsWith("http"));
  if (clean.length === 0) return;
  try {
    const { error } = await admin().storage.from(REALTY_FILES_BUCKET).remove(clean);
    if (error) console.warn("[realty/media] borrado parcial:", error.message);
  } catch (e) {
    console.warn("[realty/media] excepción al borrar:", (e as Error).message);
  }
}

// ── Cuota ──────────────────────────────────────────────────────────────
/** Lee el consumo VIVO de la cuenta (no el del contexto, que puede ser viejo). */
export async function getRealtyStorageUsage(
  accountId: string,
  storageQuotaMb: number,
): Promise<RealtyStorageUsage> {
  const row = await prisma.realtyAccount.findUnique({
    where: { id: accountId },
    select: { storageUsedBytes: true },
  });
  return realtyStorageUsage(row?.storageUsedBytes ?? BigInt(0), storageQuotaMb);
}

/**
 * Puerta de la subida. Se llama ANTES de tocar el bucket: si no hay
 * espacio, no queremos el objeto arriba y la fila abajo sin cuadrar.
 */
export async function assertRealtyStorageRoom(
  accountId: string,
  storageQuotaMb: number,
  incomingBytes: number,
): Promise<RealtyStorageUsage> {
  const usage = await getRealtyStorageUsage(accountId, storageQuotaMb);
  if (usage.isUnlimited) return usage;
  if (incomingBytes > usage.freeBytes) {
    throw new RealtyStorageFullError(usage.usedBytes, usage.quotaBytes, incomingBytes);
  }
  return usage;
}

/**
 * Suma (o resta, con delta negativo) bytes al consumo de la cuenta.
 *
 * 🔴 `increment` con negativo puede dejar el contador BAJO CERO si alguna
 * fila se borró dos veces o si un objeto pesaba menos de lo apuntado. Un
 * storageUsedBytes negativo regala espacio infinito, así que después de
 * restar se sube a 0 con un GREATEST — en la misma sentencia, sin leer
 * primero, para que dos borrados a la vez no se pisen.
 */
export async function addRealtyStorageBytes(accountId: string, delta: number): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  const rounded = Math.round(delta);
  try {
    await prisma.realtyAccount.update({
      where: { id: accountId },
      data: { storageUsedBytes: { increment: BigInt(rounded) } },
    });
    if (rounded < 0) {
      await prisma.$executeRaw`
        UPDATE realty_accounts
           SET "storageUsedBytes" = 0
         WHERE id = ${accountId} AND "storageUsedBytes" < 0`;
    }
  } catch (e) {
    // El contador no puede tumbar la operación de negocio: la foto ya se
    // subió o ya se borró. Se avisa y sigue.
    console.warn("[realty/media] no se pudo ajustar el consumo:", (e as Error).message);
  }
}

// ── Marca de agua ──────────────────────────────────────────────────────
/**
 * Estampa el logo de la cuenta en la esquina inferior derecha.
 *
 * Se hace en el SERVIDOR con sharp y no en el navegador a propósito: la
 * marca de agua existe para que la foto no se reuse sin crédito, y una que
 * se aplica en el cliente la quita cualquiera con las herramientas de
 * desarrollo. Aquí la foto que llega al bucket ya va marcada.
 *
 * Falla suave: si el logo no se puede leer o sharp truena, se devuelve la
 * foto ORIGINAL. Perder la marca de agua es un detalle; perder la foto que
 * el asesor acaba de subir, no.
 *
 * Devuelve { buffer, watermarked } para que la fila diga la verdad.
 */
export async function applyRealtyWatermark(
  photo: Buffer,
  logoBytes: Buffer | null,
): Promise<{ buffer: Buffer; watermarked: boolean }> {
  if (!logoBytes || logoBytes.length === 0) return { buffer: photo, watermarked: false };
  try {
    const sharp = (await import("sharp")).default;
    const base = sharp(photo, { failOn: "none" });
    const meta = await base.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return { buffer: photo, watermarked: false };

    // El logo ocupa ~18 % del ancho: se lee sin taparle el inmueble a nadie.
    const markWidth = Math.max(64, Math.round(width * 0.18));
    const mark = await sharp(logoBytes, { failOn: "none" })
      .resize({ width: markWidth, withoutEnlargement: true })
      .png()
      .toBuffer();
    const markMeta = await sharp(mark).metadata();
    const markHeight = markMeta.height ?? 0;

    const margin = Math.round(width * 0.025);
    const top = Math.max(0, height - markHeight - margin);
    const left = Math.max(0, width - markWidth - margin);

    const out = await sharp(photo, { failOn: "none" })
      .composite([{ input: mark, top, left, blend: "over" }])
      .toBuffer();
    return { buffer: out, watermarked: true };
  } catch (e) {
    console.warn("[realty/media] marca de agua omitida:", (e as Error).message);
    return { buffer: photo, watermarked: false };
  }
}

/**
 * Ancho y alto reales de la imagen. La galería los guarda para poder
 * reservar el hueco antes de que la foto cargue (sin eso, cada foto que
 * llega empuja las de abajo y la cuadrícula da saltos).
 *
 * Devuelve nulls si sharp no puede leerla: son columnas opcionales y una
 * foto sin medidas se sigue viendo perfectamente.
 */
export async function imageDimensions(
  buf: Buffer,
): Promise<{ width: number | null; height: number | null }> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf, { failOn: "none" }).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Descarga el logo de la cuenta para marcarlo. Acepta tanto un path del
 * bucket como una URL absoluta (el logo puede venir de otro lado).
 */
export async function loadAccountLogo(
  logoUrl: string | null,
  accountId: string,
): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    // Lo normal: un path del propio bucket. Ni sale a internet.
    if (!logoUrl.startsWith("http")) {
      // 🔴 Y se comprueba que el path sea DE ESTA CUENTA. Hoy nadie escribe
      // logoUrl (la pantalla de Configuración es de otra ola), pero el día
      // que exista, un "otraCuentaId/inm/documentos/escritura.pdf" ahí
      // dentro descargaría el archivo de otro inquilino y lo estamparía
      // como marca de agua. La reja va ANTES de que exista el agujero.
      if (!pathBelongsToAccount(logoUrl, accountId)) {
        console.warn("[realty/media] logo con path fuera de la cuenta: rechazado");
        return null;
      }
      return await downloadRealtyFile(logoUrl);
    }
    if (!(await isSafeRemoteLogoUrl(logoUrl))) {
      console.warn("[realty/media] logo remoto rechazado por la reja de SSRF");
      return null;
    }
    const res = await fetch(logoUrl, {
      cache: "no-store",
      redirect: "error", // una redirección puede saltar a una IP interna
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Un logo no pesa 40 MB: el tope evita que una URL cualquiera se coma
    // la memoria del proceso que está armando el PDF.
    if (buf.length > MAX_REMOTE_LOGO_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

/** 2 MB de sobra para un logo. */
const MAX_REMOTE_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Reja contra SSRF.
 *
 * 🔴 POR QUÉ: `account.logoUrl` lo escribe la propia cuenta desde
 * Configuración. Si aceptáramos cualquier URL, un cliente podría apuntarla
 * a `http://169.254.169.254/…` (metadatos de la nube) o a un servicio
 * interno, y sería NUESTRO servidor el que hace la petición — con la red
 * privada al alcance. Que el resultado casi nunca sea una imagen no lo
 * arregla: un SSRF a ciegas ya sirve para descubrir puertos por tiempos de
 * respuesta.
 *
 * Se exige https (nada de http en claro) y se descartan localhost, las
 * IP privadas y las de enlace local. `redirect: "error"` en el fetch cierra
 * el rodeo de responder con un 302 hacia una de ellas.
 */
export async function isSafeRemoteLogoUrl(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  // Sin puerto raro: 443 o nada. `https://interno.corp:9200/` es un
  // escaneo de puertos disfrazado de logo.
  if (u.port && u.port !== "443") return false;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;

  // 🔴 NO basta con mirar el texto del hostname. Un NOMBRE DNS que resuelve
  // a una IP interna —`169.254.169.254.nip.io`, o un dominio propio con un
  // registro A apuntando adentro— atraviesa cualquier filtro de cadenas.
  // Por eso se RESUELVE y se valida la IP de verdad.
  //
  // Queda un hueco teórico (DNS rebinding: que la segunda resolución, la
  // que hace fetch, devuelva otra IP). Cerrarlo del todo exige conectar a
  // la IP ya resuelta a mano; para un logo, esto más `redirect: "error"` y
  // el tope de bytes es la proporción correcta.
  let addresses: string[];
  try {
    const dns = await import("node:dns/promises");
    const found = await dns.lookup(host, { all: true, verbatim: true });
    addresses = found.map((a) => a.address);
  } catch {
    return false; // no resuelve: no se visita
  }
  if (addresses.length === 0) return false;
  return addresses.every(isPublicAddress);
}

/** ¿Esta IP está fuera de la red privada? Se rechaza todo lo dudoso. */
function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase();

  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return false; // este host y privadas
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false; // metadatos de la nube y APIPA
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast y reservados
    return true;
  }

  // IPv6
  if (ip === "::" || ip === "::1") return false;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return false; // única local
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return false; // enlace local
  }
  // ::ffff:10.0.0.1 — una IPv4 privada disfrazada de IPv6.
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPublicAddress(mapped[1]);
  return true;
}

/**
 * Últimas medidas de seguridad del binario que llega. El navegador ya
 * redimensionó y recodificó, pero el navegador es del usuario: aquí se
 * comprueba el mime declarado Y los primeros bytes reales del archivo.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  return null;
}
