// Cache de archivos pesados del expediente (CBCT .zip, .dcm, modelos 3D) en
// IndexedDB del navegador. Evita re-descargar de Supabase cada vez que se abre
// el visor: las signed URLs cambian en cada apertura (TTL corto), pero cada
// archivo tiene un fileId ESTABLE (PatientFile.id) — cacheamos por fileId.
//
// Dos stores:
//   - "blobs":   el archivo crudo (.zip / .dcm / modelo). Ahorra egress de red.
//   - "decoded": los cortes CBCT YA decodificados (Int16 HU) por fileId. Ahorra
//                CPU/jank: reabrir un estudio salta descompresión + decode.
//
// Todo es de degradación elegante: si IndexedDB no existe o falla, los lectores
// devuelven null y los escritores se ignoran en silencio. Nada de esto lanza.

const DB_NAME = "mediflow-files";
// v2: agrega el store "decoded" junto al "blobs" de v1 (migración no destructiva).
const DB_VERSION = 2;
const STORE = "blobs";
const DECODED_STORE = "decoded";
// Tope total de la cache de blobs (.zip crudos). Por encima, se eliminan las
// entradas más antiguas (LRU por savedAt) hasta bajar del límite. 1.5 GB cubre
// varios CBCT.
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024;
// Tope propio del store de decodificados (los cortes Int16 suelen pesar más que
// el .zip comprimido). 1.2 GB.
const MAX_DECODED_BYTES = 1.2 * 1024 * 1024 * 1024;

interface CacheRecord {
  blob: Blob;
  size: number;
  savedAt: number;
}

interface MetaEntry {
  key: IDBValidKey;
  size: number;
  savedAt: number;
}

// Valor que cabe en cualquier store: el registro de blobs o el de cortes
// decodificados (ambos traen size + savedAt para la contabilidad LRU).
type StoredRecord = CacheRecord | DecodedRecord;

// Promesa de apertura memoizada. Si la apertura falla, se limpia para reintentar
// en una llamada posterior.
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Claves fuera de línea: la clave es el fileId, pasado explícitamente en
        // cada put. IndexedDB preserva los stores existentes al subir de versión,
        // así que crear "decoded" no borra "blobs".
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(DECODED_STORE)) db.createObjectStore(DECODED_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    if (!db) dbPromise = null; // permite reintentar la apertura más tarde
    return db;
  });
  return dbPromise;
}

// Recorre un store y junta metadatos (sin materializar los bytes del blob: el
// Blob de IndexedDB es una referencia perezosa a disco, leer .size no lo carga).
function listMeta(db: IDBDatabase, storeName: string = STORE): Promise<MetaEntry[]> {
  return new Promise((resolve) => {
    const out: MetaEntry[] = [];
    try {
      const store = db.transaction(storeName, "readonly").objectStore(storeName);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          resolve(out);
          return;
        }
        const v = cur.value as Partial<CacheRecord> | undefined;
        out.push({
          key: cur.key,
          size: v && typeof v.size === "number" ? v.size : 0,
          savedAt: v && typeof v.savedAt === "number" ? v.savedAt : 0,
        });
        cur.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

function del(db: IDBDatabase, key: IDBValidKey, storeName: string = STORE): Promise<void> {
  return new Promise((resolve) => {
    try {
      const store = db.transaction(storeName, "readwrite").objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Escribe un registro. Resuelve cuando la transacción confirma; rechaza si se
// aborta (p. ej. QuotaExceededError) para que el llamador pueda liberar y
// reintentar.
function putRecord(
  db: IDBDatabase,
  fileId: string,
  value: StoredRecord,
  storeName: string = STORE,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(storeName, "readwrite");
      t.objectStore(storeName).put(value, fileId);
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error || new Error("abort"));
      t.onerror = () => reject(t.error || new Error("error"));
    } catch (e) {
      reject(e);
    }
  });
}

// Elimina entradas más antiguas (savedAt asc) hasta que el total + el entrante
// quepa bajo el tope del store indicado.
async function enforceCap(
  db: IDBDatabase,
  incoming: number,
  storeName: string = STORE,
  cap: number = MAX_TOTAL_BYTES,
): Promise<void> {
  try {
    const entries = await listMeta(db, storeName);
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let total = entries.reduce((s, e) => s + e.size, 0) + incoming;
    for (const e of entries) {
      if (total <= cap) break;
      await del(db, e.key, storeName);
      total -= e.size;
    }
  } catch {
    /* degradación: si no se puede limpiar, el put fallará y se ignora */
  }
}

// Borra las más antiguas hasta liberar al menos `needed` bytes (para reintentar
// tras un error de cuota).
async function evictOldest(db: IDBDatabase, needed: number, storeName: string = STORE): Promise<void> {
  try {
    const entries = await listMeta(db, storeName);
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let freed = 0;
    for (const e of entries) {
      await del(db, e.key, storeName);
      freed += e.size;
      if (freed >= needed) break;
    }
  } catch {
    /* ignore */
  }
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return (
    !!err &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22)
  );
}

/**
 * Devuelve el blob cacheado para un fileId, o null si no está o si IndexedDB no
 * está disponible. NUNCA lanza.
 */
export async function getCachedBlob(fileId: string): Promise<Blob | null> {
  if (!fileId) return null;
  try {
    const db = await openDB();
    if (!db) return null;
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const rec = await new Promise<CacheRecord | undefined>((resolve, reject) => {
      const req = store.get(fileId);
      req.onsuccess = () => resolve(req.result as CacheRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    return rec && rec.blob instanceof Blob ? rec.blob : null;
  } catch {
    return null;
  }
}

/**
 * Guarda un blob por fileId (best-effort). Aplica el tope total por LRU antes de
 * guardar; si el put falla por cuota, libera las entradas más antiguas y
 * reintenta una vez; si aún falla, se ignora en silencio. NUNCA lanza.
 */
export async function putCachedBlob(fileId: string, blob: Blob): Promise<void> {
  if (!fileId || !(blob instanceof Blob)) return;
  try {
    const db = await openDB();
    if (!db) return;
    const size = blob.size;
    await enforceCap(db, size);
    const value: CacheRecord = { blob, size, savedAt: Date.now() };
    try {
      await putRecord(db, fileId, value);
    } catch (e) {
      if (isQuotaError(e)) {
        await evictOldest(db, size);
        try {
          await putRecord(db, fileId, { blob, size, savedAt: Date.now() });
        } catch {
          /* sigue sin caber: se ignora */
        }
      }
      /* otros errores: se ignoran (degradación) */
    }
  } catch {
    /* IndexedDB no disponible o transacción fallida: se ignora */
  }
}

/**
 * Devuelve el blob del archivo, sirviéndolo desde la cache (IndexedDB) por
 * fileId cuando existe — sin tocar la red. Si no está cacheado, lo descarga de
 * `url`, lo guarda best-effort (sin bloquear el retorno) y lo devuelve.
 *
 * Si IndexedDB no existe o falla, simplemente hace un fetch normal. Lanza solo
 * si la descarga de red falla (respuesta no-OK o error de red), igual que un
 * fetch directo, para que el visor muestre su estado de error.
 */
export async function fetchWithCache(fileId: string, url: string): Promise<Blob> {
  const cached = await getCachedBlob(fileId);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();
  // Guarda en segundo plano: no esperamos a IndexedDB para devolver el blob.
  void putCachedBlob(fileId, blob);
  return blob;
}

/* -------------------------------------------------------------------------- */
/* Cache de CORTES DECODIFICADOS (Int16 HU) por fileId.                        */
/* Reabrir un estudio CBCT salta descompresión + decodificación por completo.  */
/* -------------------------------------------------------------------------- */

export interface DecodedSliceRecord {
  rows: number;
  cols: number;
  pixels: Int16Array;
  center: number;
  width: number;
  invert: boolean;
  order: number;
}

interface DecodedRecord {
  slices: DecodedSliceRecord[];
  size: number;
  savedAt: number;
}

/**
 * Devuelve los cortes decodificados cacheados para un fileId, o null si no están
 * o IndexedDB no está disponible. Valida defensivamente la forma del registro
 * (los Int16Array se restauran solos vía structured clone). NUNCA lanza.
 */
export async function getDecodedSlices(fileId: string): Promise<DecodedSliceRecord[] | null> {
  if (!fileId) return null;
  try {
    const db = await openDB();
    if (!db) return null;
    const store = db.transaction(DECODED_STORE, "readonly").objectStore(DECODED_STORE);
    const rec = await new Promise<DecodedRecord | undefined>((resolve, reject) => {
      const req = store.get(fileId);
      req.onsuccess = () => resolve(req.result as DecodedRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    const slices = rec?.slices;
    if (Array.isArray(slices) && slices.length > 0 && slices[0]?.pixels instanceof Int16Array) {
      return slices;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Guarda los cortes decodificados por fileId (best-effort). Aplica un tope LRU
 * propio antes de guardar; ante QuotaExceededError libera las entradas más
 * antiguas y reintenta una vez; si aún falla, se ignora. NUNCA lanza.
 */
export async function putDecodedSlices(fileId: string, slices: DecodedSliceRecord[]): Promise<void> {
  if (!fileId || !Array.isArray(slices) || slices.length === 0) return;
  try {
    const db = await openDB();
    if (!db) return;
    let size = 0;
    for (const s of slices) size += s.pixels?.byteLength || 0;
    await enforceCap(db, size, DECODED_STORE, MAX_DECODED_BYTES);
    const value: DecodedRecord = { slices, size, savedAt: Date.now() };
    try {
      await putRecord(db, fileId, value, DECODED_STORE);
    } catch (e) {
      if (isQuotaError(e)) {
        await evictOldest(db, size, DECODED_STORE);
        try {
          await putRecord(db, fileId, { slices, size, savedAt: Date.now() }, DECODED_STORE);
        } catch {
          /* sigue sin caber: se ignora */
        }
      }
      /* otros errores: se ignoran (degradación) */
    }
  } catch {
    /* IndexedDB no disponible o transacción fallida: se ignora */
  }
}
