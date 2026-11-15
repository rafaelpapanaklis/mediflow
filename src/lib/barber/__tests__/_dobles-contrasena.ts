/**
 * Dobles para cargar ENTERAS las rutas de contraseña de Barber en `tsx --test`
 * (sin Next, sin Supabase, sin base, sin flags).
 *
 * Patrón de la casa: parche de Module._load que compara la ruta RESUELTA
 * contra un mapa de archivos y devuelve el doble. IMPORTAR ESTE ARCHIVO
 * PRIMERO y cargar lo que se prueba con `await import()` dentro de before():
 * los import estáticos se izan por encima del parche.
 *
 * Todo lo que hacen los dobles queda en `llamadas`, y lo que contestan sale de
 * `estado`: cada prueba lo ajusta con reiniciar({...}).
 */
import Module from "node:module";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const src = (rel: string) => join(RAIZ, "src", rel);

export interface UsuarioSupabase {
  id: string;
  email: string;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown>;
}

export interface Estado {
  /** Usuario de la sesión (cookies) o null. */
  sesion: UsuarioSupabase | null;
  /** Contraseña que hoy abre la cuenta (para la sonda de signInWithPassword). */
  contrasenaVigente: string;
  /** Error que contesta resetPasswordForEmail (p. ej. «User not found»). */
  errorReset: { message: string } | null;
  /** Error de verifyOtp / exchangeCodeForSession. */
  errorCanje: { message: string } | null;
  /** Error de updateUser / admin.updateUserById / admin.createUser. */
  errorUpdate: { message: string; code?: string } | null;
  /** Qué freno salta (por scope:id). */
  frenar: (llave: string) => boolean;
  /** Filas barber_users. */
  filas: Array<Record<string, any>>;
  /** Si la escritura de lastLogin revienta. */
  updateManyRevienta: boolean;
}

export const llamadas: Array<{ que: string; args: any }> = [];
export const estado: Estado = nuevoEstado();

function nuevoEstado(): Estado {
  return {
    sesion: null,
    contrasenaVigente: "",
    errorReset: null,
    errorCanje: null,
    errorUpdate: null,
    frenar: () => false,
    filas: [],
    updateManyRevienta: false,
  };
}

export function reiniciar(cambios: Partial<Estado> = {}): void {
  llamadas.length = 0;
  Object.assign(estado, nuevoEstado(), cambios);
}

const anota = (que: string, args: any) => llamadas.push({ que, args });

// ── Supabase con cookies (@/lib/supabase/server) ──────────────────────
const supabaseServidor = {
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: estado.sesion }, error: null }),
      resetPasswordForEmail: async (email: string, opts: unknown) => {
        anota("resetPasswordForEmail", { email, opts });
        return { data: {}, error: estado.errorReset };
      },
      verifyOtp: async (args: unknown) => {
        anota("verifyOtp", args);
        return { data: {}, error: estado.errorCanje };
      },
      exchangeCodeForSession: async (code: string) => {
        anota("exchangeCodeForSession", code);
        return { data: {}, error: estado.errorCanje };
      },
      updateUser: async (args: { password?: string }) => {
        anota("sesion.updateUser", args);
        if (estado.errorUpdate) return { data: {}, error: estado.errorUpdate };
        if (args.password) estado.contrasenaVigente = args.password;
        return { data: { user: estado.sesion }, error: null };
      },
      signOut: async (args?: unknown) => {
        anota("sesion.signOut", args ?? null);
        return { error: null };
      },
    },
  }),
};

// ── supabase-js (service role y sondas anon) ──────────────────────────
const supabaseJs = {
  createClient: (_url: string, llave: string) => ({
    auth: {
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        anota("sonda.signIn", { email, llave });
        const ok = !!estado.sesion && email === estado.sesion.email && password === estado.contrasenaVigente;
        return ok ? { data: { user: estado.sesion }, error: null } : { data: { user: null }, error: { message: "Invalid login credentials" } };
      },
      signOut: async (args?: unknown) => {
        anota("sonda.signOut", args ?? null);
        return { error: null };
      },
      admin: {
        updateUserById: async (id: string, attrs: any) => {
          anota("admin.updateUserById", { id, attrs });
          if (estado.errorUpdate) return { data: {}, error: estado.errorUpdate };
          if (attrs.password) estado.contrasenaVigente = attrs.password;
          if (attrs.app_metadata && estado.sesion) {
            estado.sesion.app_metadata = { ...(estado.sesion.app_metadata ?? {}), ...attrs.app_metadata };
          }
          return { data: { user: estado.sesion }, error: null };
        },
        createUser: async (attrs: any) => {
          anota("admin.createUser", attrs);
          if (estado.errorUpdate) return { data: {}, error: estado.errorUpdate };
          return { data: { user: { id: "sb-nuevo", email: attrs.email } }, error: null };
        },
        deleteUser: async (id: string) => {
          anota("admin.deleteUser", id);
          return { error: null };
        },
      },
    },
  }),
};

// ── Freno persistente (@/lib/failban) ─────────────────────────────────
const failban = {
  persistentRateLimit: async (req: any, opts: { id?: string; scope?: string; limit: number; windowSec?: number }) => {
    const llave = `${opts.scope ?? req.nextUrl.pathname}:${opts.id ?? "ip"}`;
    anota("rateLimit", { llave, limit: opts.limit, windowSec: opts.windowSec });
    if (!estado.frenar(llave)) return null;
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  },
};

// ── Prisma (solo lo que tocan estas rutas) ────────────────────────────
function cumple(fila: Record<string, any>, where: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "OR") {
      if (!(v as any[]).some((w) => cumple(fila, w))) return false;
      continue;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("lt" in v) {
        if (!(fila[k] instanceof Date) || !(fila[k].getTime() < (v as any).lt.getTime())) return false;
        continue;
      }
      if ("in" in v) {
        if (!(v as any).in.includes(fila[k])) return false;
        continue;
      }
    }
    if (v === null ? fila[k] != null : fila[k] !== v) return false;
  }
  return true;
}

const prisma = {
  barberUser: {
    findFirst: async ({ where }: any) => {
      const f = estado.filas.find((r) => cumple(r, where));
      return f ? { ...f, barbershop: f.barbershop ?? { id: f.barbershopId, name: "Barbería", parentId: null }, barber: null } : null;
    },
    updateMany: async ({ where, data }: any) => {
      anota("barberUser.updateMany", { where, data });
      if (estado.updateManyRevienta) throw new Error("base caída");
      let count = 0;
      for (const f of estado.filas) {
        if (cumple(f, where)) {
          Object.assign(f, data);
          count++;
        }
      }
      return { count };
    },
    create: async ({ data }: any) => {
      anota("barberUser.create", data);
      const fila = { id: "bu-nuevo", createdAt: new Date(), updatedAt: new Date(), lastLogin: null, branchAccess: [], barber: null, ...data };
      estado.filas.push(fila);
      return fila;
    },
  },
  barber: {
    findFirst: async () => null,
  },
};

const DOBLES = new Map<string, unknown>([
  [src("lib/supabase/server.ts"), supabaseServidor],
  [src("lib/failban.ts"), failban],
  [src("lib/prisma.ts"), { prisma, default: prisma }],
]);
const POR_NOMBRE = new Map<string, unknown>([
  ["@supabase/supabase-js", supabaseJs],
  ["server-only", {}],
  ["client-only", {}],
]);

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
  __barberContrasenaDobles?: boolean;
};

if (!M.__barberContrasenaDobles) {
  const original = M._load;
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (POR_NOMBRE.has(request)) return POR_NOMBRE.get(request);
    try {
      const resuelto = M._resolveFilename(request, parent, isMain);
      if (DOBLES.has(resuelto)) return DOBLES.get(resuelto);
    } catch {
      /* que lo resuelva el cargador original y truene ahí si toca */
    }
    return original.call(this, request, parent, isMain);
  };
  M.__barberContrasenaDobles = true;
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://supabase.prueba";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-prueba";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-prueba";
process.env.NEXT_PUBLIC_APP_URL ??= "https://www.dalecontrol.com";

export { RAIZ };
