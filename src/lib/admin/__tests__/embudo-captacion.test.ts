/** Tarjeta de embudo de /admin (ws1-t9). Run: npm run test:embudo-admin. Base falsa. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarEmbudo, leerConteosEmbudo, sinEventosPropios, ORDEN_PASOS } from "../embudo-captacion";

test("porcentajes contra el paso anterior y contra el inicio", () => {
  const f = armarEmbudo({
    landing_vista: 1000, clic_empezar: 200, registro_vista: 100, registro_enviado: 40,
    registro_ok: 30, onboarding_completo: 15, checkout_iniciado: 6, pago_ok: 3,
  });
  assert.equal(f.length, ORDEN_PASOS.length);
  assert.equal(f[0].pctAnterior, null);
  assert.equal(f[1].pctAnterior, 20);
  assert.equal(f[4].pctAnterior, 75);
  assert.equal(f[7].pctAnterior, 50);
  assert.equal(f[7].pctInicio, 0.3);
});

test("un paso sin lectura (null) no rompe ni inventa porcentaje", () => {
  const f = armarEmbudo({ landing_vista: 50, clic_empezar: null, registro_vista: 10 });
  assert.equal(f[1].total, null);
  assert.equal(f[1].pctAnterior, null);
  assert.equal(f[2].pctAnterior, 20); // contra el último con dato
});

test("división entre cero → sin porcentaje", () => {
  const f = armarEmbudo({ landing_vista: 0, clic_empezar: 0 });
  assert.equal(f[1].pctAnterior, null);
});

test("lee los conteos; una consulta que falla deja null y las demás siguen", async () => {
  let i = 0;
  const db = {
    $queryRaw: async () => {
      i++;
      if (i === 2) throw new Error("boom");
      return [{ n: BigInt(i * 10) }];
    },
  };
  const c = await leerConteosEmbudo(db as any, new Date("2026-10-11T12:00:00Z"));
  assert.equal(c.clic_empezar, null);
  assert.equal(typeof c.landing_vista, "number");
  assert.equal(typeof c.pago_ok, "number");
});

test("sin eventos propios se avisa", () => {
  assert.equal(sinEventosPropios({ clic_empezar: 0, registro_enviado: 0 }), true);
  assert.equal(sinEventosPropios({ clic_empezar: 3 }), false);
});

test("cableado: /admin pinta la tarjeta y cada consulta de clínicas filtra por la ventana", () => {
  const page = readFileSync("src/app/admin/page.tsx", "utf8");
  assert.match(page, /<TarjetaEmbudo \/>/);
  const lib = readFileSync("src/lib/admin/embudo-captacion.ts", "utf8");
  assert.equal((lib.match(/"createdAt" >= \$\{desde\}/g) ?? []).length >= 6, true);
});
