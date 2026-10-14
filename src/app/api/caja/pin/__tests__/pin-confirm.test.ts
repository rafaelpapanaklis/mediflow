/**
 * /api/caja/pin (ws1-t1): el PIN nuevo se escribe DOS veces y el servidor no
 * se fía de la pantalla; cambiar un PIN existente exige el actual.
 *
 * `npm run test:caja-pin-equipo`
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { hashCajaPin, verifyCajaPin } from "@/lib/caja-pin";

const estado = {
  usuario: { cajaPinHash: null as string | null },
  updates: [] as any[],
  sesion: null as any,
};

let POST: (body: unknown) => Promise<Response>;
let hashActual: string;

before(async () => {
  hashActual = await hashCajaPin("111111");
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          findUnique: async () => ({ cajaPinHash: estado.usuario.cajaPinHash }),
          update: async ({ where, data }: any) => { estado.updates.push({ where, data }); estado.usuario.cajaPinHash = data.cajaPinHash; return {}; },
        },
      },
    },
  });
  mock.module("@/lib/auth-context", { namedExports: { getAuthContext: async () => estado.sesion } });
  const { NextRequest } = await import("next/server");
  const ruta = await import("@/app/api/caja/pin/route");
  POST = (body) =>
    ruta.POST(new NextRequest("http://app.test/api/caja/pin", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
});

beforeEach(() => {
  estado.usuario.cajaPinHash = null;
  estado.updates = [];
  estado.sesion = { userId: "u1", clinicId: "c1", user: { role: "DOCTOR", canAccessCaja: true } };
});

test("primera vez: pin y pinConfirm idénticos → se guarda", async () => {
  const r = await POST({ action: "set", pin: "482913", pinConfirm: "482913" });
  assert.equal(r.status, 200);
  assert.equal(estado.updates.length, 1);
  assert.equal(await verifyCajaPin("482913", estado.usuario.cajaPinHash), true);
});

test("pinConfirm distinto → 400 y NO se guarda nada", async () => {
  const r = await POST({ action: "set", pin: "482913", pinConfirm: "482914" });
  assert.equal(r.status, 400);
  const cuerpo = await r.json();
  assert.equal(cuerpo.code, "CAJA_PIN_NO_COINCIDE");
  assert.match(cuerpo.error, /no coinciden/i);
  assert.equal(estado.updates.length, 0);
  assert.equal(estado.usuario.cajaPinHash, null);
});

test("pinConfirm vacío o null cuenta como distinto", async () => {
  for (const pinConfirm of ["", null, "12345"]) {
    const r = await POST({ action: "set", pin: "482913", pinConfirm });
    assert.equal(r.status, 400, `pinConfirm=${JSON.stringify(pinConfirm)}`);
  }
  assert.equal(estado.updates.length, 0);
});

test("un PIN que no son 6 dígitos sigue siendo 400", async () => {
  for (const pin of ["12345", "1234567", "abcdef", ""]) {
    const r = await POST({ action: "set", pin, pinConfirm: pin });
    assert.equal(r.status, 400, `pin=${JSON.stringify(pin)}`);
  }
  assert.equal(estado.updates.length, 0);
});

test("cambiar un PIN que ya existe exige currentPin: sin él → 403", async () => {
  estado.usuario.cajaPinHash = hashActual;
  const r = await POST({ action: "set", pin: "482913", pinConfirm: "482913" });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "CAJA_PIN_INVALID");
  assert.equal(estado.updates.length, 0);
});

test("currentPin incorrecto → 403 y el PIN no cambia", async () => {
  estado.usuario.cajaPinHash = hashActual;
  const r = await POST({ action: "set", pin: "482913", pinConfirm: "482913", currentPin: "999999" });
  assert.equal(r.status, 403);
  assert.equal(await verifyCajaPin("111111", estado.usuario.cajaPinHash), true);
});

test("currentPin correcto y nuevo idéntico dos veces → cambia", async () => {
  estado.usuario.cajaPinHash = hashActual;
  const r = await POST({ action: "set", pin: "482913", pinConfirm: "482913", currentPin: "111111" });
  assert.equal(r.status, 200);
  assert.equal(await verifyCajaPin("482913", estado.usuario.cajaPinHash), true);
  assert.equal(await verifyCajaPin("111111", estado.usuario.cajaPinHash), false);
});

test("currentPin correcto pero el nuevo NO coincide → 400, el actual sigue valiendo", async () => {
  estado.usuario.cajaPinHash = hashActual;
  const r = await POST({ action: "set", pin: "482913", pinConfirm: "482910", currentPin: "111111" });
  assert.equal(r.status, 400);
  assert.equal(estado.updates.length, 0);
  assert.equal(await verifyCajaPin("111111", estado.usuario.cajaPinHash), true);
});

test("tras un restablecimiento (hash null) vuelve a ser «primera vez»: no pide currentPin", async () => {
  estado.usuario.cajaPinHash = null;
  const r = await POST({ action: "set", pin: "333444", pinConfirm: "333444" });
  assert.equal(r.status, 200);
});

test("sin permiso de Caja → 403 antes de mirar nada", async () => {
  estado.sesion = { userId: "u1", clinicId: "c1", user: { role: "RECEPTIONIST", canAccessCaja: false } };
  const r = await POST({ action: "set", pin: "482913", pinConfirm: "482913" });
  assert.equal(r.status, 403);
  assert.equal(estado.updates.length, 0);
});
