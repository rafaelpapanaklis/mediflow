// ═══════════════════════════════════════════════════════════════════════
// Arnés de la auditoría de PERMISOS (ws6-t8, 16-nov-2026).
//
// Carga las rutas REALES de /api/barber con el getBarberContext REAL: la
// única pieza doblada es la sesión de Supabase (quién está «logueado») y
// next/headers (cookie de sede y encabezado de la pantalla). Así una prueba
// de «le quito el permiso → la siguiente petición ya no pasa» recorre el
// mismo camino que producción: lee barber_users en CADA petición.
//
// También dobla @supabase/supabase-js (alta de cuentas, storage) y corta
// todo fetch externo: ninguna prueba puede hablar con Stripe, Meta ni
// Supabase de verdad.
//
// ⚠️ Importa este archivo ANTES de cualquier ruta o módulo con prisma (el
// parche de Module._load tiene que estar puesto cuando se cargan).
// ═══════════════════════════════════════════════════════════════════════
import path from "node:path";
import Module from "node:module";
import { BARBER_BRANCH_COOKIE } from "../branch-cookie";

/** supabaseId «logueado»; null = sin sesión. */
export const sesion: { supabaseId: string | null; cookieSede: string | null; pinSede: string | null } = {
  supabaseId: null,
  cookieSede: null,
  pinSede: null,
};

/** Cuentas de Supabase que pidió crear el alta de Equipo (para las pruebas). */
export const cuentasCreadas: { email: string; id: string }[] = [];
/** Cada fetch que intentó salir de la máquina (debería quedar vacío). */
export const fetchExternos: string[] = [];

const SRC = path.resolve(__dirname, "../../..");

const supabaseAdminDoble = {
  __esModule: true,
  createClient: () => ({
    auth: {
      admin: {
        createUser: async (args: { email: string }) => {
          const id = `sb-${Math.random().toString(36).slice(2)}`;
          cuentasCreadas.push({ email: args.email, id });
          return { data: { user: { id, email: args.email } }, error: null };
        },
        deleteUser: async () => ({ data: null, error: null }),
        updateUserById: async () => ({ data: { user: null }, error: null }),
        getUserById: async (id: string) => ({ data: { user: { id, app_metadata: {} } }, error: null }),
      },
    },
    storage: {
      from: () => ({
        upload: async (p: string) => ({ data: { path: p }, error: null }),
        remove: async () => ({ data: [], error: null }),
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.test/${p}` } }),
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://storage.test/firmada/${p}` }, error: null }),
        createSignedUrls: async (ps: string[]) => ({
          data: ps.map((p) => ({ path: p, signedUrl: `https://storage.test/firmada/${p}`, error: null })),
          error: null,
        }),
        list: async () => ({ data: [], error: null }),
      }),
    },
  }),
};

const dobles = new Map<string, unknown>([
  [
    path.join(SRC, "lib/supabase/server.ts"),
    {
      __esModule: true,
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: {
              user: sesion.supabaseId
                ? { id: sesion.supabaseId, app_metadata: {}, last_sign_in_at: null }
                : null,
            },
          }),
        },
      }),
    },
  ],
]);

const headersDoble = {
  __esModule: true,
  cookies: async () => ({
    get: (name: string) =>
      name === BARBER_BRANCH_COOKIE && sesion.cookieSede ? { name, value: sesion.cookieSede } : undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(sesion.pinSede ? { "x-dcb-sede": sesion.pinSede } : {}),
};

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  if (request === "next/headers") return headersDoble;
  if (request === "@supabase/supabase-js") return supabaseAdminDoble;
  try {
    const r = M._resolveFilename(request, parent);
    if (dobles.has(r)) return dobles.get(r);
  } catch {
    /* que lo resuelva el cargador original */
  }
  return cargaOriginal.call(this, request, parent, isMain);
};

const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fetchExternos.push(url);
  throw new Error(`[arnés de permisos] fetch externo bloqueado: ${url}`);
}) as typeof fetch;
export function restaurarFetch() {
  globalThis.fetch = fetchOriginal;
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "llave-de-mentira";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "llave-de-mentira";

/** Respuesta resumida: estado + cuerpo JSON (o texto). */
export interface Resp {
  status: number;
  body: unknown;
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

/** Llama un handler de ruta con un NextRequest de verdad. */
export async function llamar(
  handler: Handler,
  opts: { method?: string; url?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Resp> {
  const { NextRequest } = await import("next/server");
  const method = opts.method ?? "GET";
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (opts.body !== undefined && method !== "GET") {
    init.body = JSON.stringify(opts.body);
    init.headers = { "content-type": "application/json" };
  }
  const req = new NextRequest(opts.url ?? "http://localhost/api/barber/x", init);
  const res = await handler(req as unknown as Request, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* no es JSON */
  }
  return { status: res.status, body };
}
