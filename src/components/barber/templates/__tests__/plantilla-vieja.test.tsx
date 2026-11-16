/* ═══════════════════════════════════════════════════════════════════════
   UNA PLANTILLA VIEJA GUARDADA SE VE COMO OFICIO (ws6-t2, 16-nov).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/templates/__tests__/plantilla-vieja.test.tsx

   La barbería de prueba tiene «clasica» guardada. Desde que solo se ofrecen
   Oficio, Barrio y Revista, su página pública se pinta con Oficio y el
   editor le enseña Oficio ELEGIDA, sin escribir en la base, y con sus
   textos, fotos y reseñas intactos (las claves de copia son compartidas).

   Se carga el cargador REAL de /b/[slug] (shop-data.ts) con dobles de
   Prisma (filas en memoria) y de cobros; la plantilla y el editor, reales.
   ═══════════════════════════════════════════════════════════════════════ */
import "./_sin-css"; // ← PRIMERO: las plantillas y el editor arrastran CSS
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

const st = {
  fila: null as null | { template: string; config: unknown; version: number; publishedAt: Date | null },
  escrituras: 0,
};

const CONFIG = {
  acento: "cobre",
  copia: { "portada.cta": "Agenda tu corte", "portada.eslogan": "Desde 1987 en el Centro." },
  fotos: { portada: "https://x.test/portada.webp" },
  resenas: [{ nombre: "Roberto M.", texto: "Nunca he salido con un mal corte.", estrellas: 5 }],
  galeria: ["https://x.test/c1.webp"],
  whatsapp: "529995550142",
};

const root = path.resolve(__dirname, "../../../../..");
const sinEscribir = async () => {
  st.escrituras++;
  throw new Error("el cargador público NO escribe");
};
const dobles = new Map<string, unknown>([
  [
    path.join(root, "src/lib/prisma.ts"),
    {
      prisma: {
        barbershop: {
          findUnique: async () => ({
            id: "shopA",
            name: "Barbería El Roble",
            slug: "el-roble",
            phone: "999 555 0142",
            address: "Calle 60 #452",
            city: "Mérida",
            state: "Yucatán",
            logoUrl: null,
            isActive: true,
            subscriptionStatus: "active",
            parentId: null,
          }),
        },
        barberService: {
          findMany: async () => [
            { id: "s1", name: "Corte clásico", description: null, durationMin: 30, price: 180, category: "Corte" },
          ],
        },
        barber: {
          findMany: async () => [
            { id: "b1", name: "Jesús Canul", nickname: "Don Chuy", photoUrl: null, bio: null, _count: { schedules: 2 } },
          ],
        },
        barberLandingConfig: {
          findUnique: async () => (st.fila ? { ...st.fila } : null),
          update: sinEscribir,
          updateMany: sinEscribir,
          upsert: sinEscribir,
          create: sinEscribir,
        },
      },
    },
  ],
  [path.join(root, "src/lib/barber/cobros.ts"), { barberiaAlCorriente: async () => true }],
]);

type Mod = typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
};
const M = Module as Mod;
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  let file: string | null = null;
  try {
    file = M._resolveFilename.call(this, request, parent, isMain);
  } catch {
    file = null;
  }
  if (file && dobles.has(file)) return dobles.get(file);
  return originalLoad.call(this, request, parent, isMain);
};

type Carga = typeof import("../../../../app/b/[slug]/_shared/shop-data");
let cargarBarberWeb: Carga["cargarBarberWeb"];
let PlantillaBarberWeb: typeof import("../index")["PlantillaBarberWeb"];
let EditorWebBarberia: typeof import("../../landing/editor")["EditorWebBarberia"];
let getBarberDict: typeof import("../../../../i18n/dictionaries/barber")["getBarberDict"];
let UpsellWebBarberia: typeof import("../../landing/upsell")["UpsellWebBarberia"];

before(async () => {
  ({ cargarBarberWeb } = await import("../../../../app/b/[slug]/_shared/shop-data"));
  ({ PlantillaBarberWeb } = await import("../index"));
  ({ EditorWebBarberia } = await import("../../landing/editor"));
  ({ getBarberDict } = await import("../../../../i18n/dictionaries/barber"));
  ({ UpsellWebBarberia } = await import("../../landing/upsell"));
});

beforeEach(() => {
  st.fila = null;
  st.escrituras = 0;
});

for (const vieja of ["clasica", "vintage", "nocturna"]) {
  test(`«${vieja}» guardada → la página pública se pinta con Oficio, con SUS textos y fotos`, async () => {
    st.fila = { template: vieja, config: CONFIG, version: 4, publishedAt: new Date("2026-11-01T12:00:00Z") };
    const carga = await cargarBarberWeb("el-roble");
    assert.ok(carga);
    assert.equal(carga!.data.manifest.id, "oficio");
    const html = renderToStaticMarkup(<PlantillaBarberWeb data={carga!.data} />);
    assert.ok(html.includes("dcbw-oficio"), "no se pintó con Oficio");
    assert.ok(!html.includes(`dcbw-${vieja}`), `sigue saliendo la piel de ${vieja}`);
    assert.ok(html.includes("Agenda tu corte"), "se perdió su botón reescrito");
    assert.ok(html.includes("Desde 1987 en el Centro."), "se perdió su frase");
    assert.ok(html.includes("https://x.test/portada.webp"), "se perdió su foto de portada");
    assert.ok(html.includes("Nunca he salido con un mal corte."), "se perdió su reseña");
    assert.equal(st.escrituras, 0, "el cargador escribió en la base");
  });
}

for (const buena of ["barrio", "revista"]) {
  test(`«${buena}» guardada → se respeta`, async () => {
    st.fila = { template: buena, config: CONFIG, version: 4, publishedAt: null };
    const carga = await cargarBarberWeb("el-roble");
    assert.equal(carga!.data.manifest.id, buena);
  });
}

test("sin fila (Básico, o nunca abrió Mi web) → Oficio", async () => {
  const carga = await cargarBarberWeb("el-roble");
  assert.equal(carga!.data.manifest.id, "oficio");
});

test("Básico (upsell): el texto nombra la plantilla que DE VERDAD se pinta", async () => {
  for (const [guardada, nombre] of [
    [null, "Oficio"],
    ["clasica", "Oficio"],
    ["barrio", "Barrio"],
  ] as const) {
    st.fila = guardada ? { template: guardada, config: CONFIG, version: 1, publishedAt: null } : null;
    const carga = await cargarBarberWeb("el-roble");
    for (const idioma of ["es", "en"] as const) {
      const html = renderToStaticMarkup(
        <UpsellWebBarberia dict={getBarberDict(idioma)} data={{ ...carga!.data, editando: false }} urlPublica="https://x.test/b/el-roble" />,
      );
      const frase = idioma === "es" ? `con la plantilla ${nombre},` : `with the ${nombre} template,`;
      assert.ok(html.includes(frase), `${idioma}, guardada=${guardada}: no dice «${frase}»`);
      assert.ok(!html.includes("{plantilla}"), "quedó la llave sin reemplazar");
    }
  }
});

test("el editor enseña Oficio ELEGIDA a quien tiene «clasica» guardada, y solo ofrece las tres", async () => {
  st.fila = { template: "clasica", config: CONFIG, version: 4, publishedAt: null };
  const carga = await cargarBarberWeb("el-roble");
  // Como /barber/mi-web: `template` sale de carga.data.manifest.id.
  for (const template of [carga!.data.manifest.id, "clasica"]) {
    const html = renderToStaticMarkup(
      <EditorWebBarberia
        {...({
          tienda: { disponible: false, total: 0, url: "/b/el-roble/tienda", productos: [] },
          dict: getBarberDict("es"),
          shop: carga!.data.shop,
          servicios: carga!.data.servicios,
          barberos: carga!.data.barberos,
          template,
          config: carga!.data.config,
          version: carga!.version,
          publishedAtIso: null,
          urlPublica: "https://x.test/b/el-roble",
          sinTabla: false,
        } as any)}
      />,
    );
    const nombres = Array.from(html.matchAll(/dcbwe-plantilla-txt"><strong>([^<]+)<\/strong>/g)).map((m) => m[1]);
    assert.deepEqual(nombres, ["Oficio", "Barrio", "Revista"], `con template=${template}`);
    const activa = /dcbwe-plantilla dcbwe-plantilla-activa"[\s\S]*?<strong>([^<]+)<\/strong>/.exec(html)?.[1];
    assert.equal(activa, "Oficio", `con template=${template} la elegida no es Oficio`);
    assert.ok(html.includes("Plantilla · Oficio"), "el panel no dice «Plantilla · Oficio»");
  }
});
