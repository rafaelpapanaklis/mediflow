import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  urlDeSaltoAlHostDeLaApp, claveAvisoErrorGcal, MOTIVOS_ERROR_GCAL, PARAM_SALTO,
} from "../google-calendar-callback";

// La configuración que tienen hoy el .env del servidor y (según esa copia) Vercel.
const APP = "https://www.dalecontrol.com";
const REDIRECT = "https://mediflow-pi.vercel.app/api/google/callback";
const q = (s: string) => new URLSearchParams(s);

test("Google vuelve a mediflow-pi.vercel.app → salta al callback de www.dalecontrol.com con la misma respuesta", () => {
  const url = urlDeSaltoAlHostDeLaApp({
    hostPeticion: "mediflow-pi.vercel.app",
    query: q("state=u1.abcd&code=4%2F0Ab_x&scope=email%20openid"),
    appUrl: APP, redirectUri: REDIRECT,
  });
  assert.ok(url);
  const u = new URL(url!);
  assert.equal(u.origin, APP);
  assert.equal(u.pathname, "/api/google/callback");
  assert.equal(u.searchParams.get("code"), "4/0Ab_x");
  assert.equal(u.searchParams.get("state"), "u1.abcd");
  assert.equal(u.searchParams.get("scope"), "email openid");
  assert.equal(u.searchParams.get(PARAM_SALTO), "1");
});

test("también reenvía ?error= de Google (el aviso se decide en el host de la app)", () => {
  const url = urlDeSaltoAlHostDeLaApp({
    hostPeticion: "mediflow-pi.vercel.app", query: q("error=access_denied&state=u1.abcd"),
    appUrl: APP, redirectUri: REDIRECT,
  });
  assert.equal(new URL(url!).searchParams.get("error"), "access_denied");
});

test("ya en el host de la app no salta", () => {
  assert.equal(urlDeSaltoAlHostDeLaApp({
    hostPeticion: "www.dalecontrol.com", query: q("code=c&state=s"), appUrl: APP, redirectUri: REDIRECT,
  }), null);
});

test("con la marca de salto nunca vuelve a saltar (sin bucles)", () => {
  assert.equal(urlDeSaltoAlHostDeLaApp({
    hostPeticion: "mediflow-pi.vercel.app", query: q(`code=c&state=s&${PARAM_SALTO}=1`), appUrl: APP, redirectUri: REDIRECT,
  }), null);
});

test("redirect_uri en el mismo host que la app, o sin GOOGLE_REDIRECT_URI: no salta", () => {
  assert.equal(urlDeSaltoAlHostDeLaApp({
    hostPeticion: "www.dalecontrol.com", query: q("code=c&state=s"), appUrl: APP, redirectUri: `${APP}/api/google/callback`,
  }), null);
  assert.equal(urlDeSaltoAlHostDeLaApp({
    hostPeticion: "mediflow-pi.vercel.app", query: q("code=c&state=s"), appUrl: APP, redirectUri: undefined,
  }), null);
});

test("un host cualquiera (panel.108, preview, host inventado) no salta a producción", () => {
  for (const h of ["panel.108-181-149-131.sslip.io", "otro.example.com", "dalecontrol.com"]) {
    assert.equal(urlDeSaltoAlHostDeLaApp({
      hostPeticion: h, query: q("code=c&state=s"), appUrl: APP, redirectUri: REDIRECT,
    }), null, h);
  }
});

test("quien ya tiene sesión en el host del redirect_uri se queda ahí (como antes del arreglo)", () => {
  assert.equal(urlDeSaltoAlHostDeLaApp({
    hostPeticion: "mediflow-pi.vercel.app", query: q("code=c&state=s"), appUrl: APP, redirectUri: REDIRECT, haySesionAqui: true,
  }), null);
});

test("el host se compara sin mayúsculas", () => {
  assert.ok(urlDeSaltoAlHostDeLaApp({
    hostPeticion: "Mediflow-Pi.Vercel.App", query: q("code=c&state=s"), appUrl: APP, redirectUri: REDIRECT,
  }));
});

test("cada motivo tiene aviso propio en es y en; uno desconocido cae al genérico", () => {
  const raiz = path.resolve(__dirname, "../../i18n/dictionaries");
  for (const lang of ["es", "en"]) {
    const dic = JSON.parse(fs.readFileSync(path.join(raiz, `${lang}.json`), "utf8"));
    for (const m of MOTIVOS_ERROR_GCAL) {
      const clave = claveAvisoErrorGcal(m).split(".");
      const texto = clave.reduce((o: any, k) => o?.[k], dic);
      assert.equal(typeof texto, "string", `${lang}: ${clave.join(".")}`);
      assert.ok(!/verifica tus credenciales|check your credentials/.test(texto));
    }
  }
  assert.equal(claveAvisoErrorGcal(undefined), "settings.client.gcalConnectErrorToast");
  assert.equal(claveAvisoErrorGcal("<script>"), "settings.client.gcalConnectErrorToast");
});

test("el callback usa el salto y ya no manda gcal=error sin motivo", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../app/api/google/callback/route.ts"), "utf8");
  assert.match(src, /urlDeSaltoAlHostDeLaApp\(/);
  assert.doesNotMatch(src, /gcal=error`\)/);
  // la fila de la sesión se busca por id del state + supabaseId (personas con varias clínicas)
  assert.match(src, /where: \{ id: userId, supabaseId: sessionUser\.id, isActive: true \}/);
});
