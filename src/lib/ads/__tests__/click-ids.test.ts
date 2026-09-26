/**
 * Clic de Google Ads guardado en el alta (WS1-T6).
 *
 * Run: npx tsx --test src/lib/ads/__tests__/click-ids.test.ts
 * (sin script en package.json: añadirlo queda fuera del alcance de la tarea).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADS_CLICK_COOKIE,
  clickDeCookies,
  cookieParaClic,
  empaquetarClick,
  extraerClickIds,
  parsearClick,
  parsearGclAw,
} from "../click-ids";
import { NextRequest } from "next/server";
import { POST as sembrarCookie } from "@/app/api/ads/click/route";
import { esTablaInexistente, guardarClickAdsDeAlta, type FilaClick } from "../click-store-core";

const GCLID = "Cj0KCQjw_abcDEF123-xyz_9";
const GBRAID = "0AAAAAoAbCdEfGhIjKlMn";
const AHORA = Date.UTC(2026, 8, 26, 12, 0, 0);
const DIA = 24 * 60 * 60 * 1000;

// ── Captura de la URL ────────────────────────────────────────────────────────

test("extrae gclid, gbraid y wbraid de la URL, solo con forma válida", () => {
  assert.deepEqual(extraerClickIds(new URLSearchParams(`?gclid=${GCLID}&utm_source=google`)), { gclid: GCLID });
  assert.deepEqual(extraerClickIds(new URLSearchParams(`?gbraid=${GBRAID}`)), { gbraid: GBRAID });
  assert.deepEqual(extraerClickIds(new URLSearchParams(`?wbraid=${GBRAID}&gclid=${GCLID}`)), { gclid: GCLID, wbraid: GBRAID });
  assert.deepEqual(extraerClickIds(new URLSearchParams("?gclid=corto")), {});
  assert.deepEqual(extraerClickIds(new URLSearchParams("?gclid=<script>alert(1)</script>")), {});
  assert.deepEqual(extraerClickIds(new URLSearchParams(`?gclid=${"a".repeat(300)}`)), {});
  assert.deepEqual(extraerClickIds(new URLSearchParams("?gclid=abc.def.ghi.jkl.mno")), {}, "un punto rompería el formato de la cookie");
  assert.deepEqual(extraerClickIds(null), {});
  assert.deepEqual(extraerClickIds({ gclid: 42, gbraid: null }), {});
});

// ── Cookie propia ────────────────────────────────────────────────────────────

test("la cookie dc_ads da la vuelta y caduca a los 90 días", () => {
  const v = empaquetarClick({ ids: { gclid: GCLID }, at: AHORA })!;
  assert.equal(v, `v1.${GCLID}...${AHORA}`);
  assert.deepEqual(parsearClick(v, AHORA + 89 * DIA), { ids: { gclid: GCLID }, at: AHORA });
  assert.equal(parsearClick(v, AHORA + 91 * DIA), null);
  assert.equal(parsearClick(v, AHORA - 91 * DIA), null, "una fecha en el futuro es basura");
  assert.equal(parsearClick(v, AHORA - 30 * DIA), null, "más de un día en el futuro también");
  assert.ok(parsearClick(v, AHORA - 3 * 60 * 60 * 1000), "un reloj adelantado unas horas se tolera");
  const doble = empaquetarClick({ ids: { gclid: GCLID, gbraid: GBRAID }, at: AHORA })!;
  assert.deepEqual(parsearClick(doble, AHORA)?.ids, { gclid: GCLID, gbraid: GBRAID });
});

test("cookies corruptas o de otra versión: null, sin lanzar", () => {
  for (const raw of [null, undefined, "", "basura", "v2.a.b.c.1", `v1.${GCLID}.x`, "v1...."+AHORA, `v1.<b>..${AHORA}`, `v1.${GCLID}...NaN`]) {
    assert.equal(parsearClick(raw as string, AHORA), null, String(raw));
  }
  assert.equal(empaquetarClick({ ids: {}, at: AHORA }), null);
  assert.equal(empaquetarClick({ ids: { gclid: "corto" }, at: AHORA }), null);
  assert.equal(empaquetarClick({ ids: { gclid: GCLID }, at: 0 }), null);
});

test("el último clic gana; el MISMO gclid no renueva la fecha", () => {
  const primera = empaquetarClick({ ids: { gclid: GCLID }, at: AHORA })!;
  // Mismo clic otra vez (recarga, otra página): nada que escribir.
  assert.equal(cookieParaClic({ gclid: GCLID }, primera, AHORA + 3 * DIA), null);
  // Otro clic: sustituye, con la fecha nueva.
  const otro = cookieParaClic({ gclid: "OtroClic_1234567890" }, primera, AHORA + 3 * DIA)!;
  assert.deepEqual(parsearClick(otro, AHORA + 3 * DIA), { ids: { gclid: "OtroClic_1234567890" }, at: AHORA + 3 * DIA });
  // Sin cookie previa: se escribe.
  assert.ok(cookieParaClic({ gclid: GCLID }, undefined, AHORA));
  // Cookie previa vencida: se escribe de nuevo, con fecha nueva.
  const nueva = cookieParaClic({ gclid: GCLID }, primera, AHORA + 100 * DIA)!;
  assert.equal(parsearClick(nueva, AHORA + 100 * DIA)?.at, AHORA + 100 * DIA);
  // Sin ids válidos: nada.
  assert.equal(cookieParaClic({}, primera, AHORA), null);
});

// ── Respaldo _gcl_aw de Google ───────────────────────────────────────────────

test("_gcl_aw de gtag: GCL.<segundos>.<gclid>", () => {
  const seg = Math.floor(AHORA / 1000);
  assert.deepEqual(parsearGclAw(`GCL.${seg}.${GCLID}`, AHORA), { ids: { gclid: GCLID }, at: seg * 1000 });
  assert.equal(parsearGclAw(`GCL.${seg}.${GCLID}`, AHORA + 91 * DIA), null);
  assert.equal(parsearGclAw(`GCL.${seg}.${GCLID}`, AHORA - 30 * DIA), null, "clic 30 días en el futuro: reloj roto");
  assert.equal(parsearGclAw(`XXX.${seg}.${GCLID}`, AHORA), null);
  assert.equal(parsearGclAw(`GCL.${seg}.corto`, AHORA), null);
  assert.equal(parsearGclAw("GCL.abc", AHORA), null);
});

test("clickDeCookies: primero dc_ads, luego _gcl_aw; sin nada → null", () => {
  const seg = Math.floor(AHORA / 1000);
  const propia = empaquetarClick({ ids: { gbraid: GBRAID }, at: AHORA })!;
  const jar = (m: Record<string, string>) => (n: string) => m[n];
  const a = clickDeCookies(jar({ [ADS_CLICK_COOKIE]: propia, _gcl_aw: `GCL.${seg}.${GCLID}` }), AHORA)!;
  assert.equal(a.fuente, "dc_ads");
  assert.deepEqual(a.ids, { gbraid: GBRAID });
  const b = clickDeCookies(jar({ _gcl_aw: `GCL.${seg}.${GCLID}` }), AHORA)!;
  assert.equal(b.fuente, "_gcl_aw");
  assert.deepEqual(b.ids, { gclid: GCLID });
  assert.equal(clickDeCookies(jar({}), AHORA), null);
  assert.equal(clickDeCookies(() => { throw new Error("jar roto"); }, AHORA), null);
});

// ── Guardado (núcleo sin base) ───────────────────────────────────────────────

const jarCon = (ids: { gclid?: string }) => {
  const v = empaquetarClick({ ids, at: Date.now() })!;
  return (n: string) => (n === ADS_CLICK_COOKIE ? v : undefined);
};

test("guarda una fila con el clinicId de la clínica creada y los ids del clic", async () => {
  const filas: FilaClick[] = [];
  const r = await guardarClickAdsDeAlta(async (f) => { filas.push(f); }, { clinicId: "clinic_1", leerCookie: jarCon({ gclid: GCLID }) });
  assert.equal(r, "guardado");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].clinicId, "clinic_1");
  assert.equal(filas[0].gclid, GCLID);
  assert.equal(filas[0].gbraid, null);
  assert.equal(filas[0].source, "dc_ads");
  assert.ok(filas[0].clickedAt instanceof Date);
});

test("sin clic (alta orgánica) no escribe nada", async () => {
  let llamadas = 0;
  assert.equal(await guardarClickAdsDeAlta(async () => { llamadas++; }, { clinicId: "c", leerCookie: () => undefined }), "sin-clic");
  assert.equal(llamadas, 0);
});

test("sin clinicId no consulta ni escribe: corta antes (regla del tenant)", async () => {
  let llamadas = 0;
  assert.equal(await guardarClickAdsDeAlta(async () => { llamadas++; }, { clinicId: "", leerCookie: jarCon({ gclid: GCLID }) }), "error");
  assert.equal(llamadas, 0);
});

test("la tabla aún no existe (SQL sin aplicar): no lanza y devuelve sin-tabla", async () => {
  const w = console.warn; console.warn = () => {};
  try {
    const p2010 = Object.assign(new Error("Raw query failed. Code: `42P01`. Message: `relation \"clinic_ads_clicks\" does not exist`"), { code: "P2010", meta: { code: "42P01", message: 'relation "clinic_ads_clicks" does not exist' } });
    assert.equal(esTablaInexistente(p2010), true);
    assert.equal(esTablaInexistente(new Error("timeout")), false);
    const columna = Object.assign(new Error('column "gclid" of relation "clinic_ads_clicks" does not exist'), { code: "P2010", meta: { code: "42703", message: 'column "gclid" of relation "clinic_ads_clicks" does not exist' } });
    assert.equal(esTablaInexistente(columna), false, "una columna que falta no es «falta la tabla»");
    assert.equal(await guardarClickAdsDeAlta(async () => { throw p2010; }, { clinicId: "c", leerCookie: jarCon({ gclid: GCLID }) }), "sin-tabla");
    // Cualquier otro fallo también se traga: un alta nunca falla por medir.
    assert.equal(await guardarClickAdsDeAlta(async () => { throw new Error("pooler saturado"); }, { clinicId: "c", leerCookie: jarCon({ gclid: GCLID }) }), "error");
  } finally { console.warn = w; }
});

// ── Cableado y SQL (se lee el código) ───────────────────────────────────────

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const RAIZ = join(SRC, "..");

test("register y register-oauth guardan el clic DESPUÉS de crear la clínica, con su id, y sin try que lo bloquee", () => {
  const reg = leer("app/api/auth/register/route.ts");
  const iCreate = reg.indexOf("const clinic = await prisma.clinic.create(");
  const iGuardar = reg.indexOf("await guardarClickAdsDeLaAlta(clinic.id,");
  assert.ok(iCreate > 0 && iGuardar > iCreate);
  assert.ok(reg.includes("(n) => req.cookies.get(n)?.value"));
  const oa = leer("app/api/auth/register-oauth/route.ts");
  const jCreate = oa.indexOf("const clinic = await prisma.clinic.create(");
  const jGuardar = oa.indexOf("await guardarClickAdsDeLaAlta(clinic.id,");
  assert.ok(jCreate > 0 && jGuardar > jCreate);
  assert.ok(!oa.includes("clinicId: data"), "el clinicId no sale del cuerpo de la petición");
});

test("el guardado es SQL crudo sobre la tabla nueva, una fila por clínica, sin tocar clinics", () => {
  const store = leer("lib/ads/click-store.ts");
  assert.match(store, /INSERT INTO "clinic_ads_clicks"/);
  assert.match(store, /ON CONFLICT \("clinicId"\) DO NOTHING/);
  assert.ok(!/clinic\.update|"clinics"/.test(store));
});

test("el SQL es plano e idempotente: tabla nueva, sin DO $$, sin DROP, sin tocar clinics", () => {
  const sql = readFileSync(join(RAIZ, "sql", "ws1-t6-ads-clics.sql"), "utf8");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(codigo, /CREATE TABLE IF NOT EXISTS "clinic_ads_clicks"/);
  assert.match(codigo, /CREATE INDEX IF NOT EXISTS/);
  assert.match(codigo, /"clinicId"\s+text\s+PRIMARY KEY REFERENCES "clinics" \("id"\) ON DELETE CASCADE/);
  assert.match(codigo, /ENABLE ROW LEVEL SECURITY/);
  assert.ok(!/DO\s+\$\$/i.test(codigo));
  assert.ok(!/\bDROP\b/i.test(codigo));
  assert.ok(!/ALTER TABLE "clinics"/i.test(codigo));
});

test("la captura solo corre en rutas públicas y el endpoint solo siembra la cookie (sin base)", () => {
  const cap = leer("components/analytics/ads-click-capture.tsx");
  assert.ok(cap.startsWith('"use client";'));
  assert.match(cap, /isPrivatePath\(pathname\)/);
  const ruta = leer("app/api/ads/click/route.ts");
  assert.ok(!/prisma/.test(ruta));
  assert.match(ruta, /httpOnly: true/);
  assert.match(ruta, /maxAge: ADS_CLICK_COOKIE_MAX_AGE/);
  assert.match(leer("app/layout.tsx"), /<AdsClickCapture \/>/);
});

// ── El endpoint, llamado de verdad ───────────────────────────────────────────

const pedir = (cuerpo: string, cookie?: string) =>
  sembrarCookie(new NextRequest("http://localhost/api/ads/click", { method: "POST", body: cuerpo, headers: cookie ? { cookie } : {} }));

test("POST /api/ads/click: siembra dc_ads httpOnly de 90 días con el gclid válido", async () => {
  const res = await pedir(JSON.stringify({ gclid: GCLID }));
  assert.equal(res.status, 204);
  const c = res.cookies.get(ADS_CLICK_COOKIE)!;
  assert.equal(parsearClick(c.value)?.ids.gclid, GCLID);
  assert.equal(c.httpOnly, true);
  assert.equal(c.maxAge, 90 * 24 * 60 * 60);
  assert.equal(c.path, "/");
  assert.equal(c.sameSite, "lax");
});

test("POST /api/ads/click: basura, cuerpo enorme o el mismo gclid → 204 sin cookie", async () => {
  assert.equal((await pedir("no es json")).cookies.get(ADS_CLICK_COOKIE), undefined);
  assert.equal((await pedir(JSON.stringify({ gclid: "<x>" }))).cookies.get(ADS_CLICK_COOKIE), undefined);
  assert.equal((await pedir(JSON.stringify({ gclid: GCLID, relleno: "x".repeat(3000) }))).status, 204);
  assert.equal((await pedir(JSON.stringify({ gclid: GCLID, relleno: "x".repeat(3000) }))).cookies.get(ADS_CLICK_COOKIE), undefined);
  const vigente = empaquetarClick({ ids: { gclid: GCLID }, at: Date.now() })!;
  const misma = await pedir(JSON.stringify({ gclid: GCLID }), `${ADS_CLICK_COOKIE}=${vigente}`);
  assert.equal(misma.status, 204);
  assert.equal(misma.cookies.get(ADS_CLICK_COOKIE), undefined, "el mismo clic no renueva la cookie");
});
