/* ═══════════════════════════════════════════════════════════════════════
   /api/barber/landing SOLO GUARDA LAS PLANTILLAS QUE SE OFRECEN (ws6-t2).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/app/api/barber/landing/__tests__/plantillas-ofrecidas.test.ts

   Se carga el route handler REAL. Dobles: la sesión y el permiso, el plan
   (Avanzado: con editor), Prisma (una fila en memoria, con el `where` de
   `version` de verdad) y next/cache.

   Lo que se exige:
     · mandar a mano una de las doce viejas («clasica») o un id inventado →
       400 con la lista de las que sí, y NADA se escribe;
     · una de las tres → se guarda;
     · una barbería con «clasica» guardada la LEE como Oficio (GET) y, al
       guardar —directo o fundiendo con otra pestaña—, nunca se vuelve a
       escribir «clasica».
   ═══════════════════════════════════════════════════════════════════════ */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type Fila = { barbershopId: string; template: string; config: unknown; version: number };

const st = {
  fila: null as Fila | null,
  escrituras: 0,
};

class ForbiddenError extends Error {}

const root = path.resolve(__dirname, "../../../../../..");
const dobles = new Map<string, unknown>([
  [
    path.join(root, "src/lib/barber-auth.ts"),
    {
      BarberForbiddenError: ForbiddenError,
      getBarberContext: async () => ({
        barbershopId: "shopA",
        barberUserId: "u1",
        role: "OWNER",
        barbershop: { slug: "el-roble", plan: "AVANZADO" },
        user: {},
      }),
      assertBarberPermission: () => undefined,
    },
  ],
  [
    path.join(root, "src/lib/barber/plans.ts"),
    { getBarberPlan: async () => ({ id: "AVANZADO", features: { miniWebEditor: true } }) },
  ],
  [
    path.join(root, "src/lib/prisma.ts"),
    {
      prisma: {
        barberLandingConfig: {
          findUnique: async ({ where }: { where: { barbershopId: string } }) =>
            st.fila && st.fila.barbershopId === where.barbershopId ? { ...st.fila } : null,
          updateMany: async ({ where, data }: { where: { barbershopId: string; version: number }; data: Partial<Fila> }) => {
            if (!st.fila || st.fila.barbershopId !== where.barbershopId || st.fila.version !== where.version) return { count: 0 };
            st.fila = { ...st.fila, template: data.template!, config: data.config, version: data.version! };
            st.escrituras++;
            return { count: 1 };
          },
          create: async ({ data }: { data: Fila }) => {
            st.fila = { barbershopId: data.barbershopId, template: data.template, config: data.config, version: data.version };
            st.escrituras++;
            return st.fila;
          },
        },
      },
    },
  ],
]);

type Mod = typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
};
const M = Module as Mod;
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  if (request === "next/cache") return { revalidatePath: () => undefined };
  let file: string | null = null;
  try {
    file = M._resolveFilename.call(this, request, parent, isMain);
  } catch {
    file = null;
  }
  if (file && dobles.has(file)) return dobles.get(file);
  return originalLoad.call(this, request, parent, isMain);
};

let GET: () => Promise<Response>;
let PATCH: (req: NextRequest) => Promise<Response>;

before(async () => {
  ({ GET, PATCH } = await import("../route"));
});

beforeEach(() => {
  st.fila = null;
  st.escrituras = 0;
});

const patch = (body: Record<string, unknown>) =>
  PATCH(
    new NextRequest("http://x.test/api/barber/landing", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

for (const vieja of ["clasica", "vintage", "club", "inventada"]) {
  test(`guardar «${vieja}» a mano → 400 claro, y no se escribe nada`, async () => {
    st.fila = { barbershopId: "shopA", template: "oficio", config: {}, version: 2 };
    const r = await patch({ template: vieja, version: 2, config: {} });
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.match(j.error, new RegExp(`«${vieja}» ya no se puede elegir`));
    assert.match(j.error, /Oficio, Barrio o Revista/);
    assert.deepEqual(j.plantillasOfrecidas, ["oficio", "barrio", "revista"]);
    assert.equal(st.escrituras, 0);
    assert.equal(st.fila!.template, "oficio");
  });
}

for (const buena of ["oficio", "barrio", "revista"]) {
  test(`guardar «${buena}» → se guarda`, async () => {
    const r = await patch({ template: buena, version: 0, config: {} });
    assert.equal(r.status, 200);
    assert.equal(st.fila!.template, buena);
  });
}

test("sin `template` en el cuerpo → la de por defecto (Oficio), como siempre", async () => {
  const r = await patch({ version: 0, config: {} });
  assert.equal(r.status, 200);
  assert.equal(st.fila!.template, "oficio");
});

test("GET: una barbería con «clasica» guardada la recibe como Oficio (sin tocar la base)", async () => {
  st.fila = { barbershopId: "shopA", template: "clasica", config: { copia: { "portada.cta": "Agenda ya" } }, version: 5 };
  const j = await (await GET()).json();
  assert.equal(j.template, "oficio");
  assert.equal(j.config.copia["portada.cta"], "Agenda ya", "se perdió su texto");
  assert.equal(st.escrituras, 0);
  assert.equal(st.fila.template, "clasica", "el GET escribió en la base");
});

test("vieja guardada + guardado directo desde el editor → queda Oficio", async () => {
  st.fila = { barbershopId: "shopA", template: "clasica", config: {}, version: 5 };
  const r = await patch({ template: "oficio", version: 5, config: {}, base: { template: "oficio", config: {} } });
  assert.equal(r.status, 200);
  assert.equal(st.fila.template, "oficio");
});

test("vieja guardada + la fila se movió (fusión) → NO vuelve a escribir «clasica»", async () => {
  // El editor abrió con versión 5 y la vio como Oficio; mientras, otra
  // pestaña (de antes de este cambio) guardó con «clasica» y subió a 6.
  st.fila = { barbershopId: "shopA", template: "clasica", config: {}, version: 6 };
  const r = await patch({
    template: "oficio",
    version: 5,
    config: { copia: { "portada.cta": "Agenda ya" } },
    base: { template: "oficio", config: {} },
  });
  assert.equal(r.status, 200);
  assert.equal(st.fila.template, "oficio");
  assert.equal(st.fila.version, 7);
});
