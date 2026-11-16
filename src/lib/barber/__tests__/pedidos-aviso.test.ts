// QUE EL DUEÑO SE ENTERE DE LOS PEDIDOS DE LA TIENDA (ws6-t6, 16-nov-2026).
//
// Rafael: «el apartado y pagar en tienda de un producto, ¿dónde le llega al
// dueño?». Solo caía en Productos → «Pedidos» y nadie avisaba.
//
//   1. La regla de «por atender» es UNA (tienda-core.ts): nuevos sin atender
//      + pagados en línea sin entregar. La usan la pestaña, el menú e Inicio.
//   2. El número del menú: solo con products.view y un plan con productos,
//      por la sede en sesión, 0 sin la tabla de pedidos, y NUNCA truena.
//   3. El menú lo pinta junto a «Productos», lo pide a la ruta nueva al
//      navegar y cada minuto, y la pestaña se lo pasa al recargar su lista.
//
//   npx tsx --test src/lib/barber/__tests__/pedidos-aviso.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Module from "node:module";
import type { BarberContext } from "@/lib/barber-auth";
import { BARBER_NO_PERMISSIONS } from "@/lib/barber/permissions";
import { getBarberT } from "@/i18n/dictionaries/barber";
import {
  ORDER_ACTION_COUNTS_PAID_READY,
  ORDER_NOTICE_RECENT,
  PRODUCT_ORDER_STATUSES,
  TIENDA_HOLD_HOURS,
  countOrdersNeedingAction,
  orderNeedsAction,
  recentOrdersNeedingAction,
  resetTiendaReadyCache,
} from "@/lib/barber/tienda-core";
import {
  PEDIDOS_POR_ATENDER_CADA_MS,
  PEDIDOS_POR_ATENDER_URL,
  leerContador,
  textoContador,
} from "@/components/barber/products/pedidos-aviso";

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);
const leer = (rel: string) => readFileSync(abs(rel), "utf8");

// ── Una base de mentira: apunta lo que se le pregunta y contesta lo que se le diga ──
interface Pregunta {
  sql: string;
  valores: unknown[];
}
const base = {
  tabla: true,
  cuenta: 0,
  filas: [] as Array<Record<string, unknown>>,
  truena: false,
  preguntas: [] as Pregunta[],
};
const fakeDb = {
  $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    base.preguntas.push({ sql, valores });
    if (sql.includes("to_regclass")) return [{ n: 5, t: base.tabla }];
    if (base.truena) throw new Error("la base no contesta");
    if (sql.includes("COUNT(*)")) return [{ n: base.cuenta }];
    return base.filas;
  },
};
const sobrePedidos = () => base.preguntas.filter((p) => p.sql.includes("barber_product_orders") && !p.sql.includes("to_regclass"));

let features: Record<string, boolean> = { products: true };
const DOUBLES = new Map<string, unknown>([
  [abs("src/lib/prisma.ts"), { __esModule: true, prisma: fakeDb }],
  [abs("src/lib/barber/plans.ts"), { __esModule: true, getBarberPlan: async () => ({ features }) }],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
let avisos: typeof import("@/lib/barber/tienda-avisos");

before(async () => {
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only" || request === "client-only") return {};
    try {
      const resolved = M._resolveFilename(request, parent);
      if (DOUBLES.has(resolved)) return DOUBLES.get(resolved);
    } catch {
      /* que lo resuelva el cargador original */
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  avisos = await import("@/lib/barber/tienda-avisos");
});
after(() => {
  M._load = originalLoad;
});
beforeEach(() => {
  base.tabla = true;
  base.cuenta = 0;
  base.filas = [];
  base.truena = false;
  base.preguntas = [];
  features = { products: true };
  resetTiendaReadyCache();
});

function ctxDe(role: "OWNER" | "RECEPTION" | "BARBER", permissionsOverride: string[] | null = null, barbershopId = "sede-centro") {
  return {
    barbershopId,
    role,
    user: { permissionsOverride },
    barbershop: { plan: "PROFESIONAL" },
  } as unknown as BarberContext;
}

// ── 1. La regla ──────────────────────────────────────────────────────────

test("por atender: lo nuevo (PENDING) y lo pagado en línea sin tocar (PAID_ONLINE) siempre cuentan", () => {
  for (const paidOnline of [false, true]) {
    assert.equal(orderNeedsAction({ status: "PENDING", paidOnline }), true);
    assert.equal(orderNeedsAction({ status: "PAID_ONLINE", paidOnline }), true);
  }
});

test("por atender: un apartado SIN pagar deja de contar al marcarlo «Listo»", () => {
  assert.equal(orderNeedsAction({ status: "READY", paidOnline: false }), false);
  assert.equal(orderNeedsAction({ status: "READY", paidOnline: false }, true), false);
});

test("por atender: pagado en línea y «Listo» sigue contando hasta entregarlo (interruptor único)", () => {
  assert.equal(ORDER_ACTION_COUNTS_PAID_READY, true, "si Rafael decide lo contrario, se cambia aquí y nada más");
  assert.equal(orderNeedsAction({ status: "READY", paidOnline: true }), true);
  assert.equal(orderNeedsAction({ status: "READY", paidOnline: true }, false), false, "con el interruptor apagado, «Listo» lo quita");
});

test("por atender: entregado, cancelado y vencido nunca cuentan, pagados o no", () => {
  for (const status of ["PICKED_UP", "CANCELLED", "EXPIRED", "OTRO"]) {
    for (const paidOnline of [false, true]) {
      for (const flag of [false, true]) assert.equal(orderNeedsAction({ status, paidOnline }, flag), false, `${status} ${paidOnline} ${flag}`);
    }
  }
  // Y la tabla de verdad completa cubre todos los estados que existen.
  const cuentan = PRODUCT_ORDER_STATUSES.filter((status) => orderNeedsAction({ status, paidOnline: true }));
  assert.deepEqual(cuentan, ["PENDING", "PAID_ONLINE", "READY"]);
});

test("la consulta del contador: por sede, con las tres ramas de la regla y sin escribir nada", async () => {
  base.cuenta = 4;
  assert.equal(await countOrdersNeedingAction(fakeDb as never, "sede-centro"), 4);
  const [p] = sobrePedidos();
  assert.ok(p, "tiene que preguntar por la tabla de pedidos");
  assert.match(p.sql, /"barbershop_id" = \?/);
  assert.match(p.sql, /"status" = 'PAID_ONLINE'/);
  assert.match(p.sql, /"status" = 'PENDING' AND \("paid_at" IS NOT NULL\s+OR "created_at" > now\(\) - make_interval/, "un apartado sin pagar de más de 72 h ya venció: no cuenta");
  assert.match(p.sql, /"status" = 'READY' AND "paid_at" IS NOT NULL AND \?::boolean/);
  assert.doesNotMatch(p.sql, /UPDATE|DELETE|INSERT/i);
  assert.deepEqual(p.valores, ["sede-centro", TIENDA_HOLD_HOURS, ORDER_ACTION_COUNTS_PAID_READY]);
});

test("sin sede no se pregunta nada (nunca un conteo de todas las barberías)", async () => {
  base.cuenta = 99;
  assert.equal(await countOrdersNeedingAction(fakeDb as never, ""), 0);
  assert.deepEqual(await recentOrdersNeedingAction(fakeDb as never, ""), []);
  assert.equal(base.preguntas.length, 0);
});

test("los recientes: los más nuevos primero, con tope, y solo folio, cliente, total y si está pagado", async () => {
  base.filas = [
    { id: "p3", folio: "K7M2Q", client_name: "Luis Ramírez", total: "349.50", paid_at: new Date("2026-11-16T18:00:00Z"), status: "PAID_ONLINE", created_at: new Date("2026-11-16T17:59:00Z"), client_phone: "9990000000" },
    { id: "p2", folio: "A1B2C", client_name: "Ana", total: 120, paid_at: null, status: "PENDING", created_at: new Date("2026-11-16T15:00:00Z") },
  ];
  const r = await recentOrdersNeedingAction(fakeDb as never, "sede-centro");
  assert.deepEqual(r, [
    { id: "p3", folio: "K7M2Q", clientName: "Luis Ramírez", total: 349.5, paidOnline: true, status: "PAID_ONLINE", createdAt: "2026-11-16T17:59:00.000Z" },
    { id: "p2", folio: "A1B2C", clientName: "Ana", total: 120, paidOnline: false, status: "PENDING", createdAt: "2026-11-16T15:00:00.000Z" },
  ]);
  const [p] = sobrePedidos();
  assert.match(p.sql, /ORDER BY "created_at" DESC\s+LIMIT \?/);
  assert.doesNotMatch(p.sql, /client_phone|items/, "el teléfono y las piezas no viajan a Inicio");
  assert.equal(p.valores.at(-1), ORDER_NOTICE_RECENT);
  assert.equal(ORDER_NOTICE_RECENT, 3);
});

// ── 2. Quién se entera ───────────────────────────────────────────────────

test("el dueño y Recepción (products.view) reciben el número de SU sede", async () => {
  base.cuenta = 2;
  assert.equal(await avisos.countOrdersNotice(ctxDe("OWNER")), 2);
  assert.equal(await avisos.countOrdersNotice(ctxDe("RECEPTION", null, "sede-norte")), 2);
  const sedes = sobrePedidos().map((p) => p.valores[0]);
  assert.deepEqual(sedes, ["sede-centro", "sede-norte"]);
});

test("sin products.view no hay aviso y ni se consulta: Barbero, y a quien se le quitó el permiso", async () => {
  base.cuenta = 7;
  assert.equal(await avisos.countOrdersNotice(ctxDe("BARBER")), 0);
  assert.equal(await avisos.loadOrdersNotice(ctxDe("BARBER")), null);
  assert.equal(await avisos.countOrdersNotice(ctxDe("RECEPTION", ["agenda.view"])), 0);
  assert.equal(await avisos.countOrdersNotice(ctxDe("OWNER", [BARBER_NO_PERMISSIONS])), 0);
  assert.equal(base.preguntas.length, 0, "ni una sola consulta");
});

test("un plan sin productos no avisa", async () => {
  base.cuenta = 7;
  features = { products: false };
  assert.equal(await avisos.countOrdersNotice(ctxDe("OWNER")), 0);
  assert.equal(await avisos.loadOrdersNotice(ctxDe("OWNER")), null);
  assert.equal(base.preguntas.length, 0);
});

test("sin la tabla de pedidos (SQL viejo): 0, sin tarjeta y sin tocar la tabla", async () => {
  base.tabla = false;
  base.cuenta = 7;
  assert.equal(await avisos.countOrdersNotice(ctxDe("OWNER")), 0);
  assert.equal(await avisos.loadOrdersNotice(ctxDe("OWNER")), null);
  assert.equal(sobrePedidos().length, 0);
});

test("si la base falla, el menú e Inicio siguen: 0 y sin tarjeta, nunca una excepción", async () => {
  base.truena = true;
  const avisoOriginal = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(await avisos.countOrdersNotice(ctxDe("OWNER")), 0);
    assert.equal(await avisos.loadOrdersNotice(ctxDe("OWNER")), null);
  } finally {
    console.warn = avisoOriginal;
  }
});

test("Inicio: sin pedidos por atender no hay tarjeta; con ellos, el total y los 3 recientes", async () => {
  assert.equal(await avisos.loadOrdersNotice(ctxDe("OWNER")), null, "0 pedidos → sin tarjeta");
  assert.equal(sobrePedidos().length, 1, "con 0 no se piden los recientes");

  base.cuenta = 5;
  base.filas = [{ id: "p1", folio: "ZZ111", client_name: "Beto", total: "80.00", paid_at: null, status: "PENDING", created_at: new Date("2026-11-16T10:00:00Z") }];
  const n = await avisos.loadOrdersNotice(ctxDe("OWNER"));
  assert.equal(n?.count, 5);
  assert.equal(n?.recent.length, 1);
  assert.equal(n?.recent[0].folio, "ZZ111");
});

// ── 3. El menú ───────────────────────────────────────────────────────────

test("la pastilla: el número tal cual y «99+» de cien en adelante; lo que no es un número no se pinta", () => {
  assert.equal(textoContador(1), "1");
  assert.equal(textoContador(99), "99");
  assert.equal(textoContador(100), "99+");
  assert.equal(leerContador(3), 3);
  assert.equal(leerContador(0), 0);
  for (const malo of [-1, Number.NaN, Infinity, "3", null, undefined, {}]) assert.equal(leerContador(malo), null);
});

test("el menú pregunta a la ruta nueva cada ~60 s y esa ruta existe y usa la regla única", () => {
  assert.equal(PEDIDOS_POR_ATENDER_URL, "/api/barber/product-orders/pending");
  assert.equal(PEDIDOS_POR_ATENDER_CADA_MS, 60_000);
  const ruta = leer("src/app/api/barber/product-orders/pending/route.ts");
  assert.match(ruta, /countOrdersNotice\(ctx, features\)/);
  assert.match(ruta, /getBarberContext\(\)/);
  assert.match(ruta, /status: 401/);
  // El MISMO candado que la lista de pedidos: a quien se le quitó products.view
  // no le contesta ni un número (el barrido de permisos no admite un 2xx).
  assert.match(ruta, /assertBarberFeature\(ctx, "products"\)/);
  assert.match(ruta, /assertBarberPermission\(ctx, "products\.view"\)/);
  assert.match(ruta, /tiendaPanelError\(e\)/);
  assert.match(ruta, /no-store/);
  const lista = leer("src/app/api/barber/product-orders/route.ts");
  assert.match(lista, /assertBarberFeature\(ctx, "products"\)/, "la lista sigue con ese mismo candado");
});

test("el menú pinta el contador junto a «Productos», al navegar y solo cuando se ve", () => {
  const menu = leer("src/components/barber/barber-sidebar.tsx");
  assert.match(menu, /usePedidosPorAtender\(\{/);
  assert.match(menu, /i\.key === "productos"/, "solo si «Productos» está en el menú de la sesión");
  assert.match(menu, /sondear: conProductos && \(escritorio \|\| mobileOpen\)/, "en celular, solo con el cajón abierto");
  assert.match(menu, /ruta: pathname/, "cada navegación vuelve a preguntar");
  assert.match(menu, /productos: \{ n: porAtender, uno: ordersLabelOne, varios: ordersLabel \}/);
  assert.match(menu, /className="sr-only"/, "el lector de pantalla oye la frase, no un número suelto");
  const layout = leer("src/app/barber/(panel)/layout.tsx");
  assert.match(layout, /ordersLabel=\{t\("barber\.shell\.pendingOrders"\)\}/);
  assert.match(layout, /ordersLabelOne=\{t\("barber\.shell\.pendingOrder"\)\}/);
});

test("la pestaña Pedidos usa la MISMA regla y le pasa su número al menú", () => {
  const tienda = leer("src/lib/barber/tienda.ts");
  assert.match(tienda, /orders\.filter\(\(o\) => orderNeedsAction\(o\)\)\.length/);
  assert.match(tienda, /return countOrdersNeedingAction\(prisma, barbershopId\);/);
  const productos = leer("src/components/barber/products/productos-client.tsx");
  assert.match(productos, /avisarPedidosPorAtender\(n\)/);
  assert.match(productos, /onCount=\{onOrdersCount\}/);
});

test("los textos existen en español y en inglés, en singular y en plural", () => {
  for (const locale of ["es", "en"] as const) {
    const t = getBarberT(locale);
    for (const key of ["barber.shell.pendingOrders", "barber.shell.pendingOrder"]) {
      assert.notEqual(t(key), key, `${locale}: falta ${key}`);
    }
    assert.match(t("barber.shell.pendingOrders"), /\{count\}/);
    const uno = t("barber.caja.productos.newOrders", { count: 1 });
    const tres = t("barber.caja.productos.newOrders", { count: 3 });
    assert.notEqual(uno, tres);
    assert.match(uno, /^1 /);
    assert.match(tres, /^3 /);
  }
  assert.equal(getBarberT("es")("barber.shell.pendingOrder"), "1 pedido de la tienda por atender");
});
