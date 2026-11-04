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

/** El código sin comentarios (de bloque y de línea, sin tocar `https://`): lo que se ejecuta. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * La primera sentencia del cuerpo de la función cuyo valor empieza en `desde`: `function …(`, `async (…) =>`,
 * `(…) =>` o `x =>`. Una flecha sin llaves (`=> expr`) devuelve `=> …`, que nunca es el guard.
 */
function primeraSentencia(src: string, desde: number): string {
  let j: number;
  const sola = /^(async\s+)?(\w+)\s*=>/.exec(src.slice(desde));
  if (sola && sola[2] !== "function") {
    j = desde + sola[0].length - 2;
  } else {
    let i = src.indexOf("(", desde);
    for (let d = 0; ; i++) {
      if (src[i] === "(") d++;
      else if (src[i] === ")" && --d === 0) break;
    }
    j = i + 1;
  }
  for (let ang = 0; j < src.length; j++) {
    if (src[j] === "<") ang++;
    else if (src[j] === ">" && src[j - 1] !== "=") ang--;
    else if (src[j] === "=" && src[j + 1] === ">" && ang === 0) {
      const k = src.slice(j + 2).search(/\S/) + j + 2;
      if (src[k] !== "{") return `=> ${src.slice(k).split("\n")[0].trim()}`;
      j = k;
      break;
    } else if (src[j] === "{" && ang === 0) break;
  }
  return src.slice(j + 1).replace(/^\s*/, "").split("\n")[0].trim();
}
const LLAMA_AL_GUARD = /^(const \w+ = )?await requireAdminPage\(\);$/;

/** Las constantes de configuración de segmento que Next lee de una página (con valor literal no ejecutan nada). */
const CONFIG_DE_NEXT = new Set(["dynamic", "revalidate", "runtime", "metadata", "viewport", "fetchCache", "preferredRegion", "maxDuration", "dynamicParams"]);

/** Desde `desde`, el texto hasta el `;` o el salto de línea de nivel 0 (el valor de una constante). */
function hastaFinDeSentencia(src: string, desde: number): string {
  let d = 0;
  for (let k = desde; k < src.length; k++) {
    const c = src[k];
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
    else if (d === 0 && (c === ";" || c === "\n")) return src.slice(desde, k);
  }
  return src.slice(desde);
}

/** Un valor que no ejecuta nada: texto, número, booleano, o un objeto / arreglo sin llamadas, flechas ni plantillas. */
function esLiteral(valor: string): boolean {
  const v = valor.trim();
  if (!/^(["'\-\d{[]|true\b|false\b|null\b)/.test(v)) return false;
  return !/[(]|=>|\$\{|\bawait\b|\.\.\.|\bget\s+\w+\s*\(|\bnew\b/.test(v);
}

type Exportado =
  | { nombre: string; clase: "tipo" | "config" }
  | { nombre: string; clase: "funcion"; inicio: number }
  | { nombre: string; clase: "opaco" };

/**
 * Revisión ws1-t8, m5 · FALLA CERRADO. Todo `export` de nivel superior se clasifica, y lo que no se reconoce es
 * «opaco» (no se puede comprobar → rojo):
 *  · `type` / `interface` → sin código;
 *  · una constante de configuración de Next (`CONFIG_DE_NEXT`) con valor literal → sin código;
 *  · una función reconocida: `function` (default o con nombre), `export default (async) (…) =>` y
 *    `export const x[: tipo] = (async) (…) => / x => / function` → hay que mirar su primera sentencia;
 *  · todo lo demás: `export let/var`, una función envuelta (`cache(async () => …)`), `export { … }`, `export *`,
 *    `export default identificador`, `class`, `enum`… → opaco.
 * Además, un `export` que no empieza línea (`; export const …`) también es opaco.
 */
function clasificarExports(srcOriginal: string): Exportado[] {
  const src = sinComentarios(srcOriginal);
  const salida: Exportado[] = [];
  const alInicio = new Set<number>();
  for (const m of src.matchAll(/^export\b/gm)) {
    alInicio.add(m.index!);
    const resto = src.slice(m.index!);
    let r: RegExpExecArray | null;
    if ((r = /^export\s+(declare\s+)?(type|interface)\s+(\w+)/.exec(resto))) {
      salida.push({ nombre: r[3], clase: "tipo" });
    } else if (/^export\s+type\s*\{[^}]*\}(\s*from\s*["'][^"']+["'])?\s*;?\s*$/m.test(resto.split("\n")[0])) {
      salida.push({ nombre: resto.split("\n")[0].trim(), clase: "tipo" }); // `export type { A } from "./x"`: solo tipos
    } else if ((r = /^export\s+(default\s+)?(async\s+)?function\b\s*\*?\s*(\w*)/.exec(resto))) {
      salida.push({ nombre: r[1] ? "default" : r[3], clase: "funcion", inicio: m.index! });
    } else if ((r = /^export\s+default\s+(?=(async\s*)?\()/.exec(resto))) {
      salida.push({ nombre: "default", clase: "funcion", inicio: m.index! + r[0].length });
    } else if ((r = /^export\s+const\s+(\w+)\s*/.exec(resto))) {
      const nombre = r[1];
      // Se salta la anotación de tipo (puede llevar `=>` y genéricos) hasta el `=` de nivel 0.
      let k = m.index! + r[0].length;
      if (src[k] === ":") {
        for (let d = 0; k < src.length; k++) {
          const c = src[k];
          if ("([{<".includes(c)) d++;
          else if (")]}".includes(c) || (c === ">" && src[k - 1] !== "=")) d--;
          else if (c === "=" && d === 0 && src[k + 1] !== ">") break;
        }
      }
      if (src[k] !== "=") { salida.push({ nombre, clase: "opaco" }); continue; }
      const inicio = k + 1 + src.slice(k + 1).search(/\S/);
      const valor = src.slice(inicio);
      if (CONFIG_DE_NEXT.has(nombre) && esLiteral(hastaFinDeSentencia(src, inicio))) salida.push({ nombre, clase: "config" });
      else if (/^(async\s+)?(function\b|\(|<|\w+\s*=>)/.test(valor)) salida.push({ nombre, clase: "funcion", inicio });
      else salida.push({ nombre, clase: "opaco" });
    } else {
      salida.push({ nombre: resto.split("\n")[0].trim(), clase: "opaco" });
    }
  }
  for (const m of src.matchAll(/\bexport\s/g)) {
    if (!alInicio.has(m.index!)) salida.push({ nombre: `export a media línea: ${src.slice(m.index!, m.index! + 30).split("\n")[0]}`, clase: "opaco" });
  }
  return salida;
}

/** Lo que el candado deja pasar de un archivo: los exports que no cumplen (`guard` = la primera sentencia exigida). */
function exportsSinGuard(src: string, guard: RegExp): string[] {
  const codigo = sinComentarios(src);
  return clasificarExports(src)
    .filter((e) => e.clase === "opaco" || (e.clase === "funcion" && !guard.test(primeraSentencia(codigo, e.inicio))))
    .map((e) => (e.clase === "opaco" ? `${e.nombre} (no se puede comprobar)` : e.nombre));
}

test("🔴 CADA page.tsx de /admin (salvo el login) empieza con requireAdminPage(), y su generateMetadata también", () => {
  const todas = paginas(ADMIN);
  assert.ok(todas.length >= 45, `solo ${todas.length} páginas: ¿se movió /admin?`);
  const sinGuard: string[] = [];
  for (const p of todas) {
    const rel = path.relative(RAIZ, p);
    if (rel === path.join("src/app/admin/login/page.tsx")) continue;
    const src = readFileSync(p, "utf8");
    assert.ok(clasificarExports(src).some((e) => e.nombre === "default" && e.clase === "funcion"), `${rel}: sin export default de función`);
    for (const malo of exportsSinGuard(src, LLAMA_AL_GUARD)) sinGuard.push(`${rel} · ${malo}`);
  }
  assert.deepEqual(sinGuard, [], "páginas de /admin que se fían del layout");
});

test("🔴 m3/m5 · el candado falla cerrado: formas nuevas, funciones envueltas, let, tipos con =>, y solo config literal", () => {
  const conGuard = "{\n  await requireAdminPage();\n  return 1;\n}";
  const P = `export default async function P() ${conGuard}\n`;
  const casos: Array<[string, string[]]> = [
    // m3
    [`${P}export const generateMetadata = async ({ params }: Props) => {\n  const d = await prisma.x();\n}`, ["generateMetadata"]],
    [`${P}export const generateMetadata = async () => ({ title: (await prisma.x()).name });`, ["generateMetadata"]],
    [`${P}export async function generateViewport() {\n  return leer();\n}`, ["generateViewport"]],
    [`${P}export const generateMetadata = async (): Promise<Metadata> => ${conGuard}`, []],
    [`${P}export { generateMetadata } from "./meta";`, ["export { generateMetadata } from \"./meta\"; (no se puede comprobar)"]],
    [`export default async (props: Props) => {\n  const d = await prisma.x();\n};`, ["default"]],
    [`export const dynamic = "force-dynamic";\nexport const metadata = { title: "x" };\n${P}`, []],
    // m5: los tres mutantes de t8 (en e0272cbfe pasaban en verde)
    [`${P}export const generateViewport = cacheR(async () => {\n  return prisma.x();\n});`, ["generateViewport (no se puede comprobar)"]],
    [`${P}export let generateViewport = async () => {\n  return prisma.x();\n};`, ["export let generateViewport = async () => { (no se puede comprobar)"]],
    [`${P}export const generateViewport: (p: Props) => Promise<object> = async (p) => {\n  return prisma.x();\n};`, ["generateViewport"]],
    // m5: más formas
    [`${P}export const generateViewport: (p: Props) => Promise<object> = async (p) => ${conGuard}`, []],
    [`${P}export type { A, B } from "./tipos";`, []],
    [`${P}export const generateMetadata = async props => ${conGuard}`, []],
    [`${P}export const generateMetadata = async props => {\n  return prisma.x();\n}`, ["generateMetadata"]],
    [`${P}export const revalidate = calcular();`, ["revalidate (no se puede comprobar)"]],
    [`${P}export const metadata = { title: \`\${await nombre()}\` };`, ["metadata (no se puede comprobar)"]],
    [`${P}export const otraCosa = 5;`, ["otraCosa (no se puede comprobar)"]],
    [`${P}export * from "./x";`, ["export * from \"./x\"; (no se puede comprobar)"]],
    [`${P}const g = async () => prisma.x(); export { g as generateViewport };`, ["export a media línea: export { g as generateViewport (no se puede comprobar)"]],
    [`export type Props = { params: Promise<{ id: string }> };\nexport interface X { a: number }\n${P}`, []],
    // un comentario con «export» no cuenta
    [`// export const generateViewport = cacheR(async () => prisma.x());\n${P}`, []],
  ];
  for (const [src, esperadas] of casos) assert.deepEqual(exportsSinGuard(src, LLAMA_AL_GUARD), esperadas, src);
});

/** Los `.ts`/`.tsx` de un directorio (sin pruebas). */
function fuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "__tests__") salida.push(...fuentes(p)); continue; }
    if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) salida.push(p);
  }
  return salida;
}

/** ¿Hay un "use server" que no sea la primera sentencia del archivo (una acción en línea, dentro de una función)? */
function useServerEnLinea(src: string): boolean {
  const codigo = sinComentarios(src);
  const todas = [...codigo.matchAll(/["']use server["']/g)].map((m) => m.index!);
  const alPrincipio = /^\s*["']use server["']/.exec(codigo) ? codigo.search(/["']use server["']/) : -1;
  return todas.some((i) => i !== alPrincipio);
}

test("🔴 m5 · ningún \"use server\" en línea dentro de src/app/admin (una acción así no la ve el candado de acciones)", () => {
  const malos = fuentes(ADMIN).filter((p) => useServerEnLinea(readFileSync(p, "utf8"))).map((p) => path.relative(RAIZ, p));
  assert.deepEqual(malos, []);
  // El detector, con fuentes sintéticas.
  assert.equal(useServerEnLinea(`"use server";\nexport async function a() {}`), false);
  assert.equal(useServerEnLinea(`export default async function P() {\n  async function borrar() {\n    "use server";\n  }\n}`), true);
  assert.equal(useServerEnLinea(`"use server";\nexport async function a() {\n  'use server';\n}`), true);
  assert.equal(useServerEnLinea(`// "use server" en un comentario\nexport default function P() {}`), false);
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
    // m5: en un "use server" todo export cuenta (ni config ni tipos tienen sentido como acción, pero un tipo no ejecuta nada).
    acciones += clasificarExports(src).filter((e) => e.clase === "funcion").length;
    for (const e of clasificarExports(src)) if (e.clase === "config") malas.push(`${path.relative(RAIZ, p)} · ${e.nombre} (config en un "use server")`);
    for (const malo of exportsSinGuard(src, /^const \w+ = await sesionAdminDeAccion\(\);$/)) malas.push(`${path.relative(RAIZ, p)} · ${malo}`);
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
