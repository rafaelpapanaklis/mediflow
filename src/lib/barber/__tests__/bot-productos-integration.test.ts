// EL BOT DE WHATSAPP CONOCE LA TIENDA (ws6-t1, 16-nov-2026) contra Postgres REAL.
//
// Rafael: «¿ya tiene acceso el bot de WhatsApp para mandar los productos?».
// Lo REAL: la base, la tienda (loadTienda: activos + «Mostrar en mi página»,
// existencia − apartado), la ingesta del webhook y el bot. Lo SIMULADO: Meta y
// el modelo (guionado con _wa-arnes): lo que el «modelo» lee sale de la base.
//
// Necesita sql/barber_agenda.sql, barber_bot.sql, barber_caja.sql y
// barber_tienda.sql cargados en una base LOCAL:
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/bot-productos-integration.test.ts
import {
  borrarTodo,
  crearTienda,
  entrante,
  enviados,
  instalarFetch,
  limpiar,
  modelQueue,
  modelRequests,
  prisma,
  restaurarFetch,
  say,
  skip,
  telefono,
  toolResults,
  useTool,
  BASE_LOCAL,
  type Tienda,
} from "./_wa-arnes";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ingestBarberInbound } from "../whatsapp";
import { resetBarberBotStoreCache, saveBarberBotSettings } from "../bot";
import { BARBER_BOT_PRODUCTS_MAX } from "../bot-productos-core";

const BOT_ON = { enabled: true, aiDailyCapMxn: 50, hours: { mode: "always" } };
const BASE = "https://app.prueba.dalecontrol.com";

let T: Tienda; // con tienda
let VACIA: Tienda; // sin productos en la web (solo uno oculto)
let slug = "";
const ids: Record<string, string> = {};

async function producto(
  t: Tienda,
  key: string,
  data: { name: string; category: string; price: number; stock: number; showOnWeb?: boolean; isActive?: boolean; cost?: number },
) {
  const row = await prisma.barberProduct.create({
    data: {
      barbershopId: t.id,
      name: data.name,
      price: data.price,
      cost: data.cost ?? 37,
      stock: data.stock,
      isActive: data.isActive !== false,
    },
  });
  // Las columnas de la tienda las crea sql/barber_tienda.sql (no están en el modelo).
  await prisma.$executeRaw`
    UPDATE "barber_products"
    SET "category" = ${data.category}, "showOnWeb" = ${data.showOnWeb !== false}, "onlineOrder" = true
    WHERE "id" = ${row.id}`;
  ids[key] = row.id;
  return row.id;
}

/** Un apartado vivo (sin pagar, recién hecho) de `qty` piezas: baja lo disponible, no el stock. */
async function apartar(t: Tienda, productId: string, qty: number) {
  await prisma.$executeRaw`
    INSERT INTO "barber_product_orders"
      ("id", "barbershop_id", "branch_id", "folio", "client_name", "client_phone", "items", "total", "status")
    VALUES (${randomUUID()}, ${t.id}, ${t.id}, ${`F${Math.floor(Math.random() * 1e5)}`}, 'Alguien', '5500000000',
            ${JSON.stringify([{ productId, name: "x", unitPrice: 1, qty }])}::jsonb, 1, 'PENDING')`;
}

before(async () => {
  if (!BASE_LOCAL) return;
  process.env.BARBER_ANTHROPIC_API_KEY = "sk-prueba-guionada";
  process.env.NEXT_PUBLIC_APP_URL = BASE;
  delete process.env.BARBER_BOT_AI_MODEL;
  delete process.env.BARBER_BOT_AI_THINKING;
  instalarFetch();

  T = await crearTienda({ name: "Barbería La Navaja", plan: "PROFESIONAL" });
  slug = (await prisma.barbershop.findUniqueOrThrow({ where: { id: T.id }, select: { slug: true } })).slug;
  await saveBarberBotSettings(T.id, BOT_ON);
  await producto(T, "cera", { name: "Cera mate fijación fuerte", category: "Cera", price: 180, stock: 5, cost: 91 });
  await producto(T, "pomada", { name: "Pomada brillo", category: "Pomada", price: 210, stock: 2 });
  await apartar(T, ids.pomada, 2); // las 2 piezas ya están apartadas → agotada para la tienda
  await producto(T, "oculto", { name: "Cera secreta del dueño", category: "Cera", price: 99, stock: 9, showOnWeb: false });
  await producto(T, "baja", { name: "Cera descontinuada", category: "Cera", price: 50, stock: 9, isActive: false });

  VACIA = await crearTienda({ name: "Barbería Sin Tienda", plan: "PROFESIONAL" });
  await saveBarberBotSettings(VACIA.id, BOT_ON);
  await producto(VACIA, "vacia-oculto", { name: "Cera oculta", category: "Cera", price: 120, stock: 3, showOnWeb: false });
});

after(async () => {
  restaurarFetch();
  if (!BASE_LOCAL) return;
  await borrarTodo(); // la barbería se borra con sus productos y apartados (ON DELETE CASCADE)
});

beforeEach(() => {
  limpiar();
  resetBarberBotStoreCache();
});

async function escribe(t: Tienda, phone: string, texto: string) {
  const { value, msg } = entrante(t, phone, texto);
  return ingestBarberInbound(value, msg);
}
const ultimoEnvio = () => enviados()[enviados().length - 1];
const resultadoProductos = () => toolResults.filter((r) => r && Array.isArray(r.productos)).pop();
const herramientas = (i = 0) => (modelRequests[i]?.raw?.tools ?? []).map((x: { name: string }) => x.name);

test("🔴 «¿tienen cera?» → precio, que sí hay y la liga del producto (sin existencias ni costo)", { skip }, async () => {
  const phone = telefono();
  modelQueue.push(useTool("buscar_productos", { texto: "cera" }));
  modelQueue.push((seen) => {
    const r = seen[seen.length - 1];
    const c = r.productos[0];
    return say(`Sí tenemos ${c.nombre} en ${c.precio}. Apártala aquí: ${c.liga}`);
  });
  await escribe(T, phone, "¿tienen cera?");

  assert.ok(herramientas().includes("buscar_productos"), "con productos en la web, el bot tiene la herramienta");
  assert.match(modelRequests[0].system, /PRODUCTOS DE LA TIENDA/);

  const r = resultadoProductos();
  assert.ok(r, "el modelo recibió la lista de la tienda");
  const nombres = r.productos.map((p: { nombre: string }) => p.nombre);
  assert.equal(nombres[0], "Cera mate fijación fuerte");
  assert.ok(!nombres.includes("Cera secreta del dueño"), "lo oculto («Mostrar en mi página» apagado) no existe para el bot");
  assert.ok(!nombres.includes("Cera descontinuada"), "lo inactivo tampoco");
  const cera = r.productos[0];
  assert.equal(cera.precio, "$180", "el precio sale de la base");
  assert.equal(cera.hay, true);
  assert.equal(cera.liga, `${BASE}/b/${slug}/tienda/${ids.cera}`, "liga absoluta al producto de la tienda pública");
  assert.equal(r.ligaTienda, `${BASE}/b/${slug}/tienda`);
  const crudo = JSON.stringify(r);
  assert.doesNotMatch(crudo, /stock|available|cost|costo|"91"|\$91/, "nunca existencias exactas ni costo");
  assert.doesNotMatch(crudo, /"5"|: ?5[,}]/, "el número de piezas (5) no viaja");

  const envio = ultimoEnvio();
  assert.equal(envio.body.type, "text");
  assert.match(envio.body.text.body, new RegExp(`${BASE}/b/${slug}/tienda/${ids.cera}`), "al cliente le llega la liga");
});

test("agotado (todo apartado): lo dice y NO hay liga de apartar", { skip }, async () => {
  const phone = telefono();
  modelQueue.push(useTool("buscar_productos", { texto: "pomada" }));
  modelQueue.push((seen) => {
    const p = seen[seen.length - 1].productos[0];
    return say(p.hay ? `Hay ${p.nombre}: ${p.liga}` : `La ${p.nombre} se nos agotó, en cuanto llegue te aviso.`);
  });
  await escribe(T, phone, "¿cuánto cuesta la pomada?");

  const p = resultadoProductos().productos[0];
  assert.equal(p.nombre, "Pomada brillo");
  assert.equal(p.hay, false, "stock 2 − apartado 2 = agotado para la tienda");
  assert.equal(p.liga, null, "agotado no lleva liga de apartar");
  assert.equal(p.seApartaEnLinea, false);
  assert.match(ultimoEnvio().body.text.body, /se nos agotó/);
  assert.doesNotMatch(ultimoEnvio().body.text.body, /\/tienda\//);
});

test("🔴 producto que no existe: la herramienta no inventa nada y avisa; el bot dice que no lo manejan", { skip }, async () => {
  const phone = telefono();
  modelQueue.push(useTool("buscar_productos", { texto: "tinte para canas" }));
  modelQueue.push((seen) => {
    const r = seen[seen.length - 1];
    return say(r.nota ? "Tinte para canas no lo manejamos, una disculpa." : `Sí: ${r.productos[0].nombre}`);
  });
  await escribe(T, phone, "¿venden tinte para canas?");

  const r = resultadoProductos();
  assert.ok(r.nota, "la herramienta marca que nada coincide");
  assert.match(r.nota, /no lo manejan/);
  assert.ok(
    r.productos.every((p: { nombre: string }) => !/tinte/i.test(p.nombre)),
    "no aparece ningún «tinte»: solo lo que de verdad hay",
  );
  assert.match(ultimoEnvio().body.text.body, /no lo manejamos/);
  assert.match(modelRequests[0].system, /Nunca inventes un producto ni un precio/);
});

test("sin productos en la web: el bot ni tiene la herramienta ni habla de tienda (contesta como hoy)", { skip }, async () => {
  const phone = telefono();
  modelQueue.push(say("Por ahora solo cortes y barba. ¿Te agendo?"));
  await escribe(VACIA, phone, "¿tienen cera?");
  assert.ok(!herramientas().includes("buscar_productos"));
  assert.doesNotMatch(modelRequests[0].system, /PRODUCTOS DE LA TIENDA/);
  assert.doesNotMatch(modelRequests[0].system, /productos/i, "ni lo menciona en «lo que no puedes hacer»");
});

test("interruptor «Contestar sobre productos» apagado: sin herramienta ni reglas de tienda", { skip }, async () => {
  await saveBarberBotSettings(T.id, { ...BOT_ON, abilities: { productos: false } });
  try {
    const phone = telefono();
    modelQueue.push(say("Eso pregúntalo en la barbería."));
    await escribe(T, phone, "¿tienen cera?");
    assert.ok(!herramientas().includes("buscar_productos"));
    assert.doesNotMatch(modelRequests[0].system, /PRODUCTOS DE LA TIENDA/);
  } finally {
    await saveBarberBotSettings(T.id, { ...BOT_ON, abilities: { productos: true } });
  }
});

test("tope: aunque la tienda tenga 30 productos, al modelo van como mucho BARBER_BOT_PRODUCTS_MAX", { skip }, async () => {
  const MUCHA = await crearTienda({ name: "Barbería Surtida", plan: "PROFESIONAL" });
  await saveBarberBotSettings(MUCHA.id, BOT_ON);
  for (let i = 0; i < 30; i++) {
    await producto(MUCHA, `m${i}`, { name: `Cera número ${i}`, category: "Cera", price: 100 + i, stock: 3 });
  }
  const phone = telefono();
  modelQueue.push(useTool("buscar_productos", { texto: "" }));
  modelQueue.push((seen) => say(`Tenemos varias, míralas aquí: ${seen[seen.length - 1].ligaTienda}`));
  await escribe(MUCHA, phone, "¿qué venden?");
  const r = resultadoProductos();
  assert.equal(r.productos.length, BARBER_BOT_PRODUCTS_MAX);
  assert.equal(r.totalEnTienda, 30);
  assert.match(ultimoEnvio().body.text.body, /\/tienda$/);
});
