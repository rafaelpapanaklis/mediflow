// Cache de archivos pesados del expediente (CBCT .zip, .dcm, modelos 3D) en
// IndexedDB del navegador. Evita re-descargar de Supabase cada vez que se abre
// el visor: las signed URLs cambian en cada apertura (TTL corto), pero cada
// archivo tiene un fileId ESTABLE (PatientFile.id) — cacheamos por fileId.
//
// Objetivo: reducir el egress/bandwidth de Supabase. Reabrir el mismo estudio
// (incluso tras recargar la página) sirve el blob desde disco, sin red.
//
// Todo es de degradación elegante: si IndexedDB no existe o falla, getCachedBlob
// devuelve null y fetchWithCache cae a un fetch normal. Nada de esto lanza.

const DB_NAME = "mediflow-files";
const STORE = "blobs";
// Tope total de la cache. Por encima, se eliminan las entradas más antiguas
// (LRU por savedAt) hasta bajar del límite. 1.5 GB cubre varios CBCT.
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024;

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

// Promesa de apertura memoizada. Si la apertura falla, se limpia para reintentar
// en una llamada posterior.
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // Claves fuera de línea: la clave es el fileId, pasado explícitamente
          // en cada put. El valor solo guarda { blob, size, savedAt }.
          db.createObjectStore(STORE);
        }
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

// Recorre el store y junta metadatos (sin materializar los bytes del blob: el
// Blob de IndexedDB es una referencia perezosa a disco, leer .size no lo carga).
function listMeta(db: IDBDatabase): Promise<MetaEntry[]> {
  return new Promise((resolve) => {
    const out: MetaEntry[] = [];
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
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

function del(db: IDBDatabase, key: IDBValidKey): Promise<void> {
  return new Promise((resolve) => {
    try {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
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
function putRecord(db: IDBDatabase, fileId: string, value: CacheRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).put(value, fileId);
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error || new Error("abort"));
      t.onerror = () => reject(t.error || new Error("error"));
    } catch (e) {
      reject(e);
    }
  });
}

// Elimina entradas más antiguas (savedAt asc) hasta que el total + el entrante
// quepa bajo el tope.
async function enforceCap(db: IDBDatabase, incoming: number): Promise<void> {
  try {
    const entries = await listMeta(db);
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let total = entries.reduce((s, e) => s + e.size, 0) + incoming;
    for (const e of entries) {
      if (total <= MAX_TOTAL_BYTES) break;
      await del(db, e.key);
      total -= e.size;
    }
  } catch {
    /* degradación: si no se puede limpiar, el put fallará y se ignora */
  }
}

// Borra las más antiguas hasta liberar al menos `needed` bytes (para reintentar
// tras un error de cuota).
async function evictOldest(db: IDBDatabase, needed: number): Promise<void> {
  try {
    const entries = await listMeta(db);
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let freed = 0;
    for (const e of entries) {
      await del(db, e.key);
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
