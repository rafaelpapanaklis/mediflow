/**
 * La barra del Asistente IA no lista las conversaciones de Sabina.
 *
 * Run: npm run test:asistente-sin-sabina
 *
 * Las dos guardan su historial en `ai_conversations`. Sabina marca las suyas con
 * `legacyId = "sabina:<uuid>"` (src/lib/sabina/engine-historial.ts) y su barra
 * solo lista esas; faltaba el otro lado: que `listConversations` —la barra del
 * Asistente IA— no las listara. La propia pantalla de Sabina lo dejó anotado.
 *
 * La trampa: `legacyId` es NULL en casi todas las conversaciones del Asistente,
 * y un `NOT startsWith` a secas en SQL da NULL para esas filas y las esconde a
 * TODAS. Medido contra Postgres 16 con Prisma 5.22: el filtro ingenuo deja la
 * barra solo con las migradas desde localStorage. La prueba contra base real
 * está en `conversations.integration.test.ts` (se salta sin DATABASE_URL); esta
 * corre siempre y fija la forma del `where` que se manda a Prisma.
 */
import "../../clinical-shared/__tests__/_sin-server-only"; // PRIMERO: @/lib/prisma arrastra "server-only"
import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

const llamadas: any[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        aiConversation: {
          findMany: async (args: any) => {
            llamadas.push(args);
            return [];
          },
        },
      },
    },
  });
});

test("listConversations excluye las de Sabina y deja pasar las de legacyId NULL", async () => {
  const mod: any = await import("../conversations");
  assert.equal(mod.SABINA_LEGACY_PREFIX, "sabina:", "falta la marca de Sabina en el historial del Asistente");

  for (const search of [null, "gutapercha"]) {
    llamadas.length = 0;
    await mod.listConversations({ clinicId: "clinicA", userId: "userA1" }, { search });
    const where = llamadas[0]?.where;
    assert.ok(where, "no se consultó");
    assert.equal(where.clinicId, "clinicA");
    assert.equal(where.userId, "userA1");

    // El filtro va en AND, para no pisar el OR de la búsqueda.
    assert.deepEqual(where.AND, [
      { OR: [{ legacyId: null }, { NOT: { legacyId: { startsWith: "sabina:" } } }] },
    ], `sin el filtro de Sabina (search=${search})`);
    if (search) assert.equal(where.OR.length, 2, "el filtro de Sabina pisó la búsqueda");
  }
});

test("la marca que filtra el Asistente es la misma con la que Sabina guarda", async () => {
  const { SABINA_LEGACY_PREFIX } = (await import("../conversations")) as any;
  await import("../../sabina/engine-sin-server-only");
  const { MARCA_SABINA } = await import("../../sabina/engine-historial");
  assert.equal(SABINA_LEGACY_PREFIX, MARCA_SABINA);
});
