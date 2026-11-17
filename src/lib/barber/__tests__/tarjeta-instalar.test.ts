/* ═══════════════════════════════════════════════════════════════════════
   «AGREGAR A PANTALLA DE INICIO» de la tarjeta de estrellas (ws6-t2, punto 5).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/lib/barber/__tests__/tarjeta-instalar.test.ts

   Núcleo puro: el manifest de cada tarjeta, los colores por plantilla, los
   íconos y cuál aviso se enseña en cada teléfono. Sin base ni red.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BARBER_WEB_ACCENTS, BARBER_WEB_OFRECIDAS } from "../landing";
import { cardPath, parseCardToken, signCardToken } from "../stars-core";
import { claveAvisoInstalar, decidirAvisoInstalar } from "../tarjeta-instalar-aviso";
import { logoParaIcono } from "../tarjeta-instalar-logo";
import {
  TARJETA_ICON_SIZES,
  coloresDeTarjeta,
  esTamanoDeIcono,
  inicialDeTarjeta,
  manifestDeTarjeta,
  nombresDeTarjeta,
  rutaIconoTarjeta,
  rutaManifestTarjeta,
} from "../tarjeta-instalar-core";

const TOKEN = signCardToken("shop_aaaaaaaa", "cli_luis0001", 0);
const base = { shopName: "Barbería El Corte", slug: "el-corte", token: TOKEN, template: "oficio", acento: "caramelo", locale: "es" };

test("el manifest: nombre, enlace personal como inicio y pantalla completa", () => {
  const m = manifestDeTarjeta(base);
  assert.equal(m.name, "Estrellas · Barbería El Corte");
  assert.equal(m.start_url, cardPath("el-corte", TOKEN));
  assert.equal(m.id, m.start_url, "cada tarjeta es su propia app");
  assert.equal(m.scope, "/b/el-corte/", "desde la tarjeta se puede ir a Reservar sin salir de la ventana");
  assert.ok(m.start_url.startsWith(m.scope));
  assert.equal(m.display, "standalone");
  assert.equal(m.lang, "es-MX");
  assert.equal(manifestDeTarjeta({ ...base, locale: "en" }).name, "Stars · Barbería El Corte");
  assert.equal(manifestDeTarjeta({ ...base, locale: "en" }).lang, "en");
});

test("el manifest solo lleva datos públicos y el token que ya venía en la URL", () => {
  const m = manifestDeTarjeta(base);
  const texto = JSON.stringify(m);
  assert.equal(texto.split(TOKEN).length - 1, 2, "el token sale en start_url e id, y en ningún otro sitio");
  assert.ok(!/cli_luis0001[^.]/.test(texto.replaceAll(TOKEN, "")), "ni rastro del cliente fuera del token");
  assert.deepEqual(Object.keys(m).sort(), [
    "background_color", "display", "icons", "id", "lang", "name", "orientation", "scope", "short_name", "start_url", "theme_color",
  ]);
});

test("íconos: 192 y 512 «any» más uno «maskable», todos PNG de la barbería", () => {
  const m = manifestDeTarjeta(base);
  assert.deepEqual(
    m.icons.map((i) => `${i.sizes} ${i.purpose}`),
    ["192x192 any", "512x512 any", "512x512 maskable"],
  );
  for (const i of m.icons) {
    assert.equal(i.type, "image/png");
    assert.match(i.src, /^\/b\/el-corte\/tarjeta-icono\/(192|512)$/);
    assert.ok(!i.src.includes(TOKEN), "el ícono es de la barbería, no lleva el token");
  }
  assert.deepEqual([...TARJETA_ICON_SIZES], [180, 192, 512]);
  assert.equal(rutaIconoTarjeta("el-corte", 180), "/b/el-corte/tarjeta-icono/180");
  assert.equal(rutaManifestTarjeta("el-corte", TOKEN), `${cardPath("el-corte", TOKEN)}/manifest.webmanifest`);
});

test("tamaños de ícono: solo los tres que existen", () => {
  for (const ok of ["180", "192", "512"]) assert.equal(esTamanoDeIcono(ok), true);
  for (const mal of ["0", "64", "1024", "192px", "abc", "", "5e2", "192.0", "-192"]) assert.equal(esTamanoDeIcono(mal), false, mal);
});

test("colores: el fondo de la plantilla y el acento de la barbería", () => {
  assert.deepEqual(coloresDeTarjeta("oficio", "caramelo"), { fondo: "#1c1410", tema: "#A2612F", sobreTema: "#ffffff" });
  assert.equal(coloresDeTarjeta("barrio", "vino").fondo, "#0c0c0c");
  assert.equal(coloresDeTarjeta("barrio", "vino").tema, "#7A2E2E");
  assert.equal(coloresDeTarjeta("revista", "acero").fondo, "#fbfaf7");
  // Una plantilla vieja guardada se ve como Oficio; un acento raro, caramelo.
  assert.equal(coloresDeTarjeta("clasica", "caramelo").fondo, "#1c1410");
  assert.equal(coloresDeTarjeta(null, "no-existe").tema, "#A2612F");
  for (const tpl of BARBER_WEB_OFRECIDAS) {
    for (const a of BARBER_WEB_ACCENTS) {
      const c = coloresDeTarjeta(tpl, a.id);
      assert.match(c.fondo, /^#[0-9a-f]{6}$/i);
      assert.equal(c.tema, a.fuerte);
      const m = manifestDeTarjeta({ ...base, template: tpl, acento: a.id });
      assert.equal(m.background_color, c.fondo);
      assert.equal(m.theme_color, c.tema);
    }
  }
});

test("nombres: el corto cabe bajo el ícono", () => {
  assert.deepEqual(nombresDeTarjeta("El Roble"), { name: "Estrellas · El Roble", shortName: "El Roble" });
  assert.deepEqual(nombresDeTarjeta("Barbería Prueba DaleControl"), {
    name: "Estrellas · Barbería Prueba DaleControl",
    shortName: "Estrellas",
  });
  assert.deepEqual(nombresDeTarjeta("  "), { name: "Estrellas", shortName: "Estrellas" });
  assert.ok(nombresDeTarjeta("x".repeat(200)).name.length <= 72);
  for (const n of ["El Roble", "Barbería Prueba DaleControl", ""]) assert.ok(nombresDeTarjeta(n).shortName.length <= 12);
});

test("la inicial del ícono generado", () => {
  assert.equal(inicialDeTarjeta("barbería el corte"), "B");
  assert.equal(inicialDeTarjeta("  ¡Órale! Barber"), "Ó");
  assert.equal(inicialDeTarjeta("#1 Cuts"), "1");
  assert.equal(inicialDeTarjeta("★★★"), "★");
  assert.equal(inicialDeTarjeta(""), "★");
});

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_COMO_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const COMPU = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const nada = { instalada: false, cerrado: false, ofrecida: false, esperaVencida: false };

test("aviso: ya instalada o ya cerrado, nunca sale", () => {
  for (const ua of [IPHONE, ANDROID, COMPU]) {
    assert.equal(decidirAvisoInstalar({ ...nada, userAgent: ua, instalada: true, ofrecida: true, esperaVencida: true }), null);
    assert.equal(decidirAvisoInstalar({ ...nada, userAgent: ua, cerrado: true, ofrecida: true, esperaVencida: true }), null);
  }
});

test("aviso: si el navegador ofrece instalar, un botón (Android y computadora)", () => {
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: ANDROID, ofrecida: true }), "boton");
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: COMPU, ofrecida: true }), "boton");
});

test("aviso: iPhone y iPad, la instrucción de Compartir", () => {
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: IPHONE }), "iphone");
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: IPAD_COMO_MAC, maxTouchPoints: 5 }), "iphone");
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: IPAD_COMO_MAC, maxTouchPoints: 0 }), null, "una Mac de verdad: nada");
});

test("aviso: Android sin oferta espera antes de explicar el menú", () => {
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: ANDROID }), null, "todavía puede llegar la oferta");
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: ANDROID, esperaVencida: true }), "android");
});

test("aviso: computadora sin oferta, nada", () => {
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: COMPU, esperaVencida: true }), null);
  assert.equal(decidirAvisoInstalar({ ...nada, userAgent: "", esperaVencida: true }), null);
});

test("la clave de «ya lo cerré» es por barbería y no lleva el token", () => {
  assert.equal(claveAvisoInstalar("el-corte"), "dcb-tarjeta-instalar:el-corte");
});

test("el token de prueba tiene la forma que exige la ruta del manifest", () => {
  assert.ok(parseCardToken(TOKEN));
  assert.equal(parseCardToken("icono"), null);
  assert.equal(parseCardToken("../../etc/passwd"), null);
});

// ── El logo dentro del ícono: qué se baja y qué no ──────────────────────


const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co" };
const LOGO = "https://proyecto.supabase.co/storage/v1/object/public/clinic-logos/b1/logo.png";
function red(tipo: string, bytes: number, ok = true) {
  const pedidos: string[] = [];
  const fetchImpl = async (url: string) => {
    pedidos.push(url);
    return { ok, headers: { get: () => tipo }, arrayBuffer: async () => new Uint8Array(bytes).buffer as ArrayBuffer };
  };
  return { pedidos, fetchImpl };
}

test("logo: PNG o JPEG de nuestro almacenamiento se incrusta", async () => {
  const r = red("image/png", 10);
  assert.match((await logoParaIcono(LOGO, { env: ENV, fetchImpl: r.fetchImpl })) ?? "", /^data:image\/png;base64,/);
  assert.deepEqual(r.pedidos, [LOGO]);
  assert.match((await logoParaIcono(LOGO, { env: ENV, fetchImpl: red("image/jpeg; charset=binary", 10).fetchImpl })) ?? "", /^data:image\/jpeg;base64,/);
});

test("logo: una URL que no es de nuestro almacenamiento NO se pide (el servidor no sale a buscarla)", async () => {
  for (const url of [
    "https://evil.example/logo.png",
    "http://169.254.169.254/latest/meta-data/",
    "https://proyecto.supabase.co.evil.example/storage/v1/object/public/x.png",
    "https://proyecto.supabase.co/storage/v1/object/sign/privado/x.png",
    "https://proyecto.supabase.co/storage/v1/object/public/../../auth/v1/admin",
    "https://user@proyecto.supabase.co/storage/v1/object/public/x.png",
    "",
  ]) {
    const r = red("image/png", 10);
    assert.equal(await logoParaIcono(url, { env: ENV, fetchImpl: r.fetchImpl }), null, url);
    assert.equal(r.pedidos.length, 0, `no debe pedirse: ${url}`);
  }
  const sinEnv = red("image/png", 10);
  assert.equal(await logoParaIcono(LOGO, { env: {}, fetchImpl: sinEnv.fetchImpl }), null);
  assert.equal(sinEnv.pedidos.length, 0);
});

test("logo: otro formato, vacío, enorme o con error cae a la inicial", async () => {
  assert.equal(await logoParaIcono(LOGO, { env: ENV, fetchImpl: red("image/webp", 10).fetchImpl }), null);
  assert.equal(await logoParaIcono(LOGO, { env: ENV, fetchImpl: red("image/svg+xml", 10).fetchImpl }), null);
  assert.equal(await logoParaIcono(LOGO, { env: ENV, fetchImpl: red("image/png", 0).fetchImpl }), null);
  assert.equal(await logoParaIcono(LOGO, { env: ENV, fetchImpl: red("image/png", 2 * 1024 * 1024 + 1).fetchImpl }), null);
  assert.equal(await logoParaIcono(LOGO, { env: ENV, fetchImpl: red("image/png", 10, false).fetchImpl }), null);
  assert.equal(
    await logoParaIcono(LOGO, {
      env: ENV,
      fetchImpl: async () => {
        throw new Error("sin red");
      },
    }),
    null,
  );
});

// ── Lo que corre en el NAVEGADOR no arrastra código de servidor ─────────


test("los componentes de navegador no importan nada de servidor", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const prohibidos = /from "(@\/lib\/barber\/(stars-core|stars|tarjeta-instalar-core|tarjeta-instalar|tarjeta-web|whatsapp|client-portal)|@\/lib\/prisma|crypto|node:[a-z]+|next\/headers|server-only)"/;
  for (const archivo of [
    "components/barber/stars/instalar-tarjeta.tsx",
    "components/barber/stars/mi-tarjeta-form.tsx",
    "lib/barber/tarjeta-instalar-aviso.ts",
  ]) {
    const src = readFileSync(join(raiz, archivo), "utf8");
    const mal = src.split("\n").filter((l) => /^import /.test(l) && prohibidos.test(l));
    assert.deepEqual(mal, [], `${archivo} importa código de servidor`);
  }
  for (const archivo of ["components/barber/stars/instalar-tarjeta.tsx", "components/barber/stars/mi-tarjeta-form.tsx"]) {
    assert.match(readFileSync(join(raiz, archivo), "utf8"), /^"use client";/, `${archivo} declara "use client" en la primera línea`);
  }
});
