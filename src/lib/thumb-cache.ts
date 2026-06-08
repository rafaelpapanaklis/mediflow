// Cache de las MINIATURAS PNG (dataURL) de los modelos 3D del expediente, en
// IndexedDB del navegador. Render-to-image cuesta crear un contexto WebGL y
// rasterizar la malla; persistir el PNG por fileId evita re-renderizar al volver
// a la pestaña de modelos (ahorra GPU/CPU y contextos WebGL).
//
// Base de datos PROPIA y separada de la de archivos (dicom-cache.ts) para no
// acoplar versiones de schema. Todo es de degradación elegante: si IndexedDB no
// existe o falla, el lector devuelve null y el escritor se ignora. Nada lanza.

const DB_NAME = "mediflow-thumbs";
const STORE = "thumbs";
// Tope total: las miniaturas son chicas (PNG de 160px, ~5-25 KB en dataURL).
// Por encima, LRU por savedAt hasta bajar del límite.
const MAX_THUMB_BYTES = 64 * 1024 * 1024;

interface ThumbRecord {
  dataUrl: string;
  size: number;
  savedAt: number;
}

interface MetaEntry {
  key: IDBValidKey;
  size: number;
  savedAt: number;
}

// Promesa de apertura memoizada; si falla, se limpia para reintentar luego.
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    if (!db) dbPromise = null;
    return db;
  });
  return dbPromise;
}

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
        const v = cur.value as Partial<ThumbRecord> | undefined;
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

function putRecord(db: IDBDatabase, fileId: string, value: ThumbRecord): Promise<void> {
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

async function enforceCap(db: IDBDatabase, incoming: number): Promise<void> {
  try {
    const entries = await listMeta(db);
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let total = entries.reduce((s, e) => s + e.size, 0) + incoming;
    for (const e of entries) {
      if (total <= MAX_THUMB_BYTES) break;
      await del(db, e.key);
      total -= e.size;
    }
  } catch {
    /* degradación */
  }
}

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
 * Devuelve el dataURL PNG cacheado de la miniatura por fileId, o null si no está
 * o IndexedDB no está disponible. NUNCA lanza.
 */
export async function getCachedThumb(fileId: string): Promise<string | null> {
  if (!fileId) return null;
  try {
    const db = await openDB();
    if (!db) return null;
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const rec = await new Promise<ThumbRecord | undefined>((resolve, reject) => {
      const req = store.get(fileId);
      req.onsuccess = () => resolve(req.result as ThumbRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    return rec && typeof rec.dataUrl === "string" && rec.dataUrl.length > 0 ? rec.dataUrl : null;
  } catch {
    return null;
  }
}

/**
 * Guarda el dataURL PNG de la miniatura por fileId (best-effort). Aplica el tope
 * total por LRU; ante QuotaExceededError libera las más antiguas y reintenta una
 * vez; si aún falla, se ignora. NUNCA lanza.
 */
export async function putCachedThumb(fileId: string, dataUrl: string): Promise<void> {
  if (!fileId || typeof dataUrl !== "string" || dataUrl.length === 0) return;
  try {
    const db = await openDB();
    if (!db) return;
    const size = dataUrl.length;
    await enforceCap(db, size);
    const value: ThumbRecord = { dataUrl, size, savedAt: Date.now() };
    try {
      await putRecord(db, fileId, value);
    } catch (e) {
      if (isQuotaError(e)) {
        await evictOldest(db, size);
        try {
          await putRecord(db, fileId, { dataUrl, size, savedAt: Date.now() });
        } catch {
          /* sigue sin caber: se ignora */
        }
      }
      /* otros errores: se ignoran */
    }
  } catch {
    /* IndexedDB no disponible o transacción fallida: se ignora */
  }
}
