/**
 * ws1-t12 · La cookie de clínica activa desfasada se reescribe sola.
 *
 * Run: npm run test:conexiones-base
 *
 * resembrarActiveClinicCookie escribe la cookie firmada (la misma que
 * writeActiveClinicCookie) cuando Next lo permite (route handler, server action)
 * y no rompe nada donde no (server component: `cookies().set` lanza).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let puedeEscribir = true;
const escritas: Array<{ nombre: string; valor: string; opciones: any }> = [];

mock.module("next/headers", {
  namedExports: {
    cookies: () => ({
      get: () => undefined,
      set: (nombre: string, valor: string, opciones: any) => {
        if (!puedeEscribir) throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
        escritas.push({ nombre, valor, opciones });
      },
    }),
  },
});

const m = () => import("@/lib/active-clinic");
const core = () => import("@/lib/active-clinic-core");

test("en un route handler la escribe firmada, httpOnly, para todo el sitio y por un año", async () => {
  puedeEscribir = true;
  escritas.length = 0;
  const { resembrarActiveClinicCookie, ACTIVE_CLINIC_COOKIE } = await m();
  const { unpackClinicCookie } = await core();
  assert.equal(resembrarActiveClinicCookie("cli_a"), true);
  assert.equal(escritas.length, 1);
  assert.equal(escritas[0].nombre, ACTIVE_CLINIC_COOKIE);
  assert.equal(unpackClinicCookie(escritas[0].valor), "cli_a", "la firma vale");
  assert.equal(escritas[0].opciones.httpOnly, true);
  assert.equal(escritas[0].opciones.path, "/");
  assert.equal(escritas[0].opciones.sameSite, "lax");
  assert.equal(escritas[0].opciones.maxAge, 60 * 60 * 24 * 365);
});

test("en un server component (no se puede escribir) devuelve false y no lanza", async () => {
  puedeEscribir = false;
  escritas.length = 0;
  const { resembrarActiveClinicCookie } = await m();
  assert.equal(resembrarActiveClinicCookie("cli_a"), false);
  assert.equal(escritas.length, 0);
});
