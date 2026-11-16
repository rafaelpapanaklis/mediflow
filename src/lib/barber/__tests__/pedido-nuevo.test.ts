// «ENTRÓ UN PEDIDO NUEVO»: el punto único, preparado y APAGADO (ws6-t6, 16-nov-2026).
//
// Rafael todavía no decide si al dueño se le manda un correo por cada pedido
// de la tienda. Se deja el enganche en UN solo sitio y se vigila que:
//   · hoy no mande NADA (ni correo ni WhatsApp), y el interruptor esté apagado;
//   · nunca tumbe el pedido del cliente, aunque un canal falle;
//   · lo llame solo la ruta que crea el pedido, una vez, después de guardarlo.
//
//   npx tsx --test src/lib/barber/__tests__/pedido-nuevo.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import Module from "node:module";

const ROOT = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = M._load;
let hook: typeof import("@/lib/barber/tienda-pedido-nuevo");

before(async () => {
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  hook = await import("@/lib/barber/tienda-pedido-nuevo");
});
after(() => {
  M._load = originalLoad;
});

const evento = () => ({
  orderId: "ped-1",
  folio: "K7M2Q",
  barbershopId: "sede-centro",
  shopSlug: "barberia-prueba",
  shopName: "Barbería Prueba",
  branchName: null,
  clientName: "Luis Ramírez",
  clientPhone: "9991234567",
  items: [{ productId: "p1", name: "Cera", unitPrice: 149.99, qty: 2 }],
  total: 299.98,
  payOnline: false,
  expiresAt: "2026-11-19T18:00:00.000Z",
});

/** Calla console.warn y devuelve lo que se habría escrito. */
async function sinRuido<T>(fn: () => Promise<T>): Promise<{ valor: T; avisos: string[] }> {
  const original = console.warn;
  const avisos: string[] = [];
  console.warn = (...a: unknown[]) => void avisos.push(a.map(String).join(" "));
  try {
    return { valor: await fn(), avisos };
  } finally {
    console.warn = original;
  }
}

test("hoy NO manda nada: el interruptor del correo está apagado y ningún canal avisa", async () => {
  assert.equal(hook.TIENDA_OWNER_EMAIL_ENABLED, false, "encenderlo es decisión de Rafael");
  assert.deepEqual(hook.ORDER_NOTICE_CHANNELS.map((c) => c.name), ["correo-dueno"]);
  assert.equal(hook.ORDER_NOTICE_CHANNELS.every((c) => c.enabled() === false), true);
  const { valor, avisos } = await sinRuido(() => hook.onTiendaOrderCreated(evento()));
  assert.deepEqual(valor, { sent: [] });
  assert.deepEqual(avisos, [], "apagado no es un fallo: ni un aviso en el log");
});

test("un canal apagado ni se llama; uno encendido recibe el pedido tal cual, una vez", async () => {
  const llamadas: string[] = [];
  const canales = [
    { name: "apagado", enabled: () => false, send: async () => void llamadas.push("apagado") },
    { name: "prueba", enabled: () => true, send: async (ev: ReturnType<typeof evento>) => void llamadas.push(`${ev.folio}:${ev.barbershopId}:${ev.total}`) },
  ];
  const r = await hook.onTiendaOrderCreated(evento(), canales);
  assert.deepEqual(r, { sent: ["prueba"] });
  assert.deepEqual(llamadas, ["K7M2Q:sede-centro:299.98"]);
});

test("si un canal falla, el pedido del cliente no se entera: no lanza y los demás canales siguen", async () => {
  const canales = [
    { name: "roto", enabled: () => true, send: async () => { throw new Error("el proveedor no contesta"); } },
    { name: "roto-al-preguntar", enabled: () => { throw new Error("config rota"); }, send: async () => undefined },
    { name: "bueno", enabled: () => true, send: async () => undefined },
  ];
  const { valor, avisos } = await sinRuido(() => hook.onTiendaOrderCreated(evento(), canales));
  assert.deepEqual(valor, { sent: ["bueno"] });
  assert.equal(avisos.length, 2);
  assert.match(avisos[0], /roto.*el proveedor no contesta/);
});

test("encender el interruptor sin escribir el correo no manda nada a medias: falla en el log y sigue", async () => {
  const forzado = hook.ORDER_NOTICE_CHANNELS.map((c) => ({ ...c, enabled: () => true }));
  const { valor, avisos } = await sinRuido(() => hook.onTiendaOrderCreated(evento(), forzado));
  assert.deepEqual(valor, { sent: [] });
  assert.match(avisos[0], /correo-dueno.*sin implementar/);
});

test("el archivo no importa ningún mensajero (correo, WhatsApp, push) ni la base", () => {
  const src = leer("src/lib/barber/tienda-pedido-nuevo.ts");
  const imports = src.split("\n").filter((l) => /^import /.test(l));
  assert.deepEqual(imports, ['import "server-only";', 'import type { OrderItem } from "@/lib/barber/tienda-core";']);
  // Solo el CÓDIGO (los comentarios sí explican qué se podría mandar algún día).
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /\bfetch\(|resend|nodemailer|sendgrid|sendMail|sendEmail\(|whatsapp|prisma/i);
});

test("lo llama SOLO la ruta que crea el pedido, una vez y después de guardarlo", () => {
  const ruta = leer("src/app/api/barber/public/tienda/[slug]/pedidos/route.ts");
  const crear = ruta.indexOf("await createTiendaOrder(");
  const aviso = ruta.indexOf("await onTiendaOrderCreated(");
  const respuesta = ruta.indexOf("folioUrl:");
  assert.ok(crear > 0 && aviso > crear && respuesta > aviso, "crear → avisar → responder");
  assert.equal(ruta.split("onTiendaOrderCreated(").length - 1, 1);
  // El campo trampa (bots) y los rechazos salen ANTES: un pedido que no se guardó no avisa.
  assert.ok(ruta.indexOf("body.website") < crear);

  // En todo src/ nadie más lo llama, y nadie más inserta pedidos.
  const llamadores: string[] = [];
  const insertan: string[] = [];
  const andar = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const p = path.join(dir, nombre);
      if (statSync(p).isDirectory()) {
        if (nombre !== "node_modules" && nombre !== "__tests__") andar(p);
      } else if (/\.(ts|tsx)$/.test(nombre)) {
        const txt = readFileSync(p, "utf8");
        const rel = path.relative(ROOT, p);
        if (/onTiendaOrderCreated\(/.test(txt) && !rel.endsWith("tienda-pedido-nuevo.ts")) llamadores.push(rel);
        if (/INSERT INTO "barber_product_orders"/.test(txt)) insertan.push(rel);
      }
    }
  };
  andar(path.join(ROOT, "src"));
  assert.deepEqual(llamadores, ["src/app/api/barber/public/tienda/[slug]/pedidos/route.ts"]);
  assert.deepEqual(insertan, ["src/lib/barber/tienda.ts"], "los pedidos nacen en un solo sitio (createTiendaOrder)");
  assert.equal(leer("src/lib/barber/tienda.ts").split("createTiendaOrder(").length - 1, 1, "y createTiendaOrder solo se define ahí");
});
