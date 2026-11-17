// «ENTRÓ UN PEDIDO» y «SE PAGÓ EN LÍNEA»: los DOS únicos momentos desde los
// que se le avisa al dueño (ws6-t6, 16-nov-2026).
//
// 1.ª parte: se dejó el enganche preparado y apagado. 2.ª parte (Rafael: «haz
// el 1, 2, 3 y 4»): ya avisa — el correo y el WhatsApp viven en
// pedido-avisos.ts. Aquí se vigila el enganche:
//   · lo llama solo la ruta que crea el pedido (una vez, después de guardarlo)
//     y el webhook de Mercado Pago (solo si el pago se aplicó);
//   · corre DESPUÉS de responder y nunca tumba el pedido aunque el aviso falle;
//   · en las pruebas el avisador es un doble: no sale nada real.
//
//   npx tsx --test src/lib/barber/__tests__/pedido-nuevo.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import Module from "node:module";

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);
const leer = (rel: string) => readFileSync(abs(rel), "utf8");

/** El avisador de verdad (pedido-avisos.ts), doblado: apunta y no manda. */
const avisados: Array<[string, string]> = [];
const DOUBLES = new Map<string, unknown>([
  [
    abs("src/lib/barber/pedido-avisos.ts"),
    {
      __esModule: true,
      notifyOwnerOfOrder: async (kind: string, orderId: string) => {
        avisados.push([kind, orderId]);
        return { ran: true, channels: [] };
      },
    },
  ],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
let hook: typeof import("@/lib/barber/tienda-pedido-nuevo");

before(async () => {
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    try {
      const resolved = M._resolveFilename(request, parent);
      if (DOUBLES.has(resolved)) return DOUBLES.get(resolved);
    } catch {
      /* que lo resuelva el cargador original */
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  hook = await import("@/lib/barber/tienda-pedido-nuevo");
});
after(() => {
  M._load = originalLoad;
});
beforeEach(() => {
  avisados.length = 0;
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
const unMomento = () => new Promise((r) => setTimeout(r, 15));

test("pedido nuevo → se avisa UNA vez, con el motivo NEW y el id del pedido", async () => {
  const r = await hook.onTiendaOrderCreated(evento());
  assert.deepEqual(avisados, [["NEW", "ped-1"]]);
  assert.deepEqual(r, { ran: true, channels: [] });
});

test("pago en línea confirmado → se avisa con el motivo PAID", async () => {
  await hook.onTiendaOrderPaid("ped-1");
  assert.deepEqual(avisados, [["PAID", "ped-1"]]);
});

test("si el avisador revienta, el pedido del cliente no se entera: no lanza", async () => {
  const roto = async () => {
    throw new Error("el proveedor no contesta");
  };
  const a = await sinRuido(() => hook.onTiendaOrderCreated(evento(), roto));
  assert.deepEqual(a.valor, { ran: false, reason: "error", channels: [] });
  assert.match(a.avisos[0], /NEW ped-1.*el proveedor no contesta/);
  const b = await sinRuido(() => hook.onTiendaOrderPaid("ped-1", roto));
  assert.equal(b.valor.ran, false);
});

test("sin id de pedido no se avisa nada", async () => {
  assert.deepEqual(await hook.onTiendaOrderPaid(""), { ran: false, reason: "sin_pedido", channels: [] });
  assert.equal((await hook.onTiendaOrderCreated({ ...evento(), orderId: "" })).ran, false);
  assert.equal(avisados.length, 0);
});

test("afterResponse: la tarea corre sin que quien llama la espere, y un fallo no se escapa", async () => {
  let corrio = false;
  // No lanza ni devuelve promesa: la ruta responde sin esperar.
  assert.equal(hook.afterResponse(async () => void (corrio = true)), undefined);
  await unMomento();
  assert.equal(corrio, true);

  const rechazos: unknown[] = [];
  const onRechazo = (e: unknown) => rechazos.push(e);
  process.on("unhandledRejection", onRechazo);
  try {
    const { avisos } = await sinRuido(async () => {
      hook.afterResponse(async () => {
        throw new Error("correo caído");
      });
      await unMomento();
    });
    assert.match(avisos[0], /correo caído/);
    assert.deepEqual(rechazos, [], "ninguna promesa rechazada suelta");
  } finally {
    process.off("unhandledRejection", onRechazo);
  }
});

test("el enganche no manda nada por su cuenta: delega en pedido-avisos y no importa mensajeros", () => {
  const src = leer("src/lib/barber/tienda-pedido-nuevo.ts");
  const imports = src.split("\n").filter((l) => /^import /.test(l));
  assert.deepEqual(imports, [
    'import "server-only";',
    'import * as nextServer from "next/server";',
    'import type { OrderItem } from "@/lib/barber/tienda-core";',
    'import type { OrderNoticeKind } from "@/lib/barber/pedido-avisos-core";',
    'import { notifyOwnerOfOrder, type OrderNoticeResult } from "@/lib/barber/pedido-avisos";',
  ]);
  // Solo el CÓDIGO (los comentarios sí explican qué se manda).
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /\bfetch\(|resend|nodemailer|sendgrid|sendMail|sendEmail\(|graph\.facebook|prisma/i);
});

test("lo llaman SOLO la ruta que crea el pedido (una vez, después de guardarlo) y el webhook de pago", () => {
  const ruta = leer("src/app/api/barber/public/tienda/[slug]/pedidos/route.ts");
  const crear = ruta.indexOf("await createTiendaOrder(");
  const aviso = ruta.indexOf("afterResponse(() => onTiendaOrderCreated(");
  const respuesta = ruta.indexOf("folioUrl:");
  assert.ok(crear > 0 && aviso > crear && respuesta > aviso, "crear → programar el aviso → responder");
  assert.equal(ruta.split("onTiendaOrderCreated(").length - 1, 1);
  // El campo trampa (bots) y los rechazos salen ANTES: un pedido que no se guardó no avisa.
  assert.ok(ruta.indexOf("body.website") < crear);

  // En todo src/ nadie más los llama, y nadie más inserta pedidos.
  const creado: string[] = [];
  const pagado: string[] = [];
  const insertan: string[] = [];
  const andar = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const p = path.join(dir, nombre);
      if (statSync(p).isDirectory()) {
        if (nombre !== "node_modules" && nombre !== "__tests__") andar(p);
      } else if (/\.(ts|tsx)$/.test(nombre)) {
        const txt = readFileSync(p, "utf8");
        const rel = path.relative(ROOT, p);
        if (rel.endsWith("tienda-pedido-nuevo.ts")) continue;
        if (/onTiendaOrderCreated\(/.test(txt)) creado.push(rel);
        if (/onTiendaOrderPaid\(/.test(txt)) pagado.push(rel);
        if (/INSERT INTO "barber_product_orders"/.test(txt)) insertan.push(rel);
      }
    }
  };
  andar(path.join(ROOT, "src"));
  assert.deepEqual(creado, ["src/app/api/barber/public/tienda/[slug]/pedidos/route.ts"]);
  assert.deepEqual(pagado, ["src/app/api/barber/mercadopago/webhook/route.ts"]);
  assert.deepEqual(insertan, ["src/lib/barber/tienda.ts"], "los pedidos nacen en un solo sitio (createTiendaOrder)");
  assert.equal(leer("src/lib/barber/tienda.ts").split("createTiendaOrder(").length - 1, 1, "y createTiendaOrder solo se define ahí");
});
