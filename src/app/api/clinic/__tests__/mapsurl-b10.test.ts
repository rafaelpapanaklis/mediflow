/**
 * B10 (auditoría 30-sep-2026) — PATCH /api/clinic: `mapsUrl` solo http/https.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let escrito: any;

beforeEach(() => {
  escrito = null;
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findUnique: async () => ({ category: "DENTAL" }),
        update: async ({ data }: any) => { escrito = data; return { id: "c1", ...data }; },
      },
    },
  },
});
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ user: { id: "u", clinicId: "c1", role: "ADMIN", permissionsOverride: [] } }) },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });

const patch = async (body: unknown) => {
  const { PATCH } = await import("@/app/api/clinic/route");
  return PATCH({ json: async () => body } as any);
};

test("mapsUrl con javascript:, data: o file: es 400 y no se escribe nada", async () => {
  for (const malo of ["javascript:alert(document.cookie)", "JAVASCRIPT:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd"]) {
    const res = await patch({ mapsUrl: malo });
    assert.equal(res.status, 400, malo);
    assert.equal(escrito, null, malo);
  }
});

test("mapsUrl http/https se guarda; sin esquema se normaliza a https://; vacío lo borra", async () => {
  assert.equal((await patch({ mapsUrl: "https://maps.app.goo.gl/abc" })).status, 200);
  assert.equal(escrito.mapsUrl, "https://maps.app.goo.gl/abc");
  assert.equal((await patch({ mapsUrl: "maps.app.goo.gl/xyz" })).status, 200);
  assert.equal(escrito.mapsUrl, "https://maps.app.goo.gl/xyz");
  assert.equal((await patch({ mapsUrl: "" })).status, 200);
  assert.equal(escrito.mapsUrl, null);
  assert.equal((await patch({ mapsUrl: null })).status, 200);
  assert.equal(escrito.mapsUrl, null);
});

test("sin mapsUrl en el cuerpo no se toca (el resto de Ajustes sigue guardando)", async () => {
  assert.equal((await patch({ city: "Mérida" })).status, 200);
  assert.ok(!("mapsUrl" in escrito));
  assert.equal(escrito.city, "Mérida");
});
