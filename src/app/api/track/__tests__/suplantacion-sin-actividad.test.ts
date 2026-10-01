/**
 * M5, añadido de Rafael (1-oct): «Ver como clínica» NO cuenta como actividad de la clínica.
 *
 * Run: npm run test:suplantacion-sin-actividad
 *
 * POST /api/track es lo que alimenta analytics_sessions/analytics_events, de donde
 * salen «último acceso», «en vivo», usuarios activos y la salud/uso de /admin. Con
 * una sesión de suplantación activa no debe tocar la base; sin ella, sí (testigo).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let suplantando = false;
const llamadas: string[] = [];

// Cualquier método de cualquier modelo de prismaAdmin queda anotado.
const prismaAdminFalso = new Proxy({}, {
  get: (_t, modelo: string) => new Proxy({}, {
    get: (_u, metodo: string) => async () => { llamadas.push(`${modelo}.${metodo}`); return metodo === "findUnique" ? null : { count: 0 }; },
  }),
});

mock.module("@/lib/prisma-admin", { namedExports: { prismaAdmin: prismaAdminFalso } });
mock.module("@/lib/admin/suplantacion", {
  namedExports: {
    suplantacionDeEstaPeticion: async () =>
      suplantando ? { id: "i1", adminUserId: "adm", adminEmail: "a@d.com", clinicId: "c1", targetUserId: "u", expiresAt: new Date(Date.now() + 1e6), endedAt: null } : null,
  },
});
mock.module("@/lib/analytics/identity", {
  namedExports: { resolveIdentity: async () => ({ identityType: "clinic", userId: "u", clinicId: "c1", supabaseId: "sb" }) },
});
mock.module("@/lib/analytics/geo", { namedExports: { resolveGeo: async () => ({}) } });

const ruta = () => import("../route");

function pedir() {
  const body = {
    sid: "s_123456789012", vid: "v_123456789012",
    events: [{ type: "pageview", path: "/dashboard/agenda", ts: Date.now() }],
  };
  return new NextRequest("http://dev.local/api/track", {
    method: "POST", body: JSON.stringify(body),
    headers: { host: "dev.local", origin: "http://dev.local", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36" },
  });
}

beforeEach(() => { llamadas.length = 0; });

test("sin suplantación, la visita al panel SÍ se registra (testigo)", async () => {
  suplantando = false;
  const r = await (await ruta()).POST(pedir());
  assert.equal(r.status, 204);
  assert.ok(llamadas.length > 0, "debía tocar analytics_sessions/eventos");
});

test("con «Ver como clínica», la visita NO toca la base: ni sesión, ni evento, ni último acceso", async () => {
  suplantando = true;
  const r = await (await ruta()).POST(pedir());
  assert.equal(r.status, 204);
  assert.deepEqual(llamadas, []);
});
