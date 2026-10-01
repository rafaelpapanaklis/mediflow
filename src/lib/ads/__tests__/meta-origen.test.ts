/**
 * Clic de Meta (fbclid), UTM del primer/último toque y origen de la clínica (WS1-T10).
 *
 * Run: npm run test:meta-origen
 * Sin Meta, sin Stripe y sin base: todo con cookies, jars y bases falsas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { POST as sembrar } from "@/app/api/ads/click/route";
import { ADS_CLICK_COOKIE, empaquetarClick } from "../click-ids";
import {
  META_CLICK_COOKIE,
  armarFbc,
  cookieParaMeta,
  empaquetarMeta,
  extraerFbclid,
  fbcDeCookies,
  fbpDeCookies,
  metaClickDeCookies,
  parsearFbc,
  parsearMeta,
} from "../meta-click";
import {
  UTM_PRIMERO_COOKIE,
  UTM_ULTIMO_COOKIE,
  cookiesParaUtm,
  empaquetarUtm,
  extraerUtm,
  parsearUtm,
  utmDeCookies,
} from "../utm";
import { armarFilasClick, esColumnaInexistente, guardarClickAdsDeAlta, type FilaClick, type ModoInsert } from "../click-store-core";
import { dtoDeOrigen, mismoUtm, origenDeClinica, resumenUtm } from "../origen";
import { cargarOrigen, cargarOrigenes, leerFilasOrigen } from "@/lib/admin/origen-clinica";

const FBCLID = "IwAR2a_b-cD3fGh1Jk4LmN5oPq6RsTuVwXyZ0123456789abcdef";
const GCLID = "Cj0KCQjw_abcDEF123-xyz_9";
const AHORA = Date.UTC(2026, 9, 1, 12, 0, 0);
const DIA = 24 * 60 * 60 * 1000;
const FBP = "fb.1.1759300000000.1234567890";

const jar = (m: Record<string, string>) => (n: string) => m[n];

// ── fbclid y fbc ─────────────────────────────────────────────────────────────

test("extrae el fbclid de la URL solo con forma válida", () => {
  assert.equal(extraerFbclid(new URLSearchParams(`?fbclid=${FBCLID}&utm_source=meta`)), FBCLID);
  assert.equal(extraerFbclid(new URLSearchParams("?fbclid=corto")), undefined);
  assert.equal(extraerFbclid(new URLSearchParams("?fbclid=<script>alert(1)</script>")), undefined);
  assert.equal(extraerFbclid(new URLSearchParams(`?fbclid=${"a".repeat(600)}`)), undefined);
  assert.equal(extraerFbclid({ fbclid: 42 }), undefined);
  assert.equal(extraerFbclid(null), undefined);
});

test("el fbc tiene el formato de Meta fb.1.<ms>.<fbclid> y respeta mayúsculas", () => {
  assert.equal(armarFbc({ fbclid: FBCLID, at: AHORA }), `fb.1.${AHORA}.${FBCLID}`);
});

test("la cookie dc_meta da la vuelta, caduca a los 90 días y rechaza basura", () => {
  const v = empaquetarMeta({ fbclid: FBCLID, at: AHORA })!;
  assert.deepEqual(parsearMeta(v, AHORA + DIA), { fbclid: FBCLID, at: AHORA });
  assert.equal(parsearMeta(v, AHORA + 91 * DIA), null);
  assert.equal(parsearMeta(v, AHORA - 3 * DIA), null, "fecha en el futuro lejano");
  for (const raro of [null, undefined, "", "v2.1.abc", "v1.abc.xxxxxxxxxxxx", `v1.${AHORA}.<x>`, "v1.", "..."]) {
    assert.equal(parsearMeta(raro as string, AHORA), null);
  }
  assert.equal(empaquetarMeta({ fbclid: "<x>", at: AHORA }), null);
  assert.equal(empaquetarMeta({ fbclid: FBCLID, at: 0 }), null);
});

test("un fbclid con puntos sobrevive a la cookie", () => {
  const raro = "AbCdEfGhIj.KlMnOpQrSt_uv-w";
  assert.equal(parsearMeta(empaquetarMeta({ fbclid: raro, at: AHORA })!, AHORA)?.fbclid, raro);
});

test("_fbc del píxel: se parsea y sirve de respaldo", () => {
  const fbc = `fb.1.${AHORA - DIA}.${FBCLID}`;
  assert.deepEqual(parsearFbc(fbc, AHORA), { fbclid: FBCLID, at: AHORA - DIA });
  assert.equal(parsearFbc("fb.1.abc.def", AHORA), null);
  const r = metaClickDeCookies(jar({ _fbc: fbc }), AHORA)!;
  assert.equal(r.fuente, "_fbc");
  assert.equal(fbcDeCookies(jar({ _fbc: fbc }), AHORA), fbc, "se devuelve tal cual la del píxel");
});

test("dc_meta manda sobre _fbc, y fbcDeCookies la arma con el formato de Meta", () => {
  const propia = empaquetarMeta({ fbclid: FBCLID, at: AHORA - 2 * DIA })!;
  const otro = "OtroFbclid_1234567890abc";
  const r = metaClickDeCookies(jar({ dc_meta: propia, _fbc: `fb.1.${AHORA}.${otro}` }), AHORA)!;
  assert.equal(r.fuente, "dc_meta");
  assert.equal(r.fbclid, FBCLID);
  assert.equal(fbcDeCookies(jar({ dc_meta: propia }), AHORA), `fb.1.${AHORA - 2 * DIA}.${FBCLID}`);
  assert.equal(fbcDeCookies(jar({}), AHORA), null);
  assert.equal(fbcDeCookies(() => { throw new Error("jar roto"); }, AHORA), null);
});

test("fbpDeCookies valida el formato de _fbp", () => {
  assert.equal(fbpDeCookies(jar({ _fbp: FBP })), FBP);
  assert.equal(fbpDeCookies(jar({ _fbp: "cualquier cosa" })), null);
  assert.equal(fbpDeCookies(jar({})), null);
});

test("el último fbclid gana; el MISMO no renueva la fecha", () => {
  const v1 = cookieParaMeta(FBCLID, null, AHORA)!;
  assert.equal(parsearMeta(v1, AHORA)?.fbclid, FBCLID);
  assert.equal(cookieParaMeta(FBCLID, v1, AHORA + DIA), null);
  const otro = "OtroFbclid_1234567890abc";
  assert.equal(parsearMeta(cookieParaMeta(otro, v1, AHORA + DIA)!, AHORA + DIA)?.fbclid, otro);
  assert.equal(cookieParaMeta(undefined, v1, AHORA), null);
});

// ── UTM ──────────────────────────────────────────────────────────────────────

const UTM = { source: "meta", medium: "paid_social", campaign: "prueba-6-angulos", content: "a1-oferta" };

test("extrae los cuatro UTM, limpia y acota", () => {
  assert.deepEqual(
    extraerUtm(new URLSearchParams("?utm_source=meta&utm_medium=paid_social&utm_campaign=prueba-6-angulos&utm_content=a1-oferta&utm_term=ignorado")),
    UTM,
  );
  assert.deepEqual(extraerUtm(new URLSearchParams("?utm_source=%20%20&utm_medium=")), {});
  assert.equal(extraerUtm(new URLSearchParams(`?utm_source=${"x".repeat(500)}`)).source?.length, 120);
  assert.deepEqual(extraerUtm({ utm_source: "a\u0000b\nc", utm_medium: 7 }), { source: "abc" });
  assert.deepEqual(extraerUtm(null), {});
});

test("la cookie de UTM da la vuelta (con acentos, espacios y símbolos) y caduca a los 90 días", () => {
  const u = { source: "news letter", campaign: "campaña=1&2;3", content: "ñandú" };
  const v = empaquetarUtm({ utm: u, at: AHORA })!;
  assert.ok(!/[;,\s"\\]/.test(v), "sin caracteres que rompan la cabecera Cookie");
  assert.deepEqual(parsearUtm(v, AHORA), { utm: u, at: AHORA });
  assert.equal(parsearUtm(v, AHORA + 91 * DIA), null);
  assert.equal(empaquetarUtm({ utm: {}, at: AHORA }), null);
  for (const raro of [null, "", "v=2&t=1", "basura", `v=1&t=${AHORA}`]) assert.equal(parsearUtm(raro as string, AHORA), null);
});

test("primer toque no se pisa; último toque se reemplaza solo si cambia", () => {
  const a = cookiesParaUtm(UTM, {}, AHORA);
  assert.ok(a.primero && a.ultimo);
  const segundo = { ...UTM, content: "a2-precio" };
  const b = cookiesParaUtm(segundo, { primero: a.primero, ultimo: a.ultimo }, AHORA + DIA);
  assert.equal(b.primero, null, "el primero ya existe");
  assert.equal(parsearUtm(b.ultimo, AHORA + DIA)?.utm.content, "a2-precio");
  const c = cookiesParaUtm(UTM, { primero: a.primero, ultimo: a.ultimo }, AHORA + DIA);
  assert.deepEqual(c, { primero: null, ultimo: null }, "los mismos UTM no renuevan nada");
  assert.deepEqual(cookiesParaUtm({}, {}, AHORA), { primero: null, ultimo: null });
});

test("utmDeCookies: si solo hay una cookie, es primer y último a la vez", () => {
  const v = empaquetarUtm({ utm: UTM, at: AHORA })!;
  const r = utmDeCookies(jar({ [UTM_ULTIMO_COOKIE]: v }), AHORA);
  assert.deepEqual(r.primero?.utm, UTM);
  assert.deepEqual(r.ultimo?.utm, UTM);
  assert.deepEqual(utmDeCookies(jar({}), AHORA), { primero: null, ultimo: null });
});

// ── El endpoint ──────────────────────────────────────────────────────────────

const pedir = (cuerpo: object | string, cookie?: string) =>
  sembrar(new NextRequest("http://localhost/api/ads/click", {
    method: "POST",
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    headers: cookie ? { cookie } : {},
  }));

test("POST /api/ads/click siembra dc_meta y los dos UTM, httpOnly de 90 días", async () => {
  const res = await pedir({ fbclid: FBCLID, utm_source: "meta", utm_medium: "paid_social", utm_campaign: "prueba-6-angulos", utm_content: "a1-oferta" });
  assert.equal(res.status, 204);
  for (const nombre of [META_CLICK_COOKIE, UTM_PRIMERO_COOKIE, UTM_ULTIMO_COOKIE]) {
    const c = res.cookies.get(nombre)!;
    assert.ok(c, nombre);
    assert.equal(c.httpOnly, true, nombre);
    assert.equal(c.maxAge, 90 * DIA / 1000, nombre);
    assert.equal(c.path, "/");
    assert.equal(c.sameSite, "lax");
  }
  assert.equal(parsearMeta(res.cookies.get(META_CLICK_COOKIE)!.value)?.fbclid, FBCLID);
  assert.deepEqual(parsearUtm(res.cookies.get(UTM_PRIMERO_COOKIE)!.value)?.utm, UTM);
  assert.equal(res.cookies.get(ADS_CLICK_COOKIE), undefined, "sin gclid no hay dc_ads");
});

test("POST /api/ads/click: la cookie leída de vuelta por una petición normal conserva los UTM", async () => {
  const res = await pedir({ utm_source: "meta", utm_campaign: "prueba" });
  const v = res.cookies.get(UTM_ULTIMO_COOKIE)!.value;
  const req = new NextRequest("http://localhost/x", { headers: { cookie: `${UTM_ULTIMO_COOKIE}=${encodeURIComponent(v)}` } });
  assert.deepEqual(parsearUtm(req.cookies.get(UTM_ULTIMO_COOKIE)?.value)?.utm, { source: "meta", campaign: "prueba" });
});

test("POST /api/ads/click: lo de Google sigue igual (gclid solo → solo dc_ads)", async () => {
  const res = await pedir({ gclid: GCLID });
  assert.ok(res.cookies.get(ADS_CLICK_COOKIE));
  assert.equal(res.cookies.get(META_CLICK_COOKIE), undefined);
  assert.equal(res.cookies.get(UTM_PRIMERO_COOKIE), undefined);
  assert.equal(res.cookies.get(UTM_ULTIMO_COOKIE), undefined);
});

test("POST /api/ads/click: Google + Meta + UTM en la misma llamada siembran las cuatro", async () => {
  const res = await pedir({ gclid: GCLID, fbclid: FBCLID, utm_source: "google" });
  assert.ok(res.cookies.get(ADS_CLICK_COOKIE) && res.cookies.get(META_CLICK_COOKIE) && res.cookies.get(UTM_ULTIMO_COOKIE));
});

test("POST /api/ads/click: basura → 204 sin cookies; el mismo fbclid y los mismos UTM no renuevan", async () => {
  const basura = await pedir({ fbclid: "<x>", utm_source: "   " });
  assert.equal(basura.status, 204);
  assert.deepEqual(basura.cookies.getAll(), []);
  const m = empaquetarMeta({ fbclid: FBCLID, at: Date.now() })!;
  const u = empaquetarUtm({ utm: UTM, at: Date.now() })!;
  const repetido = await pedir(
    { fbclid: FBCLID, ...Object.fromEntries(Object.entries(UTM).map(([k, v]) => [`utm_${k}`, v])) },
    `${META_CLICK_COOKIE}=${m}; ${UTM_PRIMERO_COOKIE}=${encodeURIComponent(u)}; ${UTM_ULTIMO_COOKIE}=${encodeURIComponent(u)}`,
  );
  assert.equal(repetido.status, 204);
  assert.deepEqual(repetido.cookies.getAll(), []);
});

// ── Guardado en el alta ──────────────────────────────────────────────────────

const cookiesMeta = (extra: Record<string, string> = {}) => jar({
  [META_CLICK_COOKIE]: empaquetarMeta({ fbclid: FBCLID, at: Date.now() - DIA })!,
  [UTM_PRIMERO_COOKIE]: empaquetarUtm({ utm: { ...UTM, content: "a0-primero" }, at: Date.now() - 5 * DIA })!,
  [UTM_ULTIMO_COOKIE]: empaquetarUtm({ utm: UTM, at: Date.now() - DIA })!,
  _fbp: FBP,
  ...extra,
});

test("alta con clic de Meta: guarda fbclid, fbc, fbp, plataforma y UTM del primer y del último toque", async () => {
  const filas: Array<[FilaClick, ModoInsert]> = [];
  const r = await guardarClickAdsDeAlta(async (f, modo) => { filas.push([f, modo]); }, { clinicId: "clinic_1", leerCookie: cookiesMeta() });
  assert.equal(r, "guardado");
  assert.equal(filas.length, 1);
  const [f, modo] = filas[0];
  assert.equal(modo, "completo");
  assert.equal(f.clinicId, "clinic_1");
  assert.equal(f.platform, "meta");
  assert.equal(f.fbclid, FBCLID);
  assert.match(f.fbc!, new RegExp(`^fb\\.1\\.\\d{13}\\.${FBCLID}$`));
  assert.equal(f.fbp, FBP);
  assert.equal(f.gclid, null);
  assert.equal(f.clickedAt, null, "clickedAt sigue siendo el clic de Google");
  assert.ok(f.metaClickedAt instanceof Date);
  assert.equal(f.source, "dc_meta");
  assert.equal(f.utmCampaignLast, "prueba-6-angulos");
  assert.equal(f.utmContentLast, "a1-oferta");
  assert.equal(f.utmContentFirst, "a0-primero");
  assert.ok(f.utmFirstAt instanceof Date && f.utmLastAt instanceof Date);
});

test("la plataforma es la del ÚLTIMO clic cuando hubo de las dos", () => {
  const google = empaquetarClick({ ids: { gclid: GCLID }, at: AHORA - 3 * DIA })!;
  const meta = empaquetarMeta({ fbclid: FBCLID, at: AHORA - DIA })!;
  const a = armarFilasClick("c", jar({ dc_ads: google, dc_meta: meta }), AHORA)!;
  assert.equal(a.completa.platform, "meta");
  assert.equal(a.completa.gclid, GCLID, "el gclid también se conserva");
  assert.equal(a.completa.source, "dc_ads", "source/clickedAt siguen siendo de Google");
  assert.equal(a.completa.clickedAt?.getTime(), AHORA - 3 * DIA);
  const google2 = empaquetarClick({ ids: { gclid: GCLID }, at: AHORA - 0.5 * DIA })!;
  assert.equal(armarFilasClick("c", jar({ dc_ads: google2, dc_meta: meta }), AHORA)!.completa.platform, "google");
});

test("solo UTM (sin id de clic): guarda fila con plataforma null y source dc_utm", () => {
  const a = armarFilasClick("c", jar({ [UTM_ULTIMO_COOKIE]: empaquetarUtm({ utm: { source: "newsletter" }, at: AHORA - DIA })! }), AHORA)!;
  assert.equal(a.completa.platform, null);
  assert.equal(a.completa.source, "dc_utm");
  assert.equal(a.completa.utmSourceLast, "newsletter");
  assert.equal(a.completa.utmSourceFirst, "newsletter", "un solo toque = primero y último");
  assert.equal(a.basica, null, "sin Google no hay INSERT básico");
});

test("alta orgánica: no escribe nada (ni con _fbp suelta)", async () => {
  let llamadas = 0;
  assert.equal(await guardarClickAdsDeAlta(async () => { llamadas++; }, { clinicId: "c", leerCookie: jar({ _fbp: FBP }) }), "sin-clic");
  assert.equal(llamadas, 0);
});

test("sin clinicId no consulta ni escribe (regla del tenant)", async () => {
  let llamadas = 0;
  assert.equal(await guardarClickAdsDeAlta(async () => { llamadas++; }, { clinicId: "", leerCookie: cookiesMeta() }), "error");
  assert.equal(llamadas, 0);
});

const errColumna = () => Object.assign(
  new Error('Raw query failed. Code: `42703`. Message: `column "platform" of relation "clinic_ads_clicks" does not exist`'),
  { code: "P2010", meta: { code: "42703", message: 'column "platform" of relation "clinic_ads_clicks" does not exist' } },
);

test("faltan las columnas de ws1-t10: el clic de Google se guarda como siempre (INSERT básico)", async () => {
  const w = console.warn; console.warn = () => {};
  try {
    assert.equal(esColumnaInexistente(errColumna()), true);
    assert.equal(esColumnaInexistente(new Error("timeout")), false);
    const llamadas: ModoInsert[] = [];
    const guardadas: FilaClick[] = [];
    const google = empaquetarClick({ ids: { gclid: GCLID }, at: Date.now() - DIA })!;
    const r = await guardarClickAdsDeAlta(async (f, modo) => {
      llamadas.push(modo);
      if (modo === "completo") throw errColumna();
      guardadas.push(f);
    }, { clinicId: "c", leerCookie: jar({ dc_ads: google, [META_CLICK_COOKIE]: empaquetarMeta({ fbclid: FBCLID, at: Date.now() })! }) });
    assert.equal(r, "guardado");
    assert.deepEqual(llamadas, ["completo", "basico"]);
    assert.equal(guardadas[0].gclid, GCLID);
    assert.equal(guardadas[0].source, "dc_ads");
    assert.equal("fbclid" in guardadas[0], false, "el INSERT básico no lleva columnas nuevas");
  } finally { console.warn = w; }
});

test("faltan las columnas y solo hay Meta/UTM: no lanza, devuelve sin-columnas", async () => {
  const w = console.warn; console.warn = () => {};
  try {
    let basicos = 0;
    const r = await guardarClickAdsDeAlta(async (_f, modo) => {
      if (modo === "completo") throw errColumna();
      basicos++;
    }, { clinicId: "c", leerCookie: cookiesMeta() });
    assert.equal(r, "sin-columnas");
    assert.equal(basicos, 0);
  } finally { console.warn = w; }
});

test("tabla inexistente y otros errores se tragan", async () => {
  const w = console.warn; console.warn = () => {};
  try {
    const p2010 = Object.assign(new Error("x"), { code: "P2010", meta: { code: "42P01", message: 'relation "clinic_ads_clicks" does not exist' } });
    assert.equal(await guardarClickAdsDeAlta(async () => { throw p2010; }, { clinicId: "c", leerCookie: cookiesMeta() }), "sin-tabla");
    assert.equal(await guardarClickAdsDeAlta(async () => { throw new Error("pooler saturado"); }, { clinicId: "c", leerCookie: cookiesMeta() }), "error");
  } finally { console.warn = w; }
});

// ── Origen ───────────────────────────────────────────────────────────────────

test("origen: Meta con campaña y anuncio, Google Ads, otro y orgánico", () => {
  assert.deepEqual(
    origenDeClinica({ platform: "meta", fbclid: FBCLID, utmCampaignLast: "prueba-6-angulos", utmContentLast: "a1-oferta" }),
    { canal: "meta", etiqueta: "Meta · prueba-6-angulos · a1-oferta" },
  );
  assert.equal(origenDeClinica({ platform: "meta", fbclid: FBCLID }).etiqueta, "Meta");
  assert.equal(origenDeClinica({ platform: "meta", utmCampaignLast: "c" }).etiqueta, "Meta · c");
  assert.deepEqual(origenDeClinica({ gclid: GCLID }), { canal: "google", etiqueta: "Google Ads" });
  assert.deepEqual(origenDeClinica({ platform: "google", gclid: GCLID, utmCampaignLast: "x" }), { canal: "google", etiqueta: "Google Ads" });
  assert.deepEqual(origenDeClinica(null), { canal: "organico", etiqueta: "Orgánico" });
  assert.deepEqual(origenDeClinica({}), { canal: "organico", etiqueta: "Orgánico" });
  assert.deepEqual(origenDeClinica({ utmSourceLast: "newsletter" }), { canal: "otro", etiqueta: "Otro · newsletter" });
});

test("origen: UTM de Meta sin fbclid cuentan como Meta; los del primer toque valen si faltan los del último", () => {
  for (const s of ["meta", "Facebook", "fb", "instagram", "IG"]) {
    assert.equal(origenDeClinica({ utmSourceLast: s, utmCampaignLast: "c" }).canal, "meta", s);
  }
  assert.equal(origenDeClinica({ utmSourceFirst: "meta", utmCampaignFirst: "c1", utmContentFirst: "a1" }).etiqueta, "Meta · c1 · a1");
  assert.equal(origenDeClinica({ utmSourceLast: "google", utmMediumLast: "cpc" }).canal, "google");
  assert.equal(origenDeClinica({ utmSourceLast: "google", utmMediumLast: "organic" }).canal, "otro");
});

test("origen: la plataforma del último clic manda sobre el UTM", () => {
  assert.equal(origenDeClinica({ platform: "google", gclid: GCLID, utmSourceLast: "meta" }).canal, "google");
});

test("DTO: serializable, sin el fbclid y con los dos toques", () => {
  const dto = dtoDeOrigen({
    platform: "meta", fbclid: FBCLID, createdAt: new Date(AHORA),
    utmSourceFirst: "meta", utmCampaignFirst: "c", utmContentFirst: "a0", utmFirstAt: new Date(AHORA - DIA),
    utmSourceLast: "meta", utmCampaignLast: "c", utmContentLast: "a1", utmLastAt: new Date(AHORA),
  });
  assert.equal(JSON.stringify(dto).includes(FBCLID), false, "el fbclid no viaja al navegador del admin");
  assert.equal(dto.detalle?.conClicMeta, true);
  assert.equal(dto.detalle?.registradaAt, new Date(AHORA).toISOString());
  assert.equal(mismoUtm(dto.detalle!.primero, dto.detalle!.ultimo), false);
  assert.equal(resumenUtm(dto.detalle!.ultimo!), "fuente meta · campaña c · anuncio a1");
  assert.equal(dtoDeOrigen(null).detalle, null);
});

// ── Lectura para /admin ──────────────────────────────────────────────────────

const falsaDb = (comportamiento: (n: number) => unknown) => {
  let n = 0;
  return {
    llamadas: () => n,
    $queryRaw: async () => { const r = comportamiento(++n); if (r instanceof Error) throw r; return r as never; },
  };
};

test("admin: lee las filas y las que no tienen salen Orgánico", async () => {
  const db = falsaDb(() => [{ clinicId: "a", platform: "meta", fbclid: FBCLID, utmCampaignLast: "c", utmContentLast: "x" }]);
  const m = await cargarOrigenes(["a", "b"], db);
  assert.equal(m.get("a")?.etiqueta, "Meta · c · x");
  assert.equal(m.get("b")?.etiqueta, "Orgánico");
});

test("admin: sin ids no consulta", async () => {
  const db = falsaDb(() => []);
  assert.equal((await leerFilasOrigen(db, [])).size, 0);
  assert.equal(db.llamadas(), 0);
});

test("admin: faltan las columnas nuevas → reintenta con las de Google; falta la tabla → todo Orgánico; nunca lanza", async () => {
  const w = console.warn; console.warn = () => {};
  try {
    const conGoogle = falsaDb((n) => (n === 1 ? errColumna() : [{ clinicId: "a", gclid: GCLID }]));
    assert.equal((await cargarOrigen("a", conGoogle)).etiqueta, "Google Ads");
    assert.equal(conGoogle.llamadas(), 2);
    const sinTabla = falsaDb(() => Object.assign(new Error("x"), { meta: { code: "42P01", message: 'relation "clinic_ads_clicks" does not exist' } }));
    assert.equal((await cargarOrigen("a", sinTabla)).etiqueta, "Orgánico");
    const roto = falsaDb(() => new Error("pooler saturado"));
    assert.equal((await cargarOrigen("a", roto)).etiqueta, "Orgánico");
  } finally { console.warn = w; }
});

// ── Cableado y SQL (se lee el código) ───────────────────────────────────────

const SRC = join(__dirname, "..", "..", "..");
const RAIZ = join(SRC, "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("el SQL de ws1-t10 es plano e idempotente, con RLS, sin DROP ni DO $$ ni tocar clinics", () => {
  const sql = readFileSync(join(RAIZ, "sql", "ws1-t10-meta-origen.sql"), "utf8");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(codigo, /CREATE TABLE IF NOT EXISTS "clinic_ads_clicks"/);
  assert.match(codigo, /ENABLE ROW LEVEL SECURITY/);
  assert.ok(!/DO\s+\$\$/i.test(codigo));
  assert.ok(!/\bDROP\b/i.test(codigo));
  assert.ok(!/ALTER TABLE "clinics"/i.test(codigo));
  assert.ok(!/\bADD COLUMN\b(?! IF NOT EXISTS)/i.test(codigo), "toda columna con IF NOT EXISTS");
  // Toda columna que escribe el INSERT existe en el SQL.
  const store = leer("lib/ads/click-store.ts");
  const insert = store.slice(store.indexOf("function insertarCompleto"));
  const columnas = Array.from(insert.slice(0, insert.indexOf("VALUES")).matchAll(/"([A-Za-z]+)"/g)).map((m) => m[1]).filter((c) => c !== "clinic_ads_clicks");
  assert.ok(columnas.length >= 20);
  for (const c of columnas) assert.ok(codigo.includes(`"${c}"`), `falta la columna ${c} en el SQL`);
  // Y el SELECT del admin no lee ninguna que el SQL no cree.
  const admin = leer("lib/admin/origen-clinica.ts");
  const sel = admin.slice(admin.indexOf("SELECT"), admin.indexOf("FROM"));
  for (const m of sel.matchAll(/"([A-Za-z]+)"/g)) assert.ok(codigo.includes(`"${m[1]}"`), `el admin lee ${m[1]}, que el SQL no crea`);
});

test("el guardado sigue siendo SQL crudo, una fila por clínica, y el register no cambió de firma", () => {
  const store = leer("lib/ads/click-store.ts");
  assert.match(store, /ON CONFLICT \("clinicId"\) DO NOTHING/);
  assert.match(store, /export function guardarClickAdsDeLaAlta\(\s*clinicId: string,\s*leerCookie/);
  assert.ok(!/clinic\.update|"clinics"/.test(store));
  assert.ok(leer("app/api/auth/register/route.ts").includes("guardarClickAdsDeLaAlta(clinic.id,"));
});

test("la captura manda fbclid y UTM; el endpoint no toca la base", () => {
  const cap = leer("components/analytics/ads-click-capture.tsx");
  assert.match(cap, /extraerFbclid\(params\)/);
  assert.match(cap, /extraerUtm\(params\)/);
  assert.match(cap, /isPrivatePath\(pathname\)/);
  assert.ok(!/prisma/.test(leer("app/api/ads/click/route.ts")));
});

test("el admin muestra el origen en la lista y en la ficha, sin romper si no hay dato", () => {
  assert.match(leer("app/admin/clinics/page.tsx"), /cargarOrigenes\(/);
  assert.match(leer("app/admin/clinics/clinics-client.tsx"), /data-col="Origen"/);
  assert.match(leer("app/admin/clinics/[id]/page.tsx"), /cargarOrigen\(params\.id\)/);
  assert.match(leer("app/admin/clinics/[id]/clinic-detail-client.tsx"), /<OrigenClinica origen=\{origen\} \/>/);
});

test("ningún token ni secreto en lo de ws1-t10", () => {
  for (const f of ["lib/ads/meta-click.ts", "lib/ads/utm.ts", "lib/ads/origen.ts", "lib/ads/click-store.ts", "lib/ads/click-store-core.ts", "lib/admin/origen-clinica.ts"]) {
    assert.ok(!/META_CAPI_TOKEN|access_token|EAA[A-Za-z0-9]{20,}/.test(leer(f)), f);
  }
});
