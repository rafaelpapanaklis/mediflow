// RONDA 2 · M3 — la sede de la PANTALLA viaja en cada escritura (lado cliente).
// Pura: una ventana de mentira con un fetch que apunta lo que recibe.
//
//   npx tsx --test src/lib/barber/__tests__/sede-pin.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { installSedePin, needsSedePin, BARBER_SEDE_CURRENT_PATH } from "../sede-pin";
import { BARBER_BRANCH_PIN_HEADER } from "../branch-cookie";

const ORIGIN = "https://app.dalecontrol.test";

function ventana(responder: (url: string, init?: RequestInit) => Response) {
  const llamadas: Array<{ url: string; method: string; pin: string | null }> = [];
  const win = {
    location: { href: `${ORIGIN}/barber/caja`, origin: ORIGIN },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      llamadas.push({ url, method: init?.method ?? "GET", pin: new Headers(init?.headers).get(BARBER_BRANCH_PIN_HEADER) });
      return responder(url, init);
    },
  };
  return { win, llamadas };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("qué peticiones llevan la sede: solo escrituras a /api/barber del mismo origen, sin el cambio de sede ni la cuenta", () => {
  const u = (p: string, o = ORIGIN) => new URL(p, o);
  assert.equal(needsSedePin("POST", u("/api/barber/sales"), ORIGIN), true);
  assert.equal(needsSedePin("delete", u("/api/barber/clients/1"), ORIGIN), true);
  assert.equal(needsSedePin("GET", u("/api/barber/sales"), ORIGIN), false);
  assert.equal(needsSedePin("POST", u("/api/barber/branches/switch"), ORIGIN), false);
  assert.equal(needsSedePin("POST", u("/api/barber/auth/contrasena"), ORIGIN), false);
  assert.equal(needsSedePin("POST", u("/api/otra-cosa"), ORIGIN), false);
  assert.equal(needsSedePin("POST", u("/api/barber/sales", "https://otro.test"), ORIGIN), false);
});

test("una escritura sale con la sede de la pantalla; una lectura, sin ella", async () => {
  const { win, llamadas } = ventana(() => json(201, { ok: true }));
  installSedePin(win, "sede-A", "aviso");
  await win.fetch("/api/barber/clients", { method: "POST", body: "{}" });
  await win.fetch("/api/barber/clients");
  assert.deepEqual(llamadas.map((l) => [l.method, l.pin]), [["POST", "sede-A"], ["GET", null]]);
});

test("🔴 otra pestaña cambió de sede: el 401 del servidor se vuelve un 409 con el aviso", async () => {
  const { win, llamadas } = ventana((url) => (url === BARBER_SEDE_CURRENT_PATH ? json(200, { branchId: "sede-B" }) : json(401, { error: "No autorizado" })));
  installSedePin(win, "sede-A", "Cambiaste de sede en otra pestaña.");
  const res = await win.fetch("/api/barber/sales", { method: "POST", body: "{}" });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "Cambiaste de sede en otra pestaña.", code: "BRANCH_CHANGED" });
  assert.equal(llamadas[1].pin, null, "la pregunta por la sede actual va SIN encabezado");
});

test("una sesión caducada sigue siendo 401 (la sede es la misma o no hay sesión)", async () => {
  const misma = ventana((url) => (url === BARBER_SEDE_CURRENT_PATH ? json(200, { branchId: "sede-A" }) : json(401, {})));
  installSedePin(misma.win, "sede-A", "aviso");
  assert.equal((await misma.win.fetch("/api/barber/sales", { method: "POST" })).status, 401);

  const sinSesion = ventana(() => json(401, {}));
  installSedePin(sinSesion.win, "sede-A", "aviso");
  assert.equal((await sinSesion.win.fetch("/api/barber/sales", { method: "POST" })).status, 401);
});

test("instalar dos veces no envuelve dos veces: solo actualiza la sede", async () => {
  const { win, llamadas } = ventana(() => json(200, {}));
  installSedePin(win, "sede-A", "aviso");
  const envuelto = win.fetch;
  installSedePin(win, "sede-B", "aviso");
  assert.equal(win.fetch, envuelto);
  await win.fetch("/api/barber/sales", { method: "POST" });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].pin, "sede-B");
});
