// Lo que el bot de WhatsApp sabe de la tienda (ws6-t1, 16-nov). Núcleo puro, sin base.
//   npx tsx --test src/lib/barber/__tests__/bot-productos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_BOT_PRODUCTS_MAX,
  botProductView,
  botPublicBase,
  pickBotProducts,
  type BotStoreProduct,
} from "../bot-productos-core";
import { DEFAULT_BARBER_BOT_SETTINGS, normalizeBotSettings } from "../bot-core";

const p = (id: string, name: string, category: string | null, price: number, available: number, orderable = true): BotStoreProduct => ({
  id,
  name,
  category,
  price,
  available,
  orderable,
});

const tienda: BotStoreProduct[] = [
  p("cera", "Cera mate fijación fuerte", "Cera", 180, 5),
  p("pomada", "Pomada brillo", "Pomada", 210, 0),
  p("shampoo", "Shampoo anticaspa", "Cuidado", 150.5, 2, false),
  p("aceite", "Aceite para barba", "Barba", 199, 3),
];

test("«¿tienen cera?» → la cera (plural, acentos y signos no estorban)", () => {
  for (const q of ["¿tienen cera?", "CERAS", "cera para el pelo", "¿Cuánto cuesta la cera mate?"]) {
    const r = pickBotProducts(tienda, q);
    assert.equal(r.matched, true, q);
    assert.equal(r.products[0].id, "cera", q);
  }
});

test("«¿qué venden?» no nombra producto: los más vendidos primero", () => {
  const ventas = new Map([["aceite", 12], ["shampoo", 3]]);
  const r = pickBotProducts(tienda, "¿qué venden?", ventas);
  assert.equal(r.askedSomething, false);
  assert.deepEqual(r.products.map((x) => x.id), ["aceite", "shampoo", "cera", "pomada"]);
});

test("producto que no existe → no hay coincidencia y la herramienta lo marca (askedSomething && !matched)", () => {
  const r = pickBotProducts(tienda, "¿tienen tinte para canas?");
  assert.equal(r.askedSomething, true);
  assert.equal(r.matched, false);
});

test("tope de productos al modelo: nunca más de BARBER_BOT_PRODUCTS_MAX", () => {
  const muchos = Array.from({ length: 60 }, (_, i) => p(`c${i}`, `Cera número ${i}`, "Cera", 100 + i, 1));
  assert.equal(pickBotProducts(muchos, "cera").products.length, BARBER_BOT_PRODUCTS_MAX);
  assert.equal(pickBotProducts(muchos, "").products.length, BARBER_BOT_PRODUCTS_MAX);
  assert.equal(pickBotProducts(muchos, "").total, 60);
});

test("lo que ve el modelo: precio y si hay; NUNCA cuántas piezas ni el costo; agotado sin liga", () => {
  const conCosto = { ...tienda[0], cost: 90, stock: 7 } as BotStoreProduct;
  const v = botProductView(conCosto, "https://x/b/s/tienda/cera");
  assert.deepEqual(v, {
    nombre: "Cera mate fijación fuerte",
    categoria: "Cera",
    precio: "$180",
    hay: true,
    liga: "https://x/b/s/tienda/cera",
    seApartaEnLinea: true,
  });
  const texto = JSON.stringify(v);
  assert.doesNotMatch(texto, /\b5\b|\b7\b|\b90\b|available|stock|cost/);

  const agotado = botProductView(tienda[1], "https://x/b/s/tienda/pomada");
  assert.equal(agotado.hay, false);
  assert.equal(agotado.liga, null);
  assert.equal(agotado.seApartaEnLinea, false);

  // Hay, pero el producto no se aparta en línea: liga para verlo, se compra en la barbería.
  const soloVer = botProductView(tienda[2], "https://x/b/s/tienda/shampoo");
  assert.equal(soloVer.liga, "https://x/b/s/tienda/shampoo");
  assert.equal(soloVer.seApartaEnLinea, false);
  assert.equal(soloVer.precio, "$150.50");
});

test("ligas absolutas: la URL pública de la app, o dalecontrol.com", () => {
  assert.equal(botPublicBase({ NEXT_PUBLIC_APP_URL: "https://www.dalecontrol.com/" }), "https://www.dalecontrol.com");
  assert.equal(botPublicBase({ VERCEL_URL: "x.vercel.app" }), "https://x.vercel.app");
  assert.equal(botPublicBase({}), "https://www.dalecontrol.com");
});

test("interruptor «productos»: encendido por omisión, también en configuraciones guardadas antes", () => {
  assert.equal(DEFAULT_BARBER_BOT_SETTINGS.abilities.productos, true);
  // Una configuración vieja (sin la llave) lo trae encendido; apagado se respeta.
  const vieja = normalizeBotSettings({ enabled: true, abilities: { agendar: true, precios: true } });
  assert.equal(vieja.abilities.productos, true);
  const apagado = normalizeBotSettings({ abilities: { productos: false } });
  assert.equal(apagado.abilities.productos, false);
});
