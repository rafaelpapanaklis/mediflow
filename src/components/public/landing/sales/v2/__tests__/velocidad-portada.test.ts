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
