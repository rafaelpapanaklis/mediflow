/**
 * Seguridad admin-auth (auditoría «cloudflare», §1b y hueco nº9) — /admin no confía en su layout.
 *
 * Run: npm run test:seg-admin-auth
 *
 * §1b: el middleware solo mira que la cookie `admin_token` EXISTA, y el layout de /admin es otro segmento
 * del RSC: la página se renderiza aunque el layout pinte el login, y una petición RSC con
 * `Next-Router-State-Tree` puede pedir solo la página. Con `admin_token=x`, `/admin/clinics/<id>` leía
 * correos, teléfonos, ingresos y notas de cualquier clínica. Ahora cada página (y su generateMetadata)
 * empieza con `requireAdminPage()`.
 *
 * nº9: las server actions de admin, fuera de /api/admin, no tenían el chequeo de Origin del middleware.
 * Ahora pasan por `sesionAdminDeAccion()` (sesión + Origin/Referer del mismo host).
 *
 * Dobles por Module._load (sin red, sin base): los módulos se cargan con import() DESPUÉS de instalarlos.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../..");
const ADMIN = path.join(RAIZ, "src/app/admin");

// ── Estado de los dobles ────────────────────────────────────────────────────
const estado = {
  cookie: "x" as string | undefined,
  sesion: "anonima" as "anonima" | "ok" | "error",
  cabeceras: {} as Record<string, string>,
  fugas: [] as string[],
  consultasDeSesion: 0,
};
beforeEach(() => {
  estado.cookie = "x";
  estado.sesion = "anonima";
  estado.cabeceras = {};
  estado.fugas = [];
  estado.consultasDeSesion = 0;
});

/** Un objeto en el que TODO uso se anota como fuga (la página leyó o pintó algo). */
function chivato(nombre: string): any {
  const f = (...a: unknown[]) => { estado.fugas.push(nombre); void a; return chivato(nombre); };
  return new Proxy(f, {
    get: (_t, k) => (k === "then" ? undefined : k === "__esModule" ? true : chivato(`${nombre}.${String(k)}`)),
    apply: () => { estado.fugas.push(nombre); return chivato(nombre); },
  });
}

const ADMIN_USER = { id: "adm-1", email: "admin@dalecontrol.test", role: "OWNER", totpSecret: null, totpEnabled: true, isActive: true };
const prismaDoble = new Proxy({}, {
  get: (_t, modelo) => {
    if (modelo === "adminSession") {
      return {
        findUnique: async () => {
          estado.consultasDeSesion++;
          if (estado.sesion === "error") throw new Error("pooler caído");
          if (estado.sesion === "anonima") return null;
          return { id: "ses-1", revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000), adminUser: ADMIN_USER };
        },
        updateMany: async () => ({ count: 0 }),
      };
    }
    return chivato(`prisma.${String(modelo)}`);
  },
});

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaDoble },
  "next/headers": {
    cookies: async () => ({ get: (n: string) => (n === "admin_token" && estado.cookie ? { value: estado.cookie } : undefined) }),
    headers: async () => new Headers(estado.cabeceras),
  },
  "next/cache": { revalidatePath: () => {} },
};
// Lo que una página o acción importa y NO es el guard: chivato (cualquier lectura es una fuga).
const REALES = new Set(["@/lib/admin-page-guard", "@/lib/admin-auth", "@/lib/csrf-origen", "next/navigation", "react", "react/jsx-runtime", "react/jsx-dev-runtime"]);
const Mod = Module as unknown as { _load: (req: string, padre: { filename?: string } | undefined, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, padre: { filename?: string } | undefined, ...r: unknown[]) {
  if (req in dobles) return dobles[req];
  const desde = padre?.filename ?? "";
  const esPaginaOAccion = desde.startsWith(ADMIN) || desde.includes(`${path.sep}app${path.sep}actions${path.sep}admin${path.sep}`);
  if (esPaginaOAccion && !REALES.has(req) && !req.startsWith("node:")) return chivato(req);
  return cargaOriginal.call(this, req, padre, ...r);
};

const silencio = console.warn;
console.warn = () => {};

async function quePasa(f: () => Promise<unknown>): Promise<{ redirect?: string; error?: string; ok?: unknown }> {
  try {
    return { ok: await f() };
  } catch (e) {
    const d = (e as { digest?: string }).digest;
    if (typeof d === "string" && d.startsWith("NEXT_REDIRECT")) return { redirect: d.split(";")[2] };
    return { error: (e as Error).name };
  }
}

// ── Recorrido de las páginas ────────────────────────────────────────────────
function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : paginas(p);
    return n === "page.tsx" ? [p] : [];
  });
}

/** Lo que va desde la `{` del cuerpo de la función que empieza en `desde` (sin comentarios ni espacios). */
function primeraSentencia(src: string, desde: number): string {
  let i = src.indexOf("(", desde);
  for (let d = 0; ; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")" && --d === 0) break;
  }
  let j = i + 1;
  for (let ang = 0; ; j++) {
    if (src[j] === "<") ang++;
    else if (src[j] === ">") ang--;
    else if (src[j] === "{" && ang === 0) break;
  }
  return src.slice(j + 1).replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "").split("\n")[0].trim();
}
const LLAMA_AL_GUARD = /^(const \w+ = )?await requireAdminPage\(\);$/;

test("🔴 CADA page.tsx de /admin (salvo el login) empieza con requireAdminPage(), y su generateMetadata también", () => {
  const todas = paginas(ADMIN);
  assert.ok(todas.length >= 45, `solo ${todas.length} páginas: ¿se movió /admin?`);
  const sinGuard: string[] = [];
  for (const p of todas) {
    const rel = path.relative(RAIZ, p);
    if (rel === path.join("src/app/admin/login/page.tsx")) continue;
    const src = readFileSync(p, "utf8");
    const pag = src.search(/export default (async )?function/);
    assert.ok(pag >= 0, `${rel}: sin export default function`);
    if (!LLAMA_AL_GUARD.test(primeraSentencia(src, pag))) sinGuard.push(rel);
    const meta = src.search(/export async function generateMetadata/);
    if (meta >= 0 && !LLAMA_AL_GUARD.test(primeraSentencia(src, meta))) sinGuard.push(`${rel} (generateMetadata)`);
  }
  assert.deepEqual(sinGuard, [], "páginas de /admin que se fían del layout");
});

test("el login de /admin sigue abierto (si no, nadie entra)", () => {
  assert.doesNotMatch(readFileSync(path.join(ADMIN, "login/page.tsx"), "utf8"), /requireAdminPage/);
});

const paginaClinica = () => import("../clinics/[id]/page");

test("🔴 /admin/clinics/<id> con admin_token=x y sin sesión viva → redirect a /admin/login, sin leer la clínica", async () => {
  const { default: Pagina } = await paginaClinica();
  const r = await quePasa(() => Pagina({ params: Promise.resolve({ id: "clinica-ajena" }) }));
  assert.equal(r.redirect, "/admin/login", JSON.stringify(r));
  assert.deepEqual(estado.fugas, [], "no se lee nada de la clínica");
  // Sin cookie, igual (el middleware ya redirige, pero la página no depende de él).
  estado.cookie = undefined;
  assert.equal((await quePasa(() => Pagina({ params: Promise.resolve({ id: "clinica-ajena" }) }))).redirect, "/admin/login");
  assert.deepEqual(estado.fugas, []);
});

test("con la base caída al validar, la página tampoco se pinta (lanza; el layout enseña el aviso)", async () => {
  estado.sesion = "error";
  const { default: Pagina } = await paginaClinica();
  const r = await quePasa(() => Pagina({ params: Promise.resolve({ id: "clinica-ajena" }) }));
  assert.equal(r.error, "SesionAdminNoComprobada");
  assert.deepEqual(estado.fugas, []);
});

test("con sesión de admin viva, la página sí lee la clínica (el admin de verdad no nota nada)", async () => {
  estado.sesion = "ok";
  const { default: Pagina } = await paginaClinica();
  await quePasa(() => Pagina({ params: Promise.resolve({ id: "clinica-1" }) }));
  assert.ok(estado.fugas.some((f) => f.startsWith("prisma.clinic")), estado.fugas.slice(0, 5).join(", "));
});

test("generateMetadata de un prospecto del CRM sin sesión → redirect, sin leer su nombre", async () => {
  const { generateMetadata } = await import("../crm/[id]/page");
  const r = await quePasa(() => generateMetadata({ params: Promise.resolve({ id: "p-1" }) }));
  assert.equal(r.redirect, "/admin/login");
  assert.deepEqual(estado.fugas, []);
});

// ── Server actions de admin (nº9) ───────────────────────────────────────────
function archivosDeAcciones(): string[] {
  const dirs = [ADMIN, path.join(RAIZ, "src/app/actions/admin")];
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (n !== "__tests__") recorrer(p); continue; }
      if (!/\.(ts|tsx)$/.test(n) || /\.test\./.test(n)) continue;
      if (/^\s*["']use server["']/.test(readFileSync(p, "utf8"))) salida.push(p);
    }
  };
  dirs.forEach(recorrer);
  return salida;
}

test("🔴 toda server action de admin empieza con sesionAdminDeAccion() (sesión + Origin), no con getAdminSession()", () => {
  const archivos = archivosDeAcciones();
  assert.ok(archivos.length >= 5, `solo ${archivos.length} archivos "use server"`);
  const malas: string[] = [];
  let acciones = 0;
  for (const p of archivos) {
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/export async function (\w+)/g)) {
      acciones++;
      if (!/^const \w+ = await sesionAdminDeAccion\(\);$/.test(primeraSentencia(src, m.index!))) {
        malas.push(`${path.relative(RAIZ, p)} · ${m[1]}`);
      }
    }
  }
  assert.ok(acciones >= 17, `solo ${acciones} acciones`);
  assert.deepEqual(malas, []);
});

test("sesionAdminDeAccion: Origin ajeno o sin Origin ni Referer → null SIN consultar la sesión; mismo host → la sesión", async () => {
  estado.sesion = "ok";
  const { sesionAdminDeAccion } = await import("@/lib/admin-page-guard");
  estado.cabeceras = { host: "dalecontrol.com", origin: "https://evil.example" };
  assert.equal(await sesionAdminDeAccion(), null);
  estado.cabeceras = { host: "dalecontrol.com" };
  assert.equal(await sesionAdminDeAccion(), null);
  assert.equal(estado.consultasDeSesion, 0);
  estado.cabeceras = { host: "dalecontrol.com", referer: "https://dalecontrol.com/admin/crm" };
  assert.equal((await sesionAdminDeAccion())?.user.id, "adm-1");
  estado.cabeceras = { host: "dalecontrol.com", origin: "https://dalecontrol.com" };
  assert.equal((await sesionAdminDeAccion())?.user.id, "adm-1");
});

test("🔴 una acción real del CRM llamada sin Origin, con cookie de admin válida → «No autorizado» y no borra", async () => {
  estado.sesion = "ok";
  estado.cabeceras = { host: "dalecontrol.com" };
  const { eliminarProspectoAccion } = await import("../crm/actions");
  assert.deepEqual(await eliminarProspectoAccion("p-1"), { ok: false, error: "No autorizado" });
  assert.deepEqual(estado.fugas, [], "crmEliminar no se llamó");
  // Desde el propio panel, sí.
  estado.cabeceras = { host: "dalecontrol.com", origin: "https://dalecontrol.com" };
  await eliminarProspectoAccion("p-1").catch(() => null);
  assert.ok(estado.fugas.some((f) => f.includes("crmEliminar")), estado.fugas.join(", "));
});

test.after(() => { console.warn = silencio; });
