/**
 * Google Calendar → agenda (WS1-T9), tercera vuelta de la revisión t8, N3-G2:
 * el aviso del panel cuando los eventos de Google ya no cierran la agenda.
 * Se ejecuta con los diccionarios reales (es y en), un `fetch` falso que hace
 * de `GET /api/google/agenda/sincronizar` y el componente pintado con
 * react-dom/server. Lo del cron y la base está en segunda-vuelta-servidor.
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeT, type Dictionary } from "@/i18n/t";
import {
  AvisoRetiroVista,
  avisoDeConexion,
  cargarRetiro,
  leerRetiro,
  textoAvisoAgenda,
  textoRetiro,
} from "@/components/dashboard/agenda-nueva/google-retiro-aviso";
import {
  avisoDeRetiro,
  bloqueosSinMantener,
  type CausaRetiro,
} from "../entrante-core";

const dic = (l: "es" | "en") =>
  JSON.parse(readFileSync(join(process.cwd(), "src/i18n/dictionaries", `${l}.json`), "utf8")) as Dictionary;
const tEs = makeT(dic("es"));
const tEn = makeT(dic("en"));
const CAUSAS: CausaRetiro[] = ["desconectada", "conexion", "permisos", "calendario", "parcial", "google", "reponiendo"];
const ZONA = "America/Mexico_City";
const DESDE = "2026-10-21T15:30:00.000Z"; // 21 de octubre, 09:30 en México

test("N3-G2: cada causa tiene su texto en es y en (qué pasó, desde cuándo y qué hacer), nunca la clave cruda; la hora, en la zona de la CLÍNICA", () => {
  for (const causa of CAUSAS) {
    for (const [t, l] of [[tEs, "es"], [tEn, "en"]] as const) {
      const texto = textoRetiro({ desde: DESDE, causa, zona: ZONA }, t, l);
      assert.equal(texto.includes("agenda.google."), false, `${l}/${causa}: ${texto}`);
      assert.ok(texto.includes("09:30"), `${l}/${causa} lleva la hora de la clínica: ${texto}`);
    }
  }
  // «21 de octubre a las 09:30» (el «a las» lo pone Intl según su versión de ICU).
  assert.match(
    textoRetiro({ desde: DESDE, causa: "google", zona: ZONA }, tEs, "es"),
    /^Desde el 21 de octubre(,| a las) 09:30, los eventos de Google ya no cierran la agenda: esas horas se ven libres y el bot puede ofrecerlas\. Cuando se arregle, vuelven a cerrarse solas\. Hubo un error al leer tu calendario de Google\. Lo seguimos intentando cada 5 minutos; si el aviso sigue mañana, escríbenos\.$/,
  );
  // Otra clínica, otra zona: la misma fecha se pinta en la suya.
  assert.ok(textoRetiro({ desde: DESDE, causa: "google", zona: "America/Tijuana" }, tEs, "es").includes("08:30"));
  // Una zona rara no rompe el aviso.
  assert.ok(textoRetiro({ desde: DESDE, causa: "google", zona: "Marte/Olympus" }, tEs, "es").startsWith("Desde el"));
});

test("N3-G2: en la agenda, el retiro va antes que el aviso de conexión; desconectar a propósito no es una alerta permanente ahí; sin la bandera, nada", () => {
  const retiro = { desde: DESDE, causa: "permisos" as const, zona: ZONA };
  const conRetiro = textoAvisoAgenda({ encendida: true, error: "permisos", retiro }, tEs, "es")!;
  assert.ok(conRetiro.startsWith("Desde el 21 de octubre"), conRetiro);
  assert.ok(conRetiro.includes("acepta el permiso"), conRetiro);
  assert.equal(textoAvisoAgenda({ encendida: true, error: "permisos", retiro: null }, tEs, "es"), tEs("agenda.google.reconectar"));
  assert.equal(textoAvisoAgenda({ encendida: true, error: null, retiro: { ...retiro, causa: "desconectada" } }, tEs, "es"), null);
  assert.equal(avisoDeConexion("parcial"), null);
  assert.equal(textoAvisoAgenda({ encendida: true, error: null, retiro: null }, tEs, "es"), null);
  assert.equal(textoAvisoAgenda({ encendida: false, error: "permisos", retiro }, tEs, "es"), null);
});

test("N3-G2: Configuración pide el estado (como la agenda) y pinta el aviso; sin permiso, sin bandera o con basura, nada", async () => {
  const pedidas: { url: string; init?: RequestInit }[] = [];
  const responder = (status: number, body: unknown) =>
    (async (url: string, init?: RequestInit) => {
      pedidas.push({ url, init });
      return { ok: status < 400, status, json: async () => body } as Response;
    }) as unknown as typeof fetch;

  const r = await cargarRetiro(responder(200, { encendida: true, retiro: { desde: DESDE, causa: "desconectada", zona: ZONA } }));
  assert.deepEqual(r, { desde: DESDE, causa: "desconectada", zona: ZONA });
  assert.equal(pedidas[0].url, "/api/google/agenda/sincronizar");
  assert.equal(pedidas[0].init?.method, "POST", "como la agenda: se pone al día antes (recién reconectado no enseña el aviso viejo)");

  // En Configuración SÍ se dice que está desconectado (junto a «Conectar»).
  const html = renderToStaticMarkup(createElement(AvisoRetiroVista, { texto: textoRetiro(r!, tEs, "es") }));
  assert.ok(html.includes('role="alert"'), html);
  assert.ok(html.includes("Google está desconectado"), html);

  assert.equal(await cargarRetiro(responder(403, { error: "forbidden" })), null);
  assert.equal(await cargarRetiro(responder(200, { encendida: false, retiro: { desde: DESDE, causa: "google" } })), null);
  assert.equal(await cargarRetiro(responder(200, { encendida: true, retiro: { desde: DESDE, causa: "otra" } })), null);
  assert.equal(await cargarRetiro(responder(200, { encendida: true, retiro: { desde: null, causa: "google" } })), null);
  assert.equal(await cargarRetiro((async () => { throw new Error("sin red"); }) as unknown as typeof fetch), null);
});

test("N3-G2: el aviso sale de los HECHOS (algo retirado y la fila como la deja el retiro), con la fecha real; la causa es la de ahora", () => {
  const ahora = new Date("2026-10-22T12:00:00Z");
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000);
  const base = {
    conToken: true, conexionActiva: true, conCalendario: true, ultimaBuena: hace(30), encendidaDesde: hace(500),
    ultimoError: "google" as string | null, sinToken: true, retiradoDesde: hace(5) as Date | null,
  };
  assert.deepEqual(avisoDeRetiro(base, ahora), { desde: hace(5), causa: "google" }, "la fecha es la del retiro, no la del plazo");
  assert.equal(avisoDeRetiro({ ...base, retiradoDesde: null }, ahora), null, "regla cumplida pero nada retirado: todavía cierran");
  assert.equal(avisoDeRetiro({ ...base, sinToken: false }, ahora), null, "ya hubo una completa: repuesto");
  const causa = (x: Partial<typeof base>) => avisoDeRetiro({ ...base, ...x }, ahora)?.causa;
  assert.equal(causa({ conToken: false }), "desconectada");
  assert.equal(causa({ conexionActiva: false, ultimoError: null }), "conexion");
  assert.equal(causa({ ultimoError: "autorizacion" }), "conexion");
  assert.equal(causa({ ultimoError: "permisos" }), "permisos");
  assert.equal(causa({ ultimoError: "calendario_compartido" }), "calendario");
  assert.equal(causa({ conCalendario: false, ultimoError: null }), "calendario", "sin calendario elegido no es «error de Google»");
  assert.equal(causa({ ultimoError: "parcial", ultimaBuena: hace(50) }), "reponiendo", "Google contesta: se está reponiendo");
  assert.equal(causa({ ultimoError: "parcial", ultimaBuena: hace(80) }), "parcial", "no termina nunca");
  assert.equal(causa({ ultimoError: null, ultimaBuena: hace(2) }), "reponiendo", "bandera apagada y vuelta a encender");
});

test("revisor: tras un retiro, un «parcial» (Google contesta, la completa repone) NO retira otra vez; sin retiro previo, a las 72 h sí", () => {
  const ahora = new Date("2026-10-22T12:00:00Z");
  const e = { conToken: true, conexionActiva: true, ultimaBuena: new Date(ahora.getTime() - 80 * 3_600_000), encendidaDesde: null, ultimoError: "parcial" };
  assert.equal(bloqueosSinMantener(e, ahora), true);
  assert.equal(bloqueosSinMantener({ ...e, reponiendo: true }, ahora), false);
  // Si vuelve a fallar Google (no «parcial»), sí se retira otra vez.
  assert.equal(bloqueosSinMantener({ ...e, reponiendo: true, ultimoError: "google" }, ahora), true);
});
