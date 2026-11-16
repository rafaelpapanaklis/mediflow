/* ═════════════════════════════════════════════════════════════════════
   INICIO · «N pedidos de la tienda por atender» (ws6-t6, 16-nov-2026).

   Rafael: «el apartado y pagar en tienda de un producto, ¿dónde le llega
   al dueño?». Además del numerito del menú, Inicio enseña una tarjeta con
   los 3 más recientes (folio, cliente, total y «Pagado en línea» / «Paga
   en barbería») y un botón «Ver pedidos» → Productos?tab=pedidos. Sin
   pedidos por atender no sale nada.

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/dashboard/__tests__/pedidos-card.test.tsx

   Sin base de datos y sin navegador: es un componente puro.
   ═════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type { OrdersNotice } from "@/lib/barber/tienda-avisos";
import { PEDIDOS_HREF, PedidosCard } from "../pedidos-card";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const pintar = (notice: OrdersNotice | null | undefined, locale: "es" | "en" = "es") =>
  renderToStaticMarkup(<PedidosCard notice={notice} t={getBarberT(locale)} />);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const pedido = (n: number, extra: Partial<OrdersNotice["recent"][number]> = {}): OrdersNotice["recent"][number] => ({
  id: `id-${n}`,
  folio: `F${n}K2Q`,
  clientName: `Cliente ${n}`,
  total: 100 * n + 49.5,
  paidOnline: false,
  status: "PENDING",
  createdAt: `2026-11-16T1${n}:00:00.000Z`,
  ...extra,
});

test("sin pedidos por atender no se pinta NADA (ni tarjeta vacía)", () => {
  assert.equal(pintar(null), "");
  assert.equal(pintar(undefined), "");
  assert.equal(pintar({ count: 0, recent: [] }), "");
});

test("con pedidos: el título dice cuántos y cada renglón trae folio, cliente, total y cómo paga", () => {
  const html = pintar({
    count: 5,
    recent: [pedido(3, { paidOnline: true, status: "PAID_ONLINE" }), pedido(2), pedido(1, { paidOnline: true, status: "READY" })],
  });
  const t = texto(html);
  assert.match(t, /^5 pedidos de la tienda por atender/);
  assert.match(t, /F3K2Q Cliente 3 Pagado en línea \$349\.50/);
  assert.match(t, /F2K2Q Cliente 2 Paga en barbería \$249\.50/);
  // Pagado y ya «Listo»: sigue en la lista hasta entregarlo, y lo dice.
  assert.match(t, /F1K2Q Cliente 1 Pagado en línea · listo, falta entregarlo \$149\.50/);
  assert.equal((html.match(/<li /g) ?? []).length, 3);
  assert.match(t, /y 2 más/, "hay 5 y se enseñan 3");
  assert.match(html, /data-pedidos-por-atender="5"/);
});

test("un solo botón, «Ver pedidos», que lleva a Productos ya en la pestaña Pedidos", () => {
  const html = pintar({ count: 2, recent: [pedido(2), pedido(1)] });
  const ligas = html.match(/<a [^>]*>/g) ?? [];
  assert.equal(ligas.length, 1, "un solo destino: un solo alto de tabulador");
  assert.match(ligas[0], /href="\/barber\/productos\?tab=pedidos"/);
  assert.equal(PEDIDOS_HREF, "/barber/productos?tab=pedidos");
  assert.match(html, />Ver pedidos<\/a>/);
  // Y Productos de verdad abre esa pestaña con ?tab=pedidos.
  assert.match(leer("src/app/barber/(panel)/productos/page.tsx"), /initialTab: searchParams\.tab === "pedidos" \? "orders" : "catalog"/);
});

test("singular, y sin «y N más» cuando caben todos", () => {
  const t = texto(pintar({ count: 1, recent: [pedido(1)] }));
  assert.match(t, /^1 pedido de la tienda por atender/);
  assert.doesNotMatch(t, /más\b/);
  assert.match(t, /Salen de aquí en cuanto los atiendes\./);
});

test("la lista tiene nombre para el lector de pantalla y el pago no depende solo del color", () => {
  const html = pintar({ count: 2, recent: [pedido(2, { paidOnline: true, status: "PAID_ONLINE" }), pedido(1)] });
  assert.match(html, /<ul class="bdash-upcoming bdash-orders" aria-label="Los pedidos más recientes">/);
  assert.match(html, /bdash-orders__pay bdash-orders__pay--paid">Pagado en línea</);
  assert.match(html, /bdash-orders__pay">Paga en barbería</);
});

test("un nombre con símbolos se pinta como texto, no como HTML", () => {
  const html = pintar({ count: 1, recent: [pedido(1, { clientName: "<b>Ana</b> & Luis" })] });
  assert.doesNotMatch(html, /<b>Ana/);
  assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt; &amp; Luis/);
});

test("en inglés, todo traducido (ninguna llave cruda)", () => {
  const html = pintar({ count: 4, recent: [pedido(2, { paidOnline: true, status: "READY" }), pedido(1)] }, "en");
  const t = texto(html);
  assert.match(t, /^4 shop orders to handle/);
  assert.match(t, /Paid online · ready, not handed over yet/);
  assert.match(t, /Pays at the shop/);
  assert.match(t, /and 2 more/);
  assert.match(html, />View orders<\/a>/);
  assert.doesNotMatch(t, /barber\.inicio/);
  assert.match(texto(pintar({ count: 1, recent: [pedido(1)] }, "en")), /^1 shop order to handle/);
});

test("Inicio la pone arriba de la primera columna y la página la carga con la regla única", () => {
  const vista = leer("src/components/barber/dashboard/inicio-view.tsx");
  const columna = vista.indexOf('<div className="bdash-stack">');
  const tarjeta = vista.indexOf("<PedidosCard notice={shopOrders} t={t} />");
  const visitas = vista.indexOf('title={k("visits.title")}');
  assert.ok(columna > 0 && tarjeta > columna && tarjeta < visitas, "va antes de «Visitas de hoy»");
  const pagina = leer("src/app/barber/(panel)/inicio/page.tsx");
  assert.match(pagina, /const shopOrders = await loadOrdersNotice\(ctx, plan\.features\);/);
  assert.match(pagina, /shopOrders=\{shopOrders\}/);
});

test("estilos: solo tokens del tema (ni un color escrito a mano) y nada que se parta a 390 px", () => {
  const css = leer("src/components/barber/dashboard/dashboard.css");
  const bloque = css.slice(css.indexOf("Pedidos de la tienda por atender (16-nov)"));
  assert.ok(bloque.length > 100);
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "solo var(--…)");
  assert.match(bloque, /\.bdash-orders__folio \{[^}]*white-space: nowrap/);
  assert.match(bloque, /\.bdash-orders__pay--paid \{ color: var\(--success\); \}/);
  // El total reutiliza .bdash-row__n (nowrap) y el nombre .bdash-row__name (se recorta con «…»).
  assert.match(css, /\.bdash-row__n \{[^}]*white-space: nowrap/);
  assert.match(css, /\.bdash-row__name \{[^}]*text-overflow: ellipsis/);
});
