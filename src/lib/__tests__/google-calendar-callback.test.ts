import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  urlDeSaltoAlHostDeLaApp, claveAvisoErrorGcal, decidirConexionDeClinica, MOTIVOS_ERROR_GCAL, PARAM_SALTO,
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

// ── ws1-t2 (#11): una clínica, una cuenta de Google; calendario que no se pudo crear ─────────────

test("clínica ya conectada con OTRA cuenta de Google: no se deja pisar (hay que desconectar primero)", () => {
  assert.equal(decidirConexionDeClinica({ clinicaYaConectada: true, correoDeLaClinica: "a@x.mx", correoNuevo: "b@x.mx" }), "cuenta_distinta");
});

test("la MISMA cuenta puede reconectar (renovar permisos), sin importar mayúsculas ni espacios", () => {
  assert.equal(decidirConexionDeClinica({ clinicaYaConectada: true, correoDeLaClinica: "Ana@X.mx ", correoNuevo: "ana@x.mx" }), "ok");
});

test("clínica sin conexión previa, o sin correo con qué comparar: se deja pasar", () => {
  assert.equal(decidirConexionDeClinica({ clinicaYaConectada: false, correoDeLaClinica: "a@x.mx", correoNuevo: "b@x.mx" }), "ok");
  assert.equal(decidirConexionDeClinica({ clinicaYaConectada: true, correoDeLaClinica: null, correoNuevo: "b@x.mx" }), "ok");
  assert.equal(decidirConexionDeClinica({ clinicaYaConectada: true, correoDeLaClinica: "a@x.mx", correoNuevo: undefined }), "ok");
});

test("«cuenta_distinta» y «calendario» son motivos con aviso propio", () => {
  assert.ok(MOTIVOS_ERROR_GCAL.includes("cuenta_distinta"));
  assert.ok(MOTIVOS_ERROR_GCAL.includes("calendario"));
  assert.equal(claveAvisoErrorGcal("cuenta_distinta"), "settings.client.gcalError_cuenta_distinta");
  assert.equal(claveAvisoErrorGcal("calendario"), "settings.client.gcalError_calendario");
});

test("el callback decide la cuenta ANTES de guardar nada, exige refresh token y avisa si falta el calendario", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../app/api/google/callback/route.ts"), "utf8");
  const iDecide = src.indexOf("decidirConexionDeClinica(");
  const iPrimerUpdate = src.indexOf("UPDATE users SET");
  assert.ok(iDecide > 0 && iPrimerUpdate > 0 && iDecide < iPrimerUpdate, "la decisión va antes de cualquier UPDATE");
  assert.match(src, /fallo\("cuenta_distinta"\)/);
  assert.match(src, /if \(!refreshToken\)/);
  // el calendario se busca por el id de la clínica, ya no por nombre a secas
  assert.match(src, /asegurarCalendarioDeClinica\(cal, \{\s*clinicId: user\.clinicId/);
  assert.match(src, /if \(sinCalendario\) return fallo\("calendario"\)/);
  // la conexión se guarda igual aunque no haya calendario (los tokens valen)
  assert.ok(src.indexOf("UPDATE clinics SET") < src.indexOf('fallo("calendario")'));
});

test("el callback rechaza si la persona desmarcó el permiso de Calendar, ANTES de guardar nada, y reutiliza el calendario guardado", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../app/api/google/callback/route.ts"), "utf8");
  const iPermiso = src.indexOf("permisoDeCalendarConcedido(tokens.scope)");
  assert.ok(iPermiso > 0 && iPermiso < src.indexOf("UPDATE users SET"), "la comprobación va antes de cualquier UPDATE");
  assert.match(src, /fallo\("permisos"\)/);
  assert.match(src, /calendarIdGuardado: user\.clinic\.googleClinicCalendarId/);
  assert.ok(MOTIVOS_ERROR_GCAL.includes("permisos"));
  assert.equal(claveAvisoErrorGcal("permisos"), "settings.client.gcalError_permisos");
});
