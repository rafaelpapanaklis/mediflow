/**
 * ws1-t11 · lead 15 (auditoría run-2) — conectar, cambiar o desconectar el
 * WhatsApp Cloud de la clínica pide «Editar configuración» (settings.edit),
 * con el override por persona, igual que PATCH /api/settings y la conexión de
 * Mercado Pago.
 *
 * Run: npm run test:whatsapp-connect-permiso
 *
 * El hallazgo: POST/DELETE /api/whatsapp/connect y POST
 * /api/whatsapp/embedded/exchange solo pedían requireAdmin (el ROL), así que un
 * ADMIN al que el dueño le apagó «Editar configuración» podía poner el número
 * y el token de una cuenta suya (los recordatorios a pacientes salían por ahí)
 * o desconectar el WhatsApp de la clínica.
 *
 * Route handlers REALES; sesión, Prisma, cifrado y Meta (fetch) de mentira.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let ctx: any;
const escrituras: any[] = [];

mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ctx,
    // Copia literal de requireAdmin (src/lib/auth-context.ts): solo el rol.
    requireAdmin: (c: any) =>
      !c ? NextResponse.json({ error: "No autenticado" }, { status: 401 })
        : !c.isAdmin ? NextResponse.json({ error: "Solo administradores" }, { status: 403 }) : null,
  },
});
mock.module("@/lib/prisma", {
  namedExports: { prisma: { clinic: { update: async (a: any) => { escrituras.push(a); return {}; } } } },
});
mock.module("@/lib/crypto/envelope", { namedExports: { encryptField: (s: string) => `cifrado:${s}` } });
mock.module("@/lib/whatsapp/provision-templates", { namedExports: { provisionClinicTemplates: async () => {} } });

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  if (String(url).startsWith("https://graph.facebook.com/")) {
    return new Response(JSON.stringify({ display_phone_number: "+52 55 0000 0000", access_token: "tok", id: "x" }), { status: 200 });
  }
  return fetchReal(url as any);
}) as typeof fetch;
process.env.META_APP_ID = "app_de_prueba";
process.env.META_APP_SECRET = "secreto_de_prueba";

function como(role: string, permissionsOverride: string[] = []) {
  ctx = {
    userId: "u1", clinicId: "cli_a", role, permissionsOverride,
    isAdmin: role === "ADMIN" || role === "SUPER_ADMIN", isSuperAdmin: role === "SUPER_ADMIN",
  };
}
const SIN_CONFIG = ["today.view", "agenda.view", "patients.view"]; // el dueño le apagó «Editar configuración»

beforeEach(() => { escrituras.length = 0; });

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });

const connect = async () => import("../route");
const exchange = async () => import("../../embedded/exchange/route");

test("ADMIN sin «Editar configuración»: POST /api/whatsapp/connect → 403 y no toca las credenciales", async () => {
  como("ADMIN", SIN_CONFIG);
  const r = await (await connect()).POST(req("http://x/api/whatsapp/connect", "POST", { phoneNumberId: "111", accessToken: "token-del-atacante", wabaId: "w1" }));
  assert.equal(r.status, 403);
  assert.equal(escrituras.length, 0, "guardó el número y el token de otra cuenta");
});

test("ADMIN sin «Editar configuración»: DELETE /api/whatsapp/connect → 403 y no desconecta", async () => {
  como("ADMIN", SIN_CONFIG);
  const r = await (await connect()).DELETE(req("http://x/api/whatsapp/connect", "DELETE"));
  assert.equal(r.status, 403);
  assert.equal(escrituras.length, 0);
});

test("ADMIN sin «Editar configuración»: POST /api/whatsapp/embedded/exchange → 403 y no guarda nada", async () => {
  como("ADMIN", SIN_CONFIG);
  const r = await (await exchange()).POST(req("http://x/api/whatsapp/embedded/exchange", "POST", { code: "codigo-12345", wabaId: "w1", phoneNumberId: "111" }));
  assert.equal(r.status, 403);
  assert.equal(escrituras.length, 0);
});

test("ADMIN con su default (sin override) conecta y desconecta como siempre", async () => {
  como("ADMIN");
  const r = await (await connect()).POST(req("http://x/api/whatsapp/connect", "POST", { phoneNumberId: "111", accessToken: "tok" }));
  assert.equal(r.status, 200);
  const d = await (await connect()).DELETE(req("http://x/api/whatsapp/connect", "DELETE"));
  assert.equal(d.status, 200);
  assert.equal(escrituras.length, 2);
});

test("el dueño (SUPER_ADMIN) conecta como siempre", async () => {
  como("SUPER_ADMIN");
  const r = await (await connect()).POST(req("http://x/api/whatsapp/connect", "POST", { phoneNumberId: "111", accessToken: "tok" }));
  assert.equal(r.status, 200);
});

test("un DOCTOR sigue fuera (el arreglo solo estrecha, no abre a nadie nuevo)", async () => {
  como("DOCTOR", ["settings.edit"]);
  const r = await (await connect()).POST(req("http://x/api/whatsapp/connect", "POST", { phoneNumberId: "111", accessToken: "tok" }));
  assert.equal(r.status, 403);
  assert.equal(escrituras.length, 0);
});
