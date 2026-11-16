/* ═══════════════════════════════════════════════════════════════════════
   «MI TARJETA» en la página web (ws6-t2) — con DOBLES: ninguna prueba toca
   la base, Meta ni manda un WhatsApp.

     npx tsx --tsconfig tsconfig.test.json --test \
       src/lib/barber/__tests__/tarjeta-web.test.ts

   Lo que se fija aquí es la promesa de seguridad de la pantalla:
     · la tarjeta y su enlace NUNCA vuelven a quien pregunta;
     · la respuesta es la misma exista o no el cliente;
     · el enlace solo viaja al número guardado, con el dominio del servidor.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveCardToken } from "../stars-core";
import { BARBER_WA_OPT_OUT_KEY, barberWaTemplate, checkBarberWaTemplate, countBarberWaVariables } from "../whatsapp-core";
import { canalDeTarjeta, pedirTarjeta, rutaTarjetaDeSesion, type TarjetaDeps } from "../tarjeta-web";
import {
  TARJETA_PHONE_DAY_LIMIT,
  TARJETA_PHONE_LIMIT,
  TARJETA_SITE_URL_DEFAULT,
  claveFrenoTarjeta,
  rutaMiTarjeta,
  sitioDeTarjeta,
} from "../tarjeta-web-core";

const SHOP = { id: "shop_aaaaaaaa", slug: "el-corte" };
const OTRA = { id: "shop_bbbbbbbb", slug: "la-otra" };

interface Cliente {
  id: string;
  barbershopId: string;
  phone: string;
  name: string;
  preferences: unknown;
  blockedAt: Date | null;
}

function mundo(
  opts: { estrellas?: boolean; sendable?: boolean; pasa?: boolean | ((key: string) => boolean); clientes?: Cliente[]; sendFalla?: boolean } = {},
) {
  const clientes = opts.clientes ?? [];
  const enviados: { barbershopId: string; phone: string; firstName: string; url: string }[] = [];
  const frenos: { key: string; limit: number; windowSec: number }[] = [];
  let consultasDeCliente = 0;
  const db = {
    barbershop: {
      findUnique: async () => ({ loyaltyEnabled: opts.estrellas ?? true, loyaltyThreshold: 10, loyaltyReward: "Corte gratis" }),
    },
    barberClient: {
      findUnique: async (args: { where: { barbershopId_phone: { barbershopId: string; phone: string } } }) => {
        consultasDeCliente++;
        const k = args.where.barbershopId_phone;
        return clientes.find((c) => c.barbershopId === k.barbershopId && c.phone === k.phone) ?? null;
      },
      findFirst: async (args: { where: { id: string; barbershopId: string } }) =>
        clientes.find((c) => c.id === args.where.id && c.barbershopId === args.where.barbershopId) ?? null,
    },
  };
  const deps = {
    db,
    sendable: async () => opts.sendable ?? true,
    send: async (a: { barbershopId: string; phone: string; firstName: string; url: string }) => {
      if (opts.sendFalla) throw new Error("Meta caído");
      enviados.push(a);
      return true;
    },
    allow: async (key: string, limit: number, windowSec: number) => {
      frenos.push({ key, limit, windowSec });
      return typeof opts.pasa === "function" ? opts.pasa(key) : (opts.pasa ?? true);
    },
    siteUrl: "https://www.dalecontrol.com",
  } as unknown as TarjetaDeps;
  return { deps, db, enviados, frenos, consultas: () => consultasDeCliente };
}

const luis: Cliente = {
  id: "cli_luis0001",
  barbershopId: SHOP.id,
  phone: "5512345678",
  name: "Luis Pérez",
  preferences: {},
  blockedAt: null,
};

test("ruta y clave del freno", () => {
  assert.equal(rutaMiTarjeta("el-corte"), "/b/el-corte/mi-tarjeta");
  assert.equal(claveFrenoTarjeta("s1", "+34 612 345 678"), "barber-tarjeta:s1:34612345678");
  assert.equal(claveFrenoTarjeta("s1", "5512345678"), "barber-tarjeta:s1:5512345678");
  assert.equal(claveFrenoTarjeta("s1", "5512345678", "dia"), "barber-tarjeta:s1:5512345678:dia");
});

test("el dominio del enlace sale del servidor y solo si es https", () => {
  assert.equal(sitioDeTarjeta({ NEXT_PUBLIC_SITE_URL: "https://www.dalecontrol.com/" }), "https://www.dalecontrol.com");
  assert.equal(sitioDeTarjeta({}), TARJETA_SITE_URL_DEFAULT);
  assert.equal(sitioDeTarjeta({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }), TARJETA_SITE_URL_DEFAULT);
  assert.equal(sitioDeTarjeta({ NEXT_PUBLIC_SITE_URL: "https://evil.com/x?y=" }), TARJETA_SITE_URL_DEFAULT);
  assert.equal(sitioDeTarjeta({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" }), TARJETA_SITE_URL_DEFAULT);
});

test("canal: sin estrellas o sin WhatsApp listo, se la pide a la barbería", async () => {
  assert.equal(await canalDeTarjeta(mundo({ estrellas: false }).deps, SHOP.id), "barberia");
  assert.equal(await canalDeTarjeta(mundo({ sendable: false }).deps, SHOP.id), "barberia");
  assert.equal(await canalDeTarjeta(mundo().deps, SHOP.id), "whatsapp");
  assert.equal(await canalDeTarjeta(mundo().deps, ""), "barberia");
});

test("sin WhatsApp listo: ni se consulta al cliente ni se manda nada", async () => {
  const m = mundo({ sendable: false, clientes: [luis] });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  assert.deepEqual({ canal: r.canal, enviar: r.enviar }, { canal: "barberia", enviar: null });
  assert.equal(m.consultas(), 0);
  assert.equal(m.frenos.length, 0);
});

test("cliente registrado: se le manda SU enlace a SU número, y el enlace abre su tarjeta", async () => {
  const m = mundo({ clientes: [luis] });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  assert.equal(r.canal, "whatsapp");
  assert.ok(r.enviar, "hay un envío pendiente");
  assert.equal(m.enviados.length, 0, "no sale hasta que la ruta lo corre después de responder");
  await r.enviar!();
  assert.equal(m.enviados.length, 1);
  const e = m.enviados[0];
  assert.equal(e.barbershopId, SHOP.id);
  assert.equal(e.phone, "5512345678");
  assert.equal(e.firstName, "Luis");
  assert.match(e.url, /^https:\/\/www\.dalecontrol\.com\/b\/el-corte\/tarjeta\/[^/]+$/);
  const token = e.url.split("/tarjeta/")[1];
  assert.deepEqual(await resolveCardToken(m.db as never, SHOP.id, token), { clientId: luis.id });
  assert.equal(await resolveCardToken(m.db as never, OTRA.id, token), null, "no sirve en otra barbería");
});

test("la respuesta es la MISMA exista o no el cliente", async () => {
  const si = await pedirTarjeta(mundo({ clientes: [luis] }).deps, { shop: SHOP, phone: luis.phone });
  const m = mundo({ clientes: [luis] });
  const no = await pedirTarjeta(m.deps, { shop: SHOP, phone: "5599999999" });
  assert.equal(no.canal, si.canal);
  assert.equal(no.enviar, null);
  assert.equal(m.enviados.length, 0);
  // Y el trabajo previo es el mismo: los dos frenos y una consulta en los dos casos.
  assert.equal(m.consultas(), 1);
  assert.equal(m.frenos.length, 2);
});

test("lo que vuelve a la ruta no lleva ni el enlace ni el nombre", async () => {
  const r = await pedirTarjeta(mundo({ clientes: [luis] }).deps, { shop: SHOP, phone: luis.phone });
  assert.deepEqual(Object.keys(r).sort(), ["canal", "enviar"]);
  assert.equal(JSON.stringify(r), '{"canal":"whatsapp"}', "al serializar solo queda el canal");
});

test("cliente de OTRA barbería con el mismo teléfono: no se manda", async () => {
  const m = mundo({ clientes: [{ ...luis, barbershopId: OTRA.id }] });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  assert.deepEqual({ canal: r.canal, enviar: r.enviar }, { canal: "whatsapp", enviar: null });
});

test("bloqueado o dado de baja de WhatsApp: misma respuesta, sin envío", async () => {
  for (const c of [
    { ...luis, blockedAt: new Date() },
    { ...luis, preferences: { [BARBER_WA_OPT_OUT_KEY]: { at: "2026-11-01T00:00:00.000Z" } } },
  ]) {
    const m = mundo({ clientes: [c] });
    const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: c.phone });
    assert.deepEqual({ canal: r.canal, enviar: r.enviar }, { canal: "whatsapp", enviar: null });
  }
});

test("freno por número: pasado el tope no sale, y la respuesta no cambia", async () => {
  const m = mundo({ clientes: [luis], pasa: false });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  assert.deepEqual({ canal: r.canal, enviar: r.enviar }, { canal: "whatsapp", enviar: null });
  assert.deepEqual(m.frenos, [
    { key: `barber-tarjeta:${SHOP.id}:5512345678`, limit: TARJETA_PHONE_LIMIT.limit, windowSec: TARJETA_PHONE_LIMIT.windowSec },
    { key: `barber-tarjeta:${SHOP.id}:5512345678:dia`, limit: TARJETA_PHONE_DAY_LIMIT.limit, windowSec: TARJETA_PHONE_DAY_LIMIT.windowSec },
  ]);
  assert.equal(m.consultas(), 1, "la consulta se hace igual: el tiempo no delata el tope");
});

test("tope del día: aunque la hora deje pasar, con el día agotado no sale", async () => {
  const m = mundo({ clientes: [luis], pasa: (key) => !key.endsWith(":dia") });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  assert.deepEqual({ canal: r.canal, enviar: r.enviar }, { canal: "whatsapp", enviar: null });
  assert.ok(TARJETA_PHONE_DAY_LIMIT.limit <= 5 && TARJETA_PHONE_LIMIT.limit <= 3, "topes pensados para una persona, no para una campaña");
});

test("enlace revocado: el que se manda lleva la versión vigente", async () => {
  const c = { ...luis, preferences: { __card: { v: 3 } } };
  const m = mundo({ clientes: [c] });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: c.phone });
  await r.enviar!();
  const token = m.enviados[0].url.split("/tarjeta/")[1];
  assert.equal(token.split(".")[1], "3");
  assert.deepEqual(await resolveCardToken(m.db as never, SHOP.id, token), { clientId: c.id });
});

test("turista (+E.164): se busca y se manda tal como está guardado", async () => {
  const c = { ...luis, id: "cli_ana00001", phone: "+34612345678", name: "Ana" };
  const m = mundo({ clientes: [c] });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: "+34612345678" });
  await r.enviar!();
  assert.equal(m.enviados[0].phone, "+34612345678");
  assert.equal(m.frenos[0].key, `barber-tarjeta:${SHOP.id}:34612345678`);
});

test("si Meta falla al mandar, el envío diferido no lanza", async () => {
  const m = mundo({ clientes: [luis], sendFalla: true });
  const r = await pedirTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  const original = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(r.enviar!());
  } finally {
    console.error = original;
  }
});

test("quien ya entró a «Mi cuenta» va directo a SU tarjeta", async () => {
  const m = mundo({ clientes: [luis, { ...luis, id: "cli_bloq0001", phone: "5500000000", blockedAt: new Date() }] });
  const ruta = await rutaTarjetaDeSesion(m.db as never, SHOP, luis.id);
  assert.match(ruta ?? "", /^\/b\/el-corte\/tarjeta\/[^/]+$/);
  assert.deepEqual(await resolveCardToken(m.db as never, SHOP.id, ruta!.split("/tarjeta/")[1]), { clientId: luis.id });
  assert.equal(await rutaTarjetaDeSesion(m.db as never, OTRA, luis.id), null, "sesión de otra barbería: no");
  assert.equal(await rutaTarjetaDeSesion(m.db as never, SHOP, "cli_bloq0001"), null, "bloqueado: no");
  assert.equal(await rutaTarjetaDeSesion(m.db as never, SHOP, ""), null);
});

test("la plantilla de WhatsApp cumple las reglas de Meta y es de utilidad", () => {
  const tpl = barberWaTemplate("starsCardRequest");
  assert.equal(tpl.name, "dc_barber_mi_tarjeta");
  assert.equal(tpl.category, "UTILITY");
  assert.equal(tpl.optional, false);
  assert.equal(checkBarberWaTemplate(tpl), null);
  assert.equal(countBarberWaVariables(tpl.body), 3);
  assert.deepEqual(tpl.variables, ["cliente", "barbería", "enlace de su tarjeta"]);
  assert.match(tpl.sample[2], /^https:\/\//);
});
