/**
 * Seguridad (auditoría «cloudflare», nº4): el intercambio del Embedded Signup
 * de WhatsApp (solo dental) ya no guarda un phone_number_id que la clínica no
 * prueba que es suyo.
 *
 * Run: npm run test:seg-whatsapp-numero
 *   (--experimental-test-module-mocks: se ejecuta de verdad
 *    POST /api/whatsapp/embedded/exchange con Prisma, la auth, el cifrado y
 *    `fetch` sustituidos. Ninguna llamada sale a Meta.)
 *
 * Con el código de 0f61a7e0d el número del cuerpo se guardaba aunque
 * `GET /{wabaId}/phone_numbers` no lo listara (las llamadas a Meta eran
 * «best-effort» y su resultado no se miraba).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const GRAPH = "https://graph.facebook.com/v19.0";

let clinicas: Array<{ id: string; waPhoneNumberId: string | null }> = [];
let guardado: any = null;
let llamadas: string[] = [];
/** Qué números lista cada WABA para el token del intercambio. */
let numerosDelWaba: Record<string, string[]> = {};
let phoneNumbersStatus = 200;

beforeEach(() => {
  clinicas = [
    { id: "cA", waPhoneNumberId: null },
    { id: "cB", waPhoneNumberId: "PNID-B" },
  ];
  guardado = null;
  llamadas = [];
  numerosDelWaba = { "W-A": ["PNID-A"] };
  phoneNumbersStatus = 200;
  process.env.META_APP_ID = "app-prueba";
  process.env.META_APP_SECRET = "secreto-prueba";
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findFirst: async ({ where }: any) =>
          clinicas.find((c) => c.waPhoneNumberId === where.waPhoneNumberId && c.id !== where.id?.not) ?? null,
        update: async ({ where, data }: any) => {
          guardado = { where, data };
          return { id: where.id, ...data };
        },
      },
    },
  },
});
(mock as any).module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ clinicId: "cA", userId: "uA", role: "ADMIN", isAdmin: true }),
    requireAdmin: (ctx: any) => (ctx?.isAdmin ? null : new Response("no", { status: 403 })),
  },
});
(mock as any).module("@/lib/crypto/envelope", { namedExports: { encryptField: (v: string) => `cifrado:${v}` } });
(mock as any).module("@/lib/whatsapp/provision-templates", { namedExports: { provisionClinicTemplates: async () => undefined } });

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  llamadas.push(`${init?.method ?? "GET"} ${url}`);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith(`${GRAPH}/oauth/access_token`)) return json(200, { access_token: "token-del-intercambio" });
  const m = url.match(/\/v19\.0\/([^/?]+)\/phone_numbers/);
  if (m) {
    if (phoneNumbersStatus !== 200) return json(phoneNumbersStatus, { error: { message: "sin permiso" } });
    assert.equal(init?.headers?.Authorization, "Bearer token-del-intercambio", "se pregunta con el token del intercambio");
    return json(200, { data: (numerosDelWaba[decodeURIComponent(m[1])] ?? []).map((id) => ({ id })) });
  }
  // subscribed_apps, register y el nombre: Meta responde error, como en el ataque.
  return json(400, { error: { message: "no aplica" } });
}) as typeof fetch;

async function exchange(body: unknown) {
  const { POST } = await import("@/app/api/whatsapp/embedded/exchange/route");
  const res = await POST({ json: async () => body } as any);
  return { status: res.status, body: await res.json() };
}

test("nº4 · un phone_number_id que el WABA del intercambio NO lista → 403 y no se guarda, ni se suscribe ni se registra", async () => {
  const r = await exchange({ code: "codigo-prueba-123", wabaId: "W-A", phoneNumberId: "PNID-DE-OTRO-NEGOCIO" });
  assert.equal(r.status, 403);
  assert.equal(r.body.success, false);
  assert.equal(guardado, null, "no se escribe la clínica");
  assert.ok(!llamadas.some((l) => l.includes("/subscribed_apps") || l.includes("/register")), "sin efectos en Meta");
});

test("nº4 · si Meta no deja leer los números del WABA (token sin permiso) → 403 y no se guarda", async () => {
  phoneNumbersStatus = 400;
  const r = await exchange({ code: "codigo-prueba-123", wabaId: "W-A", phoneNumberId: "PNID-A" });
  assert.equal(r.status, 403);
  assert.equal(guardado, null);
});

test("nº4 · un número que ya tiene OTRA clínica dental → 409, sin suscribir, registrar ni guardar", async () => {
  numerosDelWaba["W-A"] = ["PNID-B"];
  const r = await exchange({ code: "codigo-prueba-123", wabaId: "W-A", phoneNumberId: "PNID-B" });
  assert.equal(r.status, 409);
  assert.equal(guardado, null);
  assert.ok(!llamadas.some((l) => l.includes("/subscribed_apps") || l.includes("/register")), "sin efectos en Meta");
});

// Revisión t12 (m2): el 409 va DESPUÉS de la prueba de propiedad. Antes, un
// ADMIN cualquiera, sin un code válido ni un WABA que liste el número, podía
// preguntar si un phone_number_id ajeno ya estaba conectado a otra clínica.
test("m2 · sin probar que el número es suyo, no se revela si otra clínica lo tiene (ni 409)", async () => {
  // El WABA del intercambio no lista PNID-B (es de la clínica B).
  const r = await exchange({ code: "codigo-prueba-123", wabaId: "W-A", phoneNumberId: "PNID-B" });
  assert.equal(r.status, 403, "lo mismo que con un número que no existe");
  const nadie = await exchange({ code: "codigo-prueba-123", wabaId: "W-A", phoneNumberId: "PNID-DE-NADIE" });
  assert.equal(nadie.status, r.status);
  assert.deepEqual(nadie.body, r.body, "misma respuesta para el número de otra clínica y para uno libre");
  assert.equal(guardado, null);
});

test("nº4 · el caso legítimo sigue igual: el WABA lista el número → se guarda en la clínica de la sesión", async () => {
  const r = await exchange({ code: "codigo-prueba-123", wabaId: "W-A", phoneNumberId: "PNID-A" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
  assert.equal(guardado.where.id, "cA");
  assert.equal(guardado.data.waPhoneNumberId, "PNID-A");
  assert.equal(guardado.data.waAccessToken, "cifrado:token-del-intercambio");
  // Reconectar SU propio número no choca con ella misma.
  clinicas[0].waPhoneNumberId = "PNID-A";
  guardado = null;
  const otra = await exchange({ code: "codigo-prueba-456", wabaId: "W-A", phoneNumberId: "PNID-A" });
  assert.equal(otra.status, 200);
  assert.equal(guardado.data.waPhoneNumberId, "PNID-A");
});
