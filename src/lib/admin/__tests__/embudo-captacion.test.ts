/** Tarjeta de embudo de /admin (ws1-t9). Run: npm run test:embudo-admin. Base falsa. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  armarEmbudo, leerConteosEmbudo, sinEventosPropios, ORDEN_PASOS,
  fuenteDeSesion, fuenteDeClinica, armarPorFuente, leerEmbudoPorFuente,
} from "../embudo-captacion";

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

test("fuente de la sesión: utm_source manda, luego gclid, luego referente, luego directo", () => {
  assert.equal(fuenteDeSesion({ utmSource: " ChatGPT ", gclid: "g" }), "chatgpt");
  assert.equal(fuenteDeSesion({ gclid: "g1", referrerHost: "google.com" }), "google-ads");
  assert.equal(fuenteDeSesion({ referrerHost: "www.Bing.com" }), "bing.com");
  assert.equal(fuenteDeSesion({}), "directo");
});

test("fuente de la clínica: primer UTM, si no la plataforma, si no «sin dato»", () => {
  assert.equal(fuenteDeClinica({ utmSourceFirst: "TikTok", platform: "meta" }), "tiktok");
  assert.equal(fuenteDeClinica({ platform: "google" }), "google-ads");
  assert.equal(fuenteDeClinica({ platform: "meta" }), "meta");
  assert.equal(fuenteDeClinica({}), "sin dato");
});

test("por fuente: une pasos, ordena, % de pago y agrupa el resto en «otras»", () => {
  const f = armarPorFuente({
    landing_vista: { chatgpt: 100, directo: 50, a: 1, b: 1 },
    registro_ok: { chatgpt: 10, "sin dato": 4, a: 1 },
    pago_ok: { chatgpt: 2 },
  }, 3);
  assert.deepEqual(f.map((x) => x.fuente), ["chatgpt", "sin dato", "a", "otras"]);
  assert.equal(f[0].pctPago, 20);
  assert.equal(f[1].pctPago, 0);
  assert.equal(f[3].pasos.landing_vista, 51);
});

test("por fuente: sin las columnas de origen no se nombran y todo cae en «sin dato»", async () => {
  const sqls: string[] = [];
  const db = {
    $queryRaw: async (q: TemplateStringsArray) => {
      const t = q.join("?");
      sqls.push(t);
      if (t.includes("information_schema")) return [{ n: 0n }];
      if (t.includes("FROM clinics")) return [{ utmSourceFirst: null, platform: null, n: 3n }];
      return [{ utmSource: "chatgpt", gclid: null, referrerHost: null, n: 5n }];
    },
  };
  const r = await leerEmbudoPorFuente(db as any);
  assert.equal(r.origenClinica, false);
  assert.ok(!sqls.some((t) => t.includes("clinic_ads_clicks") && !t.includes("information_schema")));
  assert.equal(r.filas.find((x) => x.fuente === "sin dato")?.pasos.registro_ok, 3);
  assert.equal(r.filas.find((x) => x.fuente === "chatgpt")?.pasos.landing_vista, 5);
});

test("por fuente: una lectura que falla no tumba la tarjeta", async () => {
  const db = { $queryRaw: async () => { throw new Error("boom"); } };
  const r = await leerEmbudoPorFuente(db as any);
  assert.deepEqual(r.filas, []);
});

test("el cableado: registro, checkout y pago llaman a registrarPaso", () => {
  const leer = (p: string) => readFileSync(p, "utf8");
  const signup = leer("src/components/public/auth/signup/signup-form.tsx");
  for (const paso of ["registro_vista", "registro_enviado", "registro_ok"]) assert.match(signup, new RegExp(paso));
  assert.match(leer("src/app/dashboard/suspended/suspended-client.tsx"), /registrarPaso\("checkout_iniciado"/);
  assert.match(leer("src/app/dashboard/suspended/success/medicion-pago.ts"), /registrarPaso\("pago_ok"/);
  assert.match(leer("src/components/analytics/embudo-vistas.tsx"), /landing_vista/);
});
