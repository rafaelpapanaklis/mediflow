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

/**
 * La primera sentencia del cuerpo de la función cuyos parámetros abren en el primer `(` desde `desde` (sin
 * comentarios ni espacios). Sirve para `function` y para flechas; una flecha sin llaves (`=> expr`) devuelve
 * `=> …`, que nunca es el guard.
 */
function primeraSentencia(src: string, desde: number): string {
  let i = src.indexOf("(", desde);
  for (let d = 0; ; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")" && --d === 0) break;
  }
  let j = i + 1;
  for (let ang = 0; ; j++) {
    if (src[j] === "<") ang++;
    else if (src[j] === ">" && src[j - 1] !== "=") ang--;
    else if (src[j] === "=" && src[j + 1] === ">" && ang === 0) {
      const k = src.slice(j + 2).search(/\S/) + j + 2;
      if (src[k] !== "{") return `=> ${src.slice(k).split("\n")[0].trim()}`;
      j = k;
      break;
    } else if (src[j] === "{" && ang === 0) break;
  }
  return src.slice(j + 1).replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "").split("\n")[0].trim();
}
const LLAMA_AL_GUARD = /^(const \w+ = )?await requireAdminPage\(\);$/;

/**
 * Revisión ws1-t8, m3: TODO export de función de un archivo, sea `function` (con nombre o default, async o no),
 * `const x = async (…) =>`, `const x = function` o `export default (…) =>`. `export { … }` y `export * from`
 * cuentan como «no se puede comprobar»: podrían reexportar una función de otro archivo sin guard.
 */
function exportsDeFuncion(src: string): Array<{ nombre: string; inicio: number } | { nombre: string; opaco: true }> {
  const salida: Array<{ nombre: string; inicio: number } | { nombre: string; opaco: true }> = [];
  for (const m of src.matchAll(/export\s+(default\s+)?(async\s+)?function\s*\*?\s*(\w*)/g)) {
    salida.push({ nombre: m[1] ? "default" : m[3], inicio: m.index! });
  }
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*(?::[^=]*)?=\s*(async\b|function\b|\(|<)/g)) {
    salida.push({ nombre: m[1], inicio: m.index! });
  }
  for (const m of src.matchAll(/export\s+default\s+(async\s*)?\(/g)) salida.push({ nombre: "default", inicio: m.index! });
  for (const m of src.matchAll(/export\s*(\{[^}]*\}|\*)/g)) salida.push({ nombre: m[0], opaco: true });
  return salida;
}

test("🔴 CADA page.tsx de /admin (salvo el login) empieza con requireAdminPage(), y su generateMetadata también", () => {
  const todas = paginas(ADMIN);
  assert.ok(todas.length >= 45, `solo ${todas.length} páginas: ¿se movió /admin?`);
  const sinGuard: string[] = [];
  for (const p of todas) {
    const rel = path.relative(RAIZ, p);
    if (rel === path.join("src/app/admin/login/page.tsx")) continue;
    const src = readFileSync(p, "utf8");
    const funciones = exportsDeFuncion(src);
    assert.ok(funciones.some((f) => f.nombre === "default"), `${rel}: sin export default de función`);
    for (const f of funciones) {
      if ("opaco" in f) sinGuard.push(`${rel} (${f.nombre}: no se puede comprobar)`);
      else if (!LLAMA_AL_GUARD.test(primeraSentencia(src, f.inicio))) sinGuard.push(`${rel} (${f.nombre})`);
    }
  }
  assert.deepEqual(sinGuard, [], "páginas de /admin que se fían del layout");
});

test("🔴 m3 · el candado ve también las formas nuevas: const async, flecha sin llaves, generateViewport y export { }", () => {
  const conGuard = "{\n  await requireAdminPage();\n  return 1;\n}";
  const casos: Array<[string, string[]]> = [
    [`export default async function P() ${conGuard}\nexport const generateMetadata = async ({ params }: Props) => {\n  const d = await prisma.x();\n}`, ["generateMetadata"]],
    [`export default async function P() ${conGuard}\nexport const generateMetadata = async () => ({ title: (await prisma.x()).name });`, ["generateMetadata"]],
    [`export default async function P() ${conGuard}\nexport async function generateViewport() {\n  return leer();\n}`, ["generateViewport"]],
    [`export default async function P() ${conGuard}\nexport const generateMetadata = async (): Promise<Metadata> => ${conGuard}`, []],
    [`export default async function P() ${conGuard}\nexport { generateMetadata } from "./meta";`, ["export { generateMetadata }"]],
    [`export default async (props: Props) => {\n  const d = await prisma.x();\n};`, ["default"]],
    [`export const dynamic = "force-dynamic";\nexport const metadata = { title: "x" };\nexport default async function P() ${conGuard}`, []],
  ];
  for (const [src, esperadas] of casos) {
    const malas = exportsDeFuncion(src)
      .filter((f) => ("opaco" in f) || !LLAMA_AL_GUARD.test(primeraSentencia(src, f.inicio)))
      .map((f) => f.nombre);
    assert.deepEqual(malas, esperadas, src);
  }
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
/**
 * Los `"use server"` de admin: todos los de src/app/admin y src/app/actions/admin, y (m3) cualquier otro de
 * src/ que importe admin-auth o admin-page-guard, esté donde esté.
 */
function archivosDeAcciones(): string[] {
  const dirsDeAdmin = [ADMIN, path.join(RAIZ, "src/app/actions/admin")];
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (n !== "__tests__" && n !== "node_modules") recorrer(p); continue; }
      if (!/\.(ts|tsx)$/.test(n) || /\.test\./.test(n)) continue;
      const src = readFileSync(p, "utf8");
      if (!/^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src)) continue;
      const deAdmin = dirsDeAdmin.some((dir) => p.startsWith(dir + path.sep)) || /from\s+["'][^"']*\/(admin-auth|admin-page-guard)["']/.test(src);
      if (deAdmin) salida.push(p);
    }
  };
  recorrer(path.join(RAIZ, "src"));
  return salida;
}

test("🔴 toda server action de admin empieza con sesionAdminDeAccion() (sesión + Origin), no con getAdminSession()", () => {
  const archivos = archivosDeAcciones();
  assert.ok(archivos.length >= 5, `solo ${archivos.length} archivos "use server"`);
  const malas: string[] = [];
  let acciones = 0;
  for (const p of archivos) {
    const src = readFileSync(p, "utf8");
    for (const f of exportsDeFuncion(src)) {
      acciones++;
      if ("opaco" in f || !/^const \w+ = await sesionAdminDeAccion\(\);$/.test(primeraSentencia(src, f.inicio))) {
        malas.push(`${path.relative(RAIZ, p)} · ${f.nombre}`);
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
