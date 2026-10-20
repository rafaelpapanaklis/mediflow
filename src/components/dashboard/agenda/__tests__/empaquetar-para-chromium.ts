/**
 * EMPAQUETAR UN ARNÉS DE COMPONENTES PARA CHROMIUM (WS1-T5, revisión t8,
 * N3-A3) — para probar CLICS de verdad en componentes que en Node no se
 * pueden ejecutar (aquí no hay jsdom ni react-test-renderer).
 *
 * esbuild con los alias del tsconfig del repo; `next/*` doblado (sin
 * servidor de Next) y los `.module.css` como un objeto cuyo nombre de clase
 * es la propia llave, como en `agenda-flexible-pintada.test.tsx`. Un archivo
 * `"use server"` (acción de servidor) se cambia, como hace Next, por funciones
 * que no llegan al servidor: aquí lanzan si alguien las llama. El resultado
 * se queda en memoria; nada se escribe en el repo.
 *
 * Playwright NO es dependencia del repo: se busca en `NAVEGADOR_DIR` (o en
 * `~/navegador`). Si no está, quien llama SALTA la prueba diciéndolo.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();

const NEXT_DOBLADO: Record<string, string> = {
  "next/navigation": `
    export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {} });
    export const usePathname = () => "/dashboard/agenda";
    export const useSearchParams = () => new URLSearchParams();
    export const redirect = () => {};
    export const notFound = () => {};`,
  "next/link": `
    import { createElement, forwardRef } from "react";
    export default forwardRef(function Link({ href, prefetch, replace, scroll, ...resto }, ref) {
      return createElement("a", { ...resto, ref, href: typeof href === "string" ? href : "#" });
    });`,
  "next/image": `
    import { createElement } from "react";
    export default function Image({ fill, priority, ...resto }) { return createElement("img", resto); }`,
};

export async function empaquetar(entrada: string): Promise<string> {
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [join(RAIZ, entrada)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    logLevel: "silent",
    plugins: [
      {
        name: "dobles",
        setup(b) {
          b.onResolve({ filter: /^next\// }, (a) => ({ path: a.path, namespace: "next-doblado" }));
          b.onLoad({ filter: /.*/, namespace: "next-doblado" }, (a) => ({
            contents:
              NEXT_DOBLADO[a.path] ??
              `const f = () => ({ className: "", variable: "", style: {} }); export default f;`,
            loader: "js",
            resolveDir: RAIZ,
          }));
          // Acciones de servidor: Next las cambia por una llamada RPC.
          b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, (a) => {
            const texto = readFileSync(a.path, "utf8");
            if (!/^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(texto)) return undefined;
            const nombres = [...texto.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
            return {
              contents: nombres
                .map((n) => `export async function ${n}() { throw new Error("acción de servidor ${n}: no hay servidor en esta prueba"); }`)
                .join("\n"),
              loader: "js",
            };
          });
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "css-doblado" }));
          b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: "css-doblado" }));
          b.onLoad({ filter: /.*/, namespace: "css-doblado" }, () => ({
            contents: `export default new Proxy({}, { get: (_t, k) => String(k) });`,
            loader: "js",
          }));
        },
      },
    ],
  });
  return r.outputFiles[0]!.text;
}

/**
 * El `chromium` de Playwright, o `null` si no está instalado. En un servidor
 * sin root, sus bibliotecas del sistema viven en `NAVEGADOR_LIBS` (por
 * defecto `~/.cache/pw-syslibs`, lo que exporta `~/navegador/nav.sh entorno`).
 */
export async function cargarChromium(): Promise<null | { launch(o?: any): Promise<any> }> {
  const dir = process.env.NAVEGADOR_DIR ?? join(homedir(), "navegador");
  const ruta = join(dir, "node_modules/playwright/index.mjs");
  if (!existsSync(ruta)) return null;
  let chromium: { launch(o?: any): Promise<any> };
  try {
    chromium = (await import(pathToFileURL(ruta).href)).chromium;
  } catch {
    return null;
  }
  const libs = process.env.NAVEGADOR_LIBS ?? join(homedir(), ".cache/pw-syslibs");
  const l = join(libs, "usr/lib/x86_64-linux-gnu");
  const env: Record<string, string | undefined> = existsSync(l)
    ? {
        ...process.env,
        LD_LIBRARY_PATH: [l, join(l, "nss"), join(l, "pulseaudio"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
        FONTCONFIG_PATH: join(libs, "etc/fonts"),
      }
    : { ...process.env };
  return { launch: (o: any = {}) => chromium.launch({ ...o, env: { ...env, ...(o.env ?? {}) } }) };
}
