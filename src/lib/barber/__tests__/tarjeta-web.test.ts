/* ═══════════════════════════════════════════════════════════════════════
   «MI TARJETA» en la página web (ws6-t2) — con DOBLES: ninguna prueba toca
   la base.

     npx tsx --tsconfig tsconfig.test.json --test \
       src/lib/barber/__tests__/tarjeta-web.test.ts

   Desde el cambio de Rafael (16-nov) la tarjeta se ENSEÑA con el teléfono.
   Lo que se fija aquí:
     · solo se enseña al cliente de ESA barbería, y solo la tarjeta (nombre
       de pila, estrellas, bonos, historial de estrellas): ni teléfono, ni
       apellido, ni nada más;
     · los frenos por número van antes de mirar la base;
     · ya no hay plantilla de WhatsApp ni envío.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveCardToken, type StarsView } from "../stars-core";
import { BARBER_WA_TEMPLATES } from "../whatsapp-core";
import { buscarTarjeta, rutaTarjetaDeSesion, type TarjetaDeps } from "../tarjeta-web";
import {
  TARJETA_IP_LIMIT,
  TARJETA_PHONE_DAY_LIMIT,
  TARJETA_PHONE_LIMIT,
  claveFrenoTarjeta,
  claveNumeroRecordado,
  leerNumeroRecordado,
  rutaMiTarjeta,
  serializarNumeroRecordado,
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

/** La vista que arma loadStarsView para el cliente: lo ÚNICO personal es el nombre de pila. */
function vista(c: Cliente, extra: Partial<StarsView> = {}): StarsView {
  return {
    enabled: true,
    firstName: c.name.split(" ")[0],
    stars: 4,
    slots: 6,
    next: null,
    available: [],
    catalog: [],
    history: [{ id: "e1", at: "2026-11-10T18:00:00.000Z", kind: "visit", reason: "appointment", delta: 1, detail: "Corte clásico" }],
    usedCount: 0,
    ...extra,
  };
}

function mundo(
  opts: {
    estrellas?: boolean;
    pasa?: boolean | ((key: string) => boolean);
    clientes?: Cliente[];
    vistaDe?: (c: Cliente) => StarsView | null;
  } = {},
) {
  const clientes = opts.clientes ?? [];
  const frenos: { key: string; limit: number; windowSec: number }[] = [];
  const vistasPedidas: { barbershopId: string; clientId: string; audience: string }[] = [];
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
    allow: async (key: string, limit: number, windowSec: number) => {
      frenos.push({ key, limit, windowSec });
      return typeof opts.pasa === "function" ? opts.pasa(key) : (opts.pasa ?? true);
    },
    loadView: async (_db: unknown, a: { barbershopId: string; clientId: string; audience: "client" }) => {
      vistasPedidas.push(a);
      const c = clientes.find((x) => x.id === a.clientId && x.barbershopId === a.barbershopId);
      if (!c) return null;
      return opts.vistaDe ? opts.vistaDe(c) : vista(c);
    },
  } as unknown as TarjetaDeps;
  return { deps, db, frenos, vistasPedidas, consultas: () => consultasDeCliente };
}

const luis: Cliente = {
  id: "cli_luis0001",
  barbershopId: SHOP.id,
  phone: "5512345678",
  name: "Luis Pérez Gómez",
  preferences: {},
  blockedAt: null,
};

test("ruta y clave del freno", () => {
  assert.equal(rutaMiTarjeta("el-corte"), "/b/el-corte/mi-tarjeta");
  assert.equal(claveFrenoTarjeta("s1", "+34 612 345 678"), "barber-tarjeta:s1:34612345678");
  assert.equal(claveFrenoTarjeta("s1", "5512345678"), "barber-tarjeta:s1:5512345678");
  assert.equal(claveFrenoTarjeta("s1", "5512345678", "dia"), "barber-tarjeta:s1:5512345678:dia");
});

test("cliente de la barbería: se le enseña SU tarjeta y su enlace personal abre la misma", async () => {
  const m = mundo({ clientes: [luis] });
  const r = await buscarTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  assert.equal(r.estado, "encontrada");
  if (r.estado !== "encontrada") return;
  assert.equal(r.view.firstName, "Luis");
  assert.equal(r.view.stars, 4);
  assert.match(r.ruta, /^\/b\/el-corte\/tarjeta\/[^/]+$/);
  const token = r.ruta.split("/tarjeta/")[1];
  assert.deepEqual(await resolveCardToken(m.db as never, SHOP.id, token), { clientId: luis.id });
  assert.equal(await resolveCardToken(m.db as never, OTRA.id, token), null, "el enlace no sirve en otra barbería");
  assert.deepEqual(m.vistasPedidas, [{ barbershopId: SHOP.id, clientId: luis.id, audience: "client" }], "la vista es la del CLIENTE, no la del personal");
});

test("🔒 lo que vuelve al navegador no lleva ni el teléfono ni el apellido ni el id suelto", async () => {
  const m = mundo({ clientes: [luis] });
  const r = await buscarTarjeta(m.deps, { shop: SHOP, phone: luis.phone });
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes("5512345678"), "el teléfono no vuelve");
  assert.ok(!/Pérez|Gómez/.test(texto), "el apellido no vuelve");
  assert.deepEqual(Object.keys(r).sort(), ["estado", "ruta", "view"]);
  if (r.estado === "encontrada") {
    assert.deepEqual(
      Object.keys(r.view).sort(),
      ["available", "catalog", "enabled", "firstName", "history", "next", "slots", "stars", "usedCount"],
      "solo la tarjeta: estrellas, bonos e historial de estrellas",
    );
  }
});

test("un número que no es de un cliente: «no», sin vista ni enlace", async () => {
  const m = mundo({ clientes: [luis] });
  const r = await buscarTarjeta(m.deps, { shop: SHOP, phone: "5599999999" });
  assert.deepEqual(r, { estado: "no" });
  assert.equal(m.vistasPedidas.length, 0);
});

test("🔒 el mismo teléfono en OTRA barbería no existe para esta consulta", async () => {
  const m = mundo({ clientes: [{ ...luis, barbershopId: OTRA.id }] });
  assert.deepEqual(await buscarTarjeta(m.deps, { shop: SHOP, phone: luis.phone }), { estado: "no" });
  assert.equal(m.vistasPedidas.length, 0);
});

test("cliente bloqueado: «no», igual que el enlace por QR", async () => {
  const m = mundo({ clientes: [{ ...luis, blockedAt: new Date() }] });
  assert.deepEqual(await buscarTarjeta(m.deps, { shop: SHOP, phone: luis.phone }), { estado: "no" });
  assert.equal(m.vistasPedidas.length, 0);
});

test("barbería sin estrellas: «apagada», sin frenos ni consulta", async () => {
  const m = mundo({ estrellas: false, clientes: [luis] });
  assert.deepEqual(await buscarTarjeta(m.deps, { shop: SHOP, phone: luis.phone }), { estado: "apagada" });
  assert.equal(m.consultas(), 0);
  assert.equal(m.frenos.length, 0);
  // Y si la vista dice que está apagada (carrera con el interruptor), tampoco se enseña.
  const m2 = mundo({ clientes: [luis], vistaDe: (c) => vista(c, { enabled: false }) });
  assert.deepEqual(await buscarTarjeta(m2.deps, { shop: SHOP, phone: luis.phone }), { estado: "apagada" });
});

test("freno por número: pasado el tope NO se mira la base", async () => {
  const m = mundo({ clientes: [luis], pasa: false });
  assert.deepEqual(await buscarTarjeta(m.deps, { shop: SHOP, phone: luis.phone }), { estado: "frenado" });
  assert.equal(m.consultas(), 0, "quien insiste con un número no llega a consultarlo");
  assert.deepEqual(m.frenos, [
    { key: `barber-tarjeta:${SHOP.id}:5512345678`, limit: TARJETA_PHONE_LIMIT.limit, windowSec: TARJETA_PHONE_LIMIT.windowSec },
    { key: `barber-tarjeta:${SHOP.id}:5512345678:dia`, limit: TARJETA_PHONE_DAY_LIMIT.limit, windowSec: TARJETA_PHONE_DAY_LIMIT.windowSec },
  ]);
});

test("tope del día: aunque la hora deje pasar, con el día agotado no se enseña", async () => {
  const m = mundo({ clientes: [luis], pasa: (key) => !key.endsWith(":dia") });
  assert.deepEqual(await buscarTarjeta(m.deps, { shop: SHOP, phone: luis.phone }), { estado: "frenado" });
});

test("los topes: por IP corto para que no se prueben números en serie; por número, de uso normal", () => {
  assert.ok(TARJETA_IP_LIMIT.limit <= 15 && TARJETA_IP_LIMIT.windowSec >= 600);
  assert.ok(TARJETA_PHONE_LIMIT.limit <= 12 && TARJETA_PHONE_LIMIT.windowSec === 3600);
  assert.ok(TARJETA_PHONE_DAY_LIMIT.limit <= 40 && TARJETA_PHONE_DAY_LIMIT.windowSec === 86_400);
});

test("enlace revocado: el que se devuelve lleva la versión vigente", async () => {
  const c = { ...luis, preferences: { __card: { v: 3 } } };
  const m = mundo({ clientes: [c] });
  const r = await buscarTarjeta(m.deps, { shop: SHOP, phone: c.phone });
  assert.equal(r.estado, "encontrada");
  if (r.estado !== "encontrada") return;
  const token = r.ruta.split("/tarjeta/")[1];
  assert.equal(token.split(".")[1], "3");
  assert.deepEqual(await resolveCardToken(m.db as never, SHOP.id, token), { clientId: c.id });
});

test("turista (+E.164): se busca tal como está guardado", async () => {
  const c = { ...luis, id: "cli_ana00001", phone: "+34612345678", name: "Ana" };
  const m = mundo({ clientes: [c] });
  const r = await buscarTarjeta(m.deps, { shop: SHOP, phone: "+34612345678" });
  assert.equal(r.estado, "encontrada");
  assert.equal(m.frenos[0].key, `barber-tarjeta:${SHOP.id}:34612345678`);
});

test("sin barbería o sin teléfono: «no», sin tocar nada", async () => {
  const m = mundo({ clientes: [luis] });
  assert.deepEqual(await buscarTarjeta(m.deps, { shop: { id: "", slug: "x" }, phone: luis.phone }), { estado: "no" });
  assert.deepEqual(await buscarTarjeta(m.deps, { shop: SHOP, phone: "" }), { estado: "no" });
  assert.equal(m.consultas(), 0);
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

// ── El número recordado en el navegador ─────────────────────────────────

test("número recordado: se guarda por barbería y se lee solo si tiene buena forma", () => {
  assert.equal(claveNumeroRecordado("el-corte"), "dcb-mi-tarjeta:el-corte");
  const ida = serializarNumeroRecordado({ iso: "MX", phone: "5512345678" });
  assert.deepEqual(leerNumeroRecordado(ida), { iso: "MX", phone: "5512345678" });
  assert.deepEqual(leerNumeroRecordado('{"iso":"ES","phone":"612345678","extra":"x"}'), { iso: "ES", phone: "612345678" });
  for (const malo of [
    null,
    "",
    "no es json",
    "{}",
    '{"iso":"mx","phone":"5512345678"}',
    '{"iso":"MX","phone":"55-1234"}',
    '{"iso":"MX","phone":"123"}',
    '{"iso":"MX","phone":5512345678}',
    '{"iso":"<script>","phone":"5512345678"}',
    `{"iso":"MX","phone":"${"9".repeat(70)}"}`,
  ]) {
    assert.equal(leerNumeroRecordado(malo), null, String(malo));
  }
});

// ── Lo que ya NO existe ─────────────────────────────────────────────────

test("no queda plantilla de WhatsApp de «Mi tarjeta» en el catálogo (sin costo de Meta)", () => {
  assert.ok(!BARBER_WA_TEMPLATES.some((t) => t.name === "dc_barber_mi_tarjeta" || (t.kind as string) === "starsCardRequest"));
});

test("«Mi tarjeta» no importa WhatsApp ni manda nada", () => {
  const raiz = join(__dirname, "..", "..", "..");
  for (const archivo of [
    "lib/barber/tarjeta-web.ts",
    "lib/barber/tarjeta-web-core.ts",
    "app/api/barber/public/tarjeta/[slug]/route.ts",
    "app/b/[slug]/mi-tarjeta/page.tsx",
    "components/barber/stars/mi-tarjeta-form.tsx",
  ]) {
    const src = readFileSync(join(raiz, archivo), "utf8");
    assert.ok(!/from "@\/lib\/barber\/whatsapp"/.test(src), `${archivo} no debe importar el envío de WhatsApp`);
    assert.ok(!/sendBarber|sendTemplate|after\(/.test(src), `${archivo} no debe mandar ni diferir nada`);
  }
});

test("la ruta contesta sin caché, sin Referer y fuera de buscadores", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "app/api/barber/public/tarjeta/[slug]/route.ts"), "utf8");
  assert.match(src, /"Cache-Control": "private, no-store"/);
  assert.match(src, /"Referrer-Policy": "no-referrer"/);
  assert.match(src, /"X-Robots-Tag": "noindex, nofollow"/);
  assert.match(src, /persistentRateLimit\(req/);
  assert.match(src, /checkBarberCaptcha\(req, body\.captchaToken, BARBER_CAPTCHA_ACTIONS\.starsCard\)/);
});
