import "server-only";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { EDU_FILES_BUCKET, EDU_SIGNED_URL_TTL_SECONDS } from "@/lib/edu/estudios-core";

/**
 * DaleControl INSTITUCIONAL — el bucket privado del vertical (`edu-files`).
 *
 * ── POR QUÉ NO SE REUSA src/lib/storage.ts ─────────────────────────────
 * Ese módulo es del dental y su tipo `BucketName` solo admite
 * "patient-files" | "clinic-public": pasarle "edu-files" no compila.
 * Agregarlo ahí sería tocar un archivo COMPARTIDO por productos vivos en
 * producción. El vertical trae su propio helper, con la misma forma y los
 * mismos cuidados — igual que hizo inmuebles con `realty-files`.
 *
 * ── EL BUCKET ES PRIVADO ───────────────────────────────────────────────
 * Lo crea sql/edu-ola-3.sql (`public = false`, sin policies). En la base
 * guardamos el PATH interno, NUNCA una URL: una URL firmada caduca y
 * quedaría muerta en la columna. Al leer se firma on-demand.
 *
 * 🔴 "server-only" arriba no es decoración: este archivo lee
 * SUPABASE_SERVICE_ROLE_KEY, la llave que bypassa RLS. Si un componente
 * "use client" lo importara por accidente, el build FALLA aquí en vez de
 * mandar la llave al navegador.
 */

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

/**
 * ¿Está configurado el Storage? Se pregunta ANTES de prometerle una subida
 * a nadie: sin estas dos variables, `createAdmin` construye un cliente que
 * falla en la primera llamada con un error de red incomprensible.
 */
export function eduStorageConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Firma una URL de SUBIDA. El navegador hace el PUT contra ella y el
 * binario nunca pasa por el servidor.
 *
 * `upsert: true` es la ÚNICA forma de que un reintento sobre el mismo path
 * funcione: el header `x-upsert` del PUT lo ignora Storage en las signed
 * upload URLs, la opción se fija AL FIRMAR. Sin esto, un corte de red a
 * media subida deja el path quemado y el reintento muere con 409. No hay
 * riesgo de pisar nada ajeno: el path lleva un UUID recién generado.
 */
export async function eduSignUpload(
  path: string,
): Promise<{ signedUrl: string; token: string } | null> {
  const { data, error } = await admin()
    .storage.from(EDU_FILES_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    console.error("[instituto/storage] createSignedUploadUrl:", error?.message ?? "sin data");
    return null;
  }
  return { signedUrl: data.signedUrl, token: data.token };
}

/**
 * Firma una URL de LECTURA. Devuelve "" si falla: un enlace vacío se ve en
 * la pantalla como "no se pudo abrir", y eso es preferible a que la lista
 * entera reviente porque un objeto se perdió.
 */
export async function eduSignRead(
  path: string,
  ttlSeconds: number = EDU_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  if (!path) return "";
  try {
    const { data, error } = await admin()
      .storage.from(EDU_FILES_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) {
      console.warn("[instituto/storage] createSignedUrl falló para", path, error?.message);
      return "";
    }
    return data.signedUrl;
  } catch (e) {
    console.warn("[instituto/storage] createSignedUrl excepción:", (e as Error).message);
    return "";
  }
}

/**
 * Firma varias de una vez. Un `createSignedUrls` en lote y no N llamadas:
 * una galería de 40 radiografías con 40 viajes a Storage tarda lo que
 * tarda, y se nota.
 *
 * Devuelve un mapa path → url. Los que fallen simplemente no están.
 */
export async function eduSignReadMany(
  paths: string[],
  ttlSeconds: number = EDU_SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unicos = Array.from(new Set(paths.filter(Boolean)));
  if (unicos.length === 0) return out;
  try {
    const { data, error } = await admin()
      .storage.from(EDU_FILES_BUCKET)
      .createSignedUrls(unicos, ttlSeconds);
    if (error || !data) {
      console.warn("[instituto/storage] createSignedUrls falló:", error?.message);
      return out;
    }
    for (const item of data) {
      if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
    }
  } catch (e) {
    console.warn("[instituto/storage] createSignedUrls excepción:", (e as Error).message);
  }
  return out;
}

/**
 * Tamaño REAL del objeto, preguntado a STORAGE.
 *
 * 🔴 Nunca se usa el tamaño que dice el cliente para nada que importe: un
 * cliente puede mentir, y validar el tope con un número que él controla es
 * regalar el límite justo en los archivos más pesados del sistema.
 *
 * Devuelve null si no se pudo determinar (el objeto todavía no se lista
 * justo después de un PUT grande, un error de red). El caller decide.
 */
export async function eduStorageObjectSize(path: string): Promise<number | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  if (!file) return null;
  try {
    // `search` es substring, no igualdad: se piden varios y se busca el
    // exacto. Con `limit: 1` un nombre que es prefijo de otro devolvería
    // el que no era.
    const { data, error } = await admin()
      .storage.from(EDU_FILES_BUCKET)
      .list(dir, { limit: 100, search: file });
    if (error || !data) {
      console.warn("[instituto/storage] list falló para", path, error?.message);
      return null;
    }
    const hit = data.filter((o) => o.name === file)[0];
    const size = hit && hit.metadata ? (hit.metadata as { size?: unknown }).size : undefined;
    return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : null;
  } catch (e) {
    console.warn("[instituto/storage] list excepción:", (e as Error).message);
    return null;
  }
}

/** Igual que la anterior, con un par de reintentos cortos: justo después
 *  de un PUT grande la fila de storage.objects tarda un instante en
 *  listarse, y rechazar la subida por eso sería tirar 900 MB. */
export async function eduStorageObjectSizeWithRetry(path: string): Promise<number | null> {
  for (let intento = 0; intento < 3; intento++) {
    const size = await eduStorageObjectSize(path);
    if (size != null) return size;
    if (intento < 2) await new Promise((r) => setTimeout(r, 400 * (intento + 1)));
  }
  return null;
}

/** Borra un objeto por su path. Lanza si Storage devuelve error — el
 *  caller decide si es best-effort. */
export async function eduStorageRemove(path: string): Promise<void> {
  const { error } = await admin().storage.from(EDU_FILES_BUCKET).remove([path]);
  if (error) {
    throw new Error(`No se pudo borrar ${EDU_FILES_BUCKET}/${path}: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Ola 3B · lo que hace falta para las firmas y para el análisis de IA
// ═══════════════════════════════════════════════════════════════════════

/**
 * SUBE bytes al bucket privado desde el SERVIDOR.
 *
 * Esto no contradice el "el binario nunca pasa por el servidor" de los
 * estudios: aquí lo que se sube es una FIRMA manuscrita de unos kilobytes
 * que el navegador capturó en un canvas y mandó como data URL, y el
 * servidor tiene que validarla (magic number) antes de guardarla. Firmar
 * una URL de subida para 20 KB sería un viaje de más y dejaría al cliente
 * escribiendo directo en el bucket un archivo que nadie inspeccionó.
 *
 * `upsert: true` para que reintentar la misma firma no muera con 409.
 * Devuelve el PATH guardado, o null si falló — el caller decide si eso
 * invalida la operación (en la firma del paciente NO: perder la imagen es
 * malo, perder el consentimiento que el paciente acaba de dar es peor).
 */
export async function eduStorageUpload(
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<string | null> {
  try {
    const { error } = await admin()
      .storage.from(EDU_FILES_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.error("[instituto/storage] upload falló:", path, error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.error("[instituto/storage] upload excepción:", path, (e as Error).message);
    return null;
  }
}

/**
 * DESCARGA un objeto del bucket privado.
 *
 * Solo la usa el análisis de IA, que necesita los bytes de la imagen para
 * mandárselos al modelo. Devuelve null si no se pudo — el caller contesta
 * con un mensaje escrito para una persona en vez de un 500.
 *
 * ⚠️ Quien llama TIENE que haber comprobado antes el tamaño del objeto
 * (eduStorageObjectSize). Sin eso, una tomografía de 600 MB se cargaría
 * entera en memoria de la función serverless antes de que nadie pudiera
 * decir que no cabe.
 */
export async function eduStorageDownload(path: string): Promise<Buffer | null> {
  try {
    const { data, error } = await admin().storage.from(EDU_FILES_BUCKET).download(path);
    if (error || !data) {
      console.warn("[instituto/storage] download falló para", path, error?.message);
      return null;
    }
    return Buffer.from(await data.arrayBuffer());
  } catch (e) {
    console.warn("[instituto/storage] download excepción:", (e as Error).message);
    return null;
  }
}
