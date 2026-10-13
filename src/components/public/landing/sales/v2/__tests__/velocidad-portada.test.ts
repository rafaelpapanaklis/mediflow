/**
 * Velocidad de la portada en celular (12-oct-2026, ws1-t4, punto 3a/3b del
 * encargo de ws7). Run: npm run test:portada-seo
 *
 * Son pruebas sobre el FUENTE (no hay navegador): fijan lo que Lighthouse
 * encontró en el build de producción «antes» y que fallaba con el código
 * anterior:
 *   · supabase-js (150 KB) viajaba en el JS inicial de la portada por el
 *     `import { createClient }` estático de nav-session.tsx;
 *   · 8 <video> con preload="auto"/"metadata" y 8 pósters (430 KB) bajaban al abrir;
 *   · la captura de 1120 × 6417 iba `eager` (con <link rel=preload>) a 5
 *     pantallas del hero, y las 4 vistas CBCT también;
 *   · 14 imágenes con alt="" (punto 3b) y el enlace del logo sin nombre.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const aqui = dirname(fileURLToPath(import.meta.url));
const v2 = join(aqui, "..");
const leer = (rel: string) => readFileSync(join(v2, rel), "utf8");

describe("JS inicial de la portada", () => {
  it("nav-session.tsx carga supabase-js con import() y solo cuando hay cookie de sesión", () => {
    const src = readFileSync(join(v2, "../../nav-session.tsx"), "utf8");
    assert.ok(!/^import .*supabase/m.test(src), "import estático de supabase");
    assert.ok(src.includes('import("@/lib/supabase/client")'));
    assert.ok(src.indexOf("if (!hasAuthCookie) return;") < src.indexOf('import("@/lib/supabase/client")'));
  });
});

describe("videos de la portada", () => {
  for (const archivo of ["panel-vivo.tsx", "laptop-video.tsx"]) {
    it(`${archivo}: nace con preload="none" y sin pósters; se enciende a 600 px (cerca)`, () => {
      const src = leer(archivo);
      assert.ok(!src.includes('preload="auto"'), "preload=\"auto\" fijo");
      assert.ok(/preload=\{cerca \? /.test(src));
      assert.ok(/: "none"\}/.test(src));
      assert.ok(/poster=\{cerca \? /.test(src), "el póster debe esperar a cerca (bajaba antes que las fuentes)");
      assert.ok(src.includes('rootMargin: "600px 0px"'));
      assert.ok(src.includes("setCerca(true)"));
    });
  }
});

describe("imágenes de la portada", () => {
  const archivos = ["funciones-ilustraciones.tsx", "hero.tsx", "mockups.tsx", "recorrido-section.tsx"];

  it("ninguna <Image> va eager (la captura de 1120 × 6417 se pide al acercarse)", () => {
    for (const a of archivos) assert.ok(!leer(a).includes('loading="eager"'), a);
  });

  it("todas las <Image>/<img> llevan alt con texto (punto 3b: 14 imágenes sin alt)", () => {
    for (const a of archivos) {
      assert.ok(!/\balt=""/.test(leer(a)), `${a} tiene alt=""`);
    }
    const ilu = leer("funciones-ilustraciones.tsx");
    assert.ok(ilu.includes("alt={`Plantilla ${nombre}"));
    assert.ok(ilu.includes("alt={`${v.label} de un estudio CBCT"));
    assert.ok(leer("hero.tsx").includes('alt="Modelo 3D de un CBCT'));
  });

  it("el logo del nav tiene nombre accesible (en celular se oculta el texto)", () => {
    assert.ok(readFileSync(join(v2, "../nav.tsx"), "utf8").includes('aria-label="DaleControl — inicio"'));
  });
});

describe("encabezados", () => {
  it("la tarjeta de Funciones y el chip de «Todo el panel» ya no repiten el mismo h3", () => {
    const funciones = leer("funciones-v3-data.ts");
    const todo = leer("landing-data.ts");
    assert.ok(funciones.includes('title: "Tu página web, gratis"'));
    assert.ok(!todo.includes("title: 'Tu página web, gratis'"));
    assert.ok(todo.includes("title: 'Página web de tu clínica, gratis'"));
  });
});

/* Segunda vuelta (13-oct-2026, ws1-t4): CLS de campo 0,46, fuentes precargadas,
   contraste de las caras del prisma y el video decorativo de la laptop. */
describe("CLS de campo: la barra de la portada no se parte con la fuente de reserva", () => {
  const css = leer("landing-v2.css");
  const i = css.indexOf(".dcv4-navbar--portada { flex-wrap: nowrap; }");

  it("hay una regla que impide partir la fila en los anchos donde con Inter va en una", () => {
    assert.ok(i > 0, "falta .dcv4-navbar--portada { flex-wrap: nowrap }");
    const regla = css.slice(css.lastIndexOf("@media", i), css.indexOf("\n}", i));
    assert.ok(regla.includes(".dcv4-navbar--portada { flex-wrap: nowrap; }"));
    assert.ok(regla.includes(".dcv4-navbar--portada > div:last-child { min-width: 0; flex: 0 1 auto !important; }"));
    assert.ok(regla.includes(".dcv4-navbar--portada > div:last-child > a { min-width: 0; flex: 0 1 auto !important; overflow: hidden; }"));
    for (const tramo of ["(min-width: 355px) and (max-width: 400px)", "(min-width: 440px) and (max-width: 480px)", "(min-width: 485px) and (max-width: 560px)", "(min-width: 590px)"]) {
      assert.ok(regla.includes(tramo), `falta el tramo ${tramo}`);
    }
  });

  it("y NO toca los anchos donde hoy la barra va en dos filas (401-439, 481-484, 561-589)", () => {
    const regla = css.slice(css.lastIndexOf("@media", i), css.indexOf("{", i));
    assert.ok(!/min-width: 401px|min-width: 481px|min-width: 561px/.test(regla));
    assert.ok(!regla.includes("(max-width: 439px)") && !regla.includes("(max-width: 589px)"));
  });

  it("la red de seguridad general (flex-wrap: wrap a 320 px) sigue", () => {
    assert.ok(css.includes(".dcv4-navbar { flex-wrap: wrap; }"));
  });
});

describe("fuentes del layout raíz", () => {
  const src = readFileSync(join(v2, "../../../../../fonts/root.ts"), "utf8");
  const bloque = (nombre: string) => src.slice(src.indexOf(`export const ${nombre} = localFont({`), src.indexOf("});", src.indexOf(`export const ${nombre} = localFont({`)));

  it("mono ya no se precarga (4 .woff2 que la portada no usa por encima del pliegue)", () => {
    assert.ok(bloque("mono").includes("preload: false"));
  });

  it("logo y sans siguen precargadas (sin precarga el wordmark saltaba de letra a 1440)", () => {
    assert.ok(!bloque("logo").includes("preload: false"));
    assert.ok(!bloque("sans").includes("preload: false"));
  });

  it("las tres siguen con display swap y las mismas variables", () => {
    for (const n of ["sans", "mono", "logo"]) assert.ok(bloque(n).includes('display: "swap"'), n);
    assert.ok(src.includes('variable: "--font-mono"') && src.includes('variable: "--font-logo"') && src.includes('variable: "--font-sans"'));
  });
});

describe("contraste AA de los textos chicos de las caras del prisma", () => {
  const css = leer("hero-3d-v2.css");
  const regla = (sel: string) => {
    const i = css.indexOf(`\n${sel} {`);
    assert.ok(i >= 0, `falta ${sel}`);
    return css.slice(i, css.indexOf("}", i));
  };

  it("ningún gris #858295 / #667781 / #8696a0 sobre fondo claro (3,7 / 4,2 / 3,1 : 1)", () => {
    for (const sel of [".dch3-s", ".dch3-hora", ".dch3-cita b", ".dch3-total", ".dch3-estado__r.is-dim"]) {
      assert.ok(!regla(sel).includes("#858295"), `${sel} sigue en #858295`);
    }
    assert.ok(!regla(".dch3-wa__meta").includes("#667781"));
    assert.ok(!regla(".dch3-wa__field").includes("#8696a0"));
    assert.ok(!regla(".dch3-wa__ticks").includes("#53bdeb"));
    assert.ok(!regla(".dch3-wa .dch3-s").includes(".85"));
  });

  it("los tonos nuevos son los calculados (mismo matiz, ≥ 4,5:1)", () => {
    assert.ok(regla(".dch3-s").includes("#777485"));
    assert.ok(regla(".dch3-hora").includes("#706e7e"));
    assert.ok(regla(".dch3-wa__meta").includes("#61727b"));
    assert.ok(regla(".dch3-wa__field").includes("#6c7880"));
    assert.ok(regla(".dch3-wa__ticks").includes("#347793"));
    assert.ok(regla(".dch3-wa .dch3-s").includes("rgba(255, 255, 255, .95)"));
  });

  it("los grises sobre las caras oscuras (ya pasaban) no cambian", () => {
    assert.ok(regla(".dch3-face--dark .dch3-s").includes("#a8a5b8"));
    assert.ok(regla(".dch3-ia__input").includes("#858295"));
  });
});

describe("video decorativo de la laptop", () => {
  it("cada <video> va aria-hidden y fuera del orden de foco; la descripción la da el role=img del contenedor", () => {
    const src = leer("laptop-video.tsx");
    const video = src.slice(src.indexOf("<video"), src.indexOf("/>", src.indexOf("<video")));
    assert.ok(video.includes('aria-hidden="true"'));
    assert.ok(video.includes("tabIndex={-1}"));
    assert.ok(!video.includes("<track"), "no lleva subtítulos: es decorativo y sin audio");
    assert.ok(src.includes('role="img" aria-label={label}'));
  });
});
