/**
 * Dobles de las pruebas de imágenes de documentos: un bucket `patient-files`
 * en memoria (con la forma exacta del cliente de Supabase que usan
 * `@/lib/storage` y `imagenes.server.ts`), la sesión, el límite por usuario y
 * las dos bitácoras. sharp y file-type son los DE VERDAD.
 *
 * Todo va por `Module._load` y ningún archivo de prueba usa `mock.module`:
 * `imagenes.server.ts` lleva `import "server-only"`, que bajo tsx no resuelve
 * y que con un `mock.module` activo ya no se deja pisar (ver
 * src/app/api/clinics/__tests__/herencia-agenda-flexible.test.ts).
 *
 * ⛔ Sin base, sin red, sin Supabase.
 */
import Module from "node:module";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bucket.prueba";
process.env.SUPABASE_SERVICE_ROLE_KEY = "llave-de-prueba";

export interface Objeto {
  bytes: Buffer;
  tipo: string;
}

export const bucket = {
  objetos: new Map<string, Objeto>(),
  /** Qué rutas se pidió BAJAR (la prueba de «no se baja lo que pesa de más» lo mira). */
  bajadas: [] as string[],
  borradas: [] as string[],
  firmasSubida: [] as string[],
  firmasLectura: [] as Array<{ ruta: string; ttl: number }>,
  /** Simula el retraso de Storage en listar un objeto recién subido. */
  listarFalla: 0,
  reiniciar() {
    this.objetos.clear();
    this.bajadas = [];
    this.borradas = [];
    this.firmasSubida = [];
    this.firmasLectura = [];
    this.listarFalla = 0;
  },
};

const BASE = "https://bucket.prueba/storage/v1/object";

function cara(nombre: string) {
  if (nombre !== "patient-files") throw new Error(`bucket inesperado: ${nombre}`);
  return {
    async upload(ruta: string, cuerpo: Buffer | Uint8Array | ArrayBuffer, o: { contentType: string; upsert?: boolean }) {
      if (bucket.objetos.has(ruta) && !o.upsert) return { error: { message: "The resource already exists" } };
      const bytes = cuerpo instanceof ArrayBuffer ? Buffer.from(cuerpo) : Buffer.from(cuerpo as Uint8Array);
      bucket.objetos.set(ruta, { bytes, tipo: o.contentType });
      return { data: { path: ruta }, error: null };
    },
    async remove(rutas: string[]) {
      for (const r of rutas) {
        bucket.objetos.delete(r);
        bucket.borradas.push(r);
      }
      return { data: [], error: null };
    },
    async createSignedUrl(ruta: string, ttl: number) {
      bucket.firmasLectura.push({ ruta, ttl });
      if (!bucket.objetos.has(ruta)) return { data: null, error: { message: "Object not found" } };
      return { data: { signedUrl: `${BASE}/sign/patient-files/${ruta}?token=t&ttl=${ttl}` }, error: null };
    },
    async createSignedUploadUrl(ruta: string, _o?: { upsert?: boolean }) {
      bucket.firmasSubida.push(ruta);
      return { data: { signedUrl: `${BASE}/upload/sign/patient-files/${ruta}?token=sub`, token: "sub", path: ruta }, error: null };
    },
    async download(ruta: string) {
      bucket.bajadas.push(ruta);
      const o = bucket.objetos.get(ruta);
      if (!o) return { data: null, error: { message: "Object not found" } };
      return { data: new Blob([new Uint8Array(o.bytes)], { type: o.tipo }), error: null };
    },
    async copy(de: string, a: string) {
      const o = bucket.objetos.get(de);
      if (!o) return { data: null, error: { message: "Object not found" } };
      bucket.objetos.set(a, { bytes: Buffer.from(o.bytes), tipo: o.tipo });
      return { data: { path: a }, error: null };
    },
    async list(dir: string, o: { search?: string }) {
      if (bucket.listarFalla > 0) {
        bucket.listarFalla--;
        return { data: [], error: null };
      }
      const data = Array.from(bucket.objetos.entries())
        .filter(([r]) => r.startsWith(`${dir}/`) && !r.slice(dir.length + 1).includes("/"))
        .map(([r, ob]) => ({ name: r.slice(dir.length + 1), metadata: { size: ob.bytes.length } }))
        .filter((x) => !o?.search || x.name.includes(o.search));
      return { data, error: null };
    },
  };
}

/** El PUT del navegador a la URL firmada de subida: lo que haría Storage. */
export function putFirmado(url: string, bytes: Buffer, tipo: string): number {
  const m = /\/upload\/sign\/patient-files\/([^?]+)\?token=sub$/.exec(url);
  if (!m || !bucket.firmasSubida.includes(m[1]!)) return 400;
  bucket.objetos.set(m[1]!, { bytes, tipo });
  return 200;
}

// ─────────────────────────── Sesión y bitácoras ───────────────────────────

export const sesion = {
  ctx: null as null | { userId: string; clinicId: string; role: string; permissionsOverride: string[] },
  /** Si es número, el límite por usuario contesta 429 a partir de esa llamada. */
  limite: null as null | number,
  llamadasLimite: [] as Array<{ id?: string; scope?: string; limit: number }>,
  filas: [] as Array<Record<string, unknown>>,
  rechazos: [] as Array<Record<string, unknown>>,
  reiniciar() {
    this.ctx = { userId: "u-doc-a", clinicId: "clinica_a", role: "DOCTOR", permissionsOverride: [] };
    this.limite = null;
    this.llamadasLimite = [];
    this.filas = [];
    this.rechazos = [];
  },
};

const prismaDoble = {
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      sesion.rechazos.push(data);
      return data;
    },
  },
};

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@supabase/supabase-js": { createClient: () => ({ storage: { from: cara } }) },
  "@/lib/auth-context": { getAuthContext: async () => sesion.ctx },
  "@/lib/failban": {
    persistentRateLimit: async (_req: unknown, o: { id?: string; scope?: string; limit: number }) => {
      sesion.llamadasLimite.push(o);
      if (sesion.limite !== null && sesion.llamadasLimite.length > sesion.limite) {
        return new Response(JSON.stringify({ error: "Demasiados intentos. Intenta de nuevo más tarde." }), { status: 429 });
      }
      return null;
    },
  },
  "@/lib/prisma": { prisma: prismaDoble },
  "@/lib/admin/suplantacion": { desviarSiSuplantacion: async () => false },
  "@/lib/movimientos-paciente/fila": {
    insertarFilaBitacora: async (fila: Record<string, unknown>) => {
      sesion.filas.push(fila);
    },
  },
};

const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

sesion.reiniciar();
