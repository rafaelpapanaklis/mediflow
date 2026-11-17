// CORREO AL DUEÑO POR CADA PEDIDO DE LA TIENDA (ws6-t6, 2.ª parte, 16-nov-2026).
//
// Rafael: «haz el 1, 2, 3 y 4». El 3: correo al dueño cuando entra un pedido y
// cuando se paga en línea; una sola vez por pedido; si el correo falla el
// pedido se guarda igual; interruptor en Configuración → Notificaciones,
// encendido por defecto.
//
// 🔴 AQUÍ NO SALE NINGÚN CORREO REAL: el enviador es un doble que apunta lo que
// se le pide, src/lib/email.ts está doblado, y `fetch` global revienta si
// alguien lo llama.
//
//   npx tsx --test src/lib/barber/__tests__/pedido-avisos.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Module from "node:module";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import {
  ORDER_NOTICE_DEFAULTS,
  ORDER_NOTICE_MAX_RECIPIENTS,
  buildOwnerOrderEmail,
  cleanNoticePhone,
  noticeRecipients,
  noticeShopLabel,
  orderPayLabel,
  type OrderNoticeOrder,
} from "@/lib/barber/pedido-avisos-core";

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);
const leer = (rel: string) => readFileSync(abs(rel), "utf8");

// ── Dobles ────────────────────────────────────────────────────────────────
interface Correo {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
/** El correo «de verdad» (src/lib/email.ts), doblado: apunta y no manda. */
const correoGlobal: Correo[] = [];

/** Una base de mentira para lo de Configuración (lo demás usa una tienda de memoria). */
const base = {
  listo: true,
  fila: { e: true, w: false, p: null as string | null },
  duenos: [] as string[],
  escrituras: [] as Array<{ sql: string; valores: unknown[] }>,
  lecturas: [] as Array<{ sql: string; valores: unknown[] }>,
};
const fakeDb = {
  $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    base.lecturas.push({ sql, valores });
    if (sql.includes("to_regclass")) return [{ n: base.listo ? 3 : 0, t: base.listo }];
    if (sql.includes('"barber_users"')) return base.duenos.map((email) => ({ email }));
    if (sql.includes('"orderNotifyEmail"')) return [base.fila];
    return [];
  },
  $executeRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    base.escrituras.push({ sql: strings.join("?"), valores });
    return 1;
  },
};

const DOUBLES = new Map<string, unknown>([
  [abs("src/lib/prisma.ts"), { __esModule: true, prisma: fakeDb }],
  [
    abs("src/lib/email.ts"),
    {
      __esModule: true,
      sendEmail: async (p: Correo) => {
        correoGlobal.push(p);
        return { delivered: true };
      },
    },
  ],
  [
    abs("src/lib/barber-auth.ts"),
    {
      __esModule: true,
      assertBarberPermission: (ctx: Pick<BarberContext, "role" | "user">, key: Parameters<typeof hasBarberPermission>[1]) => {
        if (!hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, key)) throw new BarberForbiddenError(key);
      },
      hasBarberPermission,
      BarberForbiddenError,
      getBarberContext: async () => null,
      getAccessibleBranchIds: async (ctx: BarberContext) => [ctx.barbershopId],
    },
  ],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
const fetchOriginal = globalThis.fetch;
let avisos: typeof import("@/lib/barber/pedido-avisos");

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
  // Ninguna prueba de este archivo puede tocar la red.
  globalThis.fetch = (async (url: unknown) => {
    throw new Error(`PRUEBA: alguien intentó salir a la red (${String(url).slice(0, 60)})`);
  }) as typeof fetch;
  avisos = await import("@/lib/barber/pedido-avisos");
});
after(() => {
  M._load = originalLoad;
  globalThis.fetch = fetchOriginal;
});
beforeEach(() => {
  correoGlobal.length = 0;
  base.listo = true;
  base.fila = { e: true, w: false, p: null };
  base.duenos = [];
  base.escrituras = [];
  base.lecturas = [];
  avisos.resetOrderNoticesReadyCache();
});

const pedido = (extra: Partial<OrderNoticeOrder> = {}): OrderNoticeOrder => ({
  id: "ped-1",
  folio: "K7M2Q",
  clientName: "Luis Ramírez",
  clientPhone: "9991234567",
  items: [
    { name: "Cera mate", qty: 2, unitPrice: 149.99 },
    { name: "Aceite para barba", qty: 1, unitPrice: 199.5 },
  ],
  total: 499.48,
  payOnline: false,
  paid: false,
  ...extra,
});

type Store = import("@/lib/barber/pedido-avisos").OrderNoticeStore;
type ParaAvisar = import("@/lib/barber/pedido-avisos").OrderForNotice;

/** La «base» de los avisos, en memoria: mismas reglas que la tabla (una fila por pedido, motivo y canal). */
function memoria(opts: { ready?: boolean; owners?: string[]; orden?: Partial<ParaAvisar>; pedido?: Partial<OrderNoticeOrder>; falla?: "loadOrder" | "claim" } = {}) {
  const filas = new Map<string, { status: string; detail: string | null }>();
  const o: ParaAvisar = {
    order: pedido(opts.pedido),
    barbershopId: "sede-norte",
    parentId: "matriz",
    shopName: "Barbería Prueba",
    branchName: "Norte",
    locale: "es",
    fallbackEmails: ["sede@prueba.mx", "matriz@prueba.mx"],
    settings: { ...ORDER_NOTICE_DEFAULTS },
    ...opts.orden,
  };
  const pedidos: Record<string, ParaAvisar> = { [o.order.id]: o };
  const preguntas: Array<Pick<ParaAvisar, "barbershopId" | "parentId">> = [];
  const store: Store = {
    ready: async () => opts.ready ?? true,
    loadOrder: async (id) => {
      if (opts.falla === "loadOrder") throw new Error("la base no contesta");
      return pedidos[id] ?? null;
    },
    ownerEmails: async (q) => {
      preguntas.push({ barbershopId: q.barbershopId, parentId: q.parentId });
      return opts.owners ?? ["dueno@prueba.mx"];
    },
    claim: async (orderId, kind, channel) => {
      if (opts.falla === "claim") throw new Error("la base no contesta");
      const key = `${orderId}|${kind}|${channel}`;
      if (filas.has(key)) return false;
      filas.set(key, { status: "SENDING", detail: null });
      return true;
    },
    finish: async (orderId, kind, channel, status, detail) => {
      filas.set(`${orderId}|${kind}|${channel}`, { status, detail });
    },
  };
  return { store, filas, o, preguntas };
}

/** El doble del enviador: apunta lo que se le pide y contesta lo que se le diga. */
function enviador(modo: "ok" | "rechaza" | "lanza" = "ok") {
  const enviados: Correo[] = [];
  return {
    enviados,
    sendEmail: async (p: Correo) => {
      enviados.push(p);
      if (modo === "lanza") throw new Error("Resend caído");
      return { delivered: modo === "ok" };
    },
  };
}

async function sinRuido<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.warn;
  console.warn = () => undefined;
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

const SITIO = "https://www.dalecontrol.com";

// ── 1. El correo ─────────────────────────────────────────────────────────

test("pedido nuevo: un correo a cada dueño, con el asunto, los productos, el total, cómo paga, el cliente y el botón al panel", async () => {
  const m = memoria({ owners: ["dueno@prueba.mx", "socia@prueba.mx"] });
  const e = enviador();
  const r = await avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO });
  assert.deepEqual(r, { ran: true, channels: [{ channel: "EMAIL", outcome: "sent", detail: "2 de 2" }] });
  assert.deepEqual(e.enviados.map((c) => c.to), ["dueno@prueba.mx", "socia@prueba.mx"]);
  const c = e.enviados[0];
  assert.equal(c.subject, "Pedido nuevo #K7M2Q — Barbería Prueba · Norte");
  for (const parte of ["2 × Cera mate", "$299.98", "1 × Aceite para barba", "$199.50", "$499.48", "Paga en la barbería", "Luis Ramírez", "9991234567", "#K7M2Q"]) {
    assert.ok(c.html.includes(parte), `falta «${parte}» en el HTML`);
    assert.ok(c.text?.includes(parte), `falta «${parte}» en el texto plano`);
  }
  assert.match(c.html, /<a href="https:\/\/www\.dalecontrol\.com\/barber\/productos\?tab=pedidos"[^>]*>Ver pedido<\/a>/);
  assert.match(c.text ?? "", /Ver pedido: https:\/\/www\.dalecontrol\.com\/barber\/productos\?tab=pedidos/);
  assert.deepEqual(m.filas.get("ped-1|NEW|EMAIL"), { status: "SENT", detail: "2 de 2" });
  assert.equal(correoGlobal.length, 0, "el correo salió por el doble inyectado, no por el enviador real");
});

test("a quién: se piden los dueños de la sede del pedido Y de su matriz", async () => {
  const m = memoria();
  await avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, sendEmail: enviador().sendEmail, siteUrl: SITIO });
  assert.deepEqual(m.preguntas, [{ barbershopId: "sede-norte", parentId: "matriz" }]);
  // Y la consulta de verdad los busca así: rol Dueño, activos, sede primero.
  const src = leer("src/lib/barber/pedido-avisos.ts");
  assert.match(src, /"barbershopId" = ANY\(\$\{ids\}::text\[\]\) AND "role"::text = 'OWNER' AND "isActive" = true/);
  assert.match(src, /const ids = parentId \? \[shopId, parentId\] : \[shopId\];/);
});

test("UNA sola vez por pedido: el segundo aviso (reintento, doble clic) no manda otro correo", async () => {
  const m = memoria();
  const e = enviador();
  const d = { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO };
  await avisos.notifyOwnerOfOrder("NEW", "ped-1", d);
  const otra = await avisos.notifyOwnerOfOrder("NEW", "ped-1", d);
  assert.deepEqual(otra.channels, [{ channel: "EMAIL", outcome: "duplicate", detail: null }]);
  assert.equal(e.enviados.length, 1);
});

test("dos avisos A LA VEZ del mismo pedido: sale un correo, no dos", async () => {
  const m = memoria();
  const e = enviador();
  const d = { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO };
  const [a, b] = await Promise.all([avisos.notifyOwnerOfOrder("NEW", "ped-1", d), avisos.notifyOwnerOfOrder("NEW", "ped-1", d)]);
  assert.deepEqual([a.channels[0].outcome, b.channels[0].outcome].sort(), ["duplicate", "sent"]);
  assert.equal(e.enviados.length, 1);
});

test("cuando se paga en línea: OTRO correo (una vez), que dice «pagado en línea»", async () => {
  const m = memoria({ pedido: { payOnline: true, paid: true } });
  const e = enviador();
  const d = { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO };
  await avisos.notifyOwnerOfOrder("NEW", "ped-1", d);
  const r = await avisos.notifyOwnerOfOrder("PAID", "ped-1", d);
  assert.equal(r.channels[0].outcome, "sent");
  assert.equal(e.enviados.length, 2);
  assert.equal(e.enviados[1].subject, "Pedido pagado en línea #K7M2Q — Barbería Prueba · Norte");
  assert.ok(e.enviados[1].html.includes("Pagado en línea"));
  assert.ok(e.enviados[1].html.includes("Te pagaron un pedido en línea"));
  // Mercado Pago reintenta el aviso: no hay tercer correo.
  await avisos.notifyOwnerOfOrder("PAID", "ped-1", d);
  assert.equal(e.enviados.length, 2);
});

test("«pagado» de un pedido que NO tiene pago no avisa nada", async () => {
  const m = memoria({ pedido: { payOnline: true, paid: false } });
  const e = enviador();
  const r = await avisos.notifyOwnerOfOrder("PAID", "ped-1", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO });
  assert.deepEqual(r, { ran: false, reason: "no_pagado", channels: [] });
  assert.equal(e.enviados.length, 0);
  assert.equal(m.filas.size, 0);
});

test("el cliente eligió pagar en línea y todavía no paga: el correo de «pedido nuevo» lo dice tal cual", async () => {
  const m = memoria({ pedido: { payOnline: true, paid: false } });
  const e = enviador();
  await avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO });
  assert.ok(e.enviados[0].html.includes("Eligió pagar en línea (todavía no paga)"));
  assert.ok(!e.enviados[0].html.includes(">Pagado en línea<"));
});

// ── 2. Nunca bloquea ni tumba el pedido ──────────────────────────────────

test("si el enviador rechaza o revienta: no lanza, queda FAILED con el motivo y NO se reintenta", async () => {
  for (const modo of ["rechaza", "lanza"] as const) {
    const m = memoria();
    const e = enviador(modo);
    const d = { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO };
    const r = await sinRuido(() => avisos.notifyOwnerOfOrder("NEW", "ped-1", d));
    assert.equal(r.ran, true);
    assert.equal(r.channels[0].outcome, "failed", modo);
    assert.equal(m.filas.get("ped-1|NEW|EMAIL")?.status, "FAILED");
    const otra = await avisos.notifyOwnerOfOrder("NEW", "ped-1", d);
    assert.equal(otra.channels[0].outcome, "duplicate", "uno de menos antes que dos iguales");
    assert.equal(e.enviados.length, 1);
  }
});

test("si la base falla a media marcha: no lanza y no manda nada", async () => {
  for (const falla of ["loadOrder", "claim"] as const) {
    const m = memoria({ falla });
    const e = enviador();
    const r = await sinRuido(() => avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO }));
    // Sin poder leer el pedido no hay nada que intentar; si lo que falla es la
    // marca de «avisado», ese canal no manda (no podría garantizar «una vez»).
    assert.deepEqual(r, falla === "loadOrder" ? { ran: false, reason: "error", channels: [] } : { ran: true, channels: [] });
    assert.equal(e.enviados.length, 0);
  }
});

test("sin el SQL de los avisos: no se manda nada y todo sigue igual", async () => {
  const m = memoria({ ready: false });
  const e = enviador();
  const r = await avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO });
  assert.deepEqual(r, { ran: false, reason: "sql_pendiente", channels: [] });
  assert.equal(e.enviados.length, 0);
  assert.equal(m.filas.size, 0);
});

test("un pedido que no existe no avisa", async () => {
  const m = memoria();
  const e = enviador();
  assert.deepEqual(await avisos.notifyOwnerOfOrder("NEW", "otro", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO }), { ran: false, reason: "sin_pedido", channels: [] });
  assert.equal(e.enviados.length, 0);
});

// ── 3. El interruptor y los destinatarios ────────────────────────────────

test("con el interruptor apagado no sale correo ni se gasta la marca de «avisado»", async () => {
  const m = memoria({ orden: { settings: { email: false, whatsapp: false, phone: null } } });
  const e = enviador();
  const r = await avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO });
  assert.deepEqual(r, { ran: true, channels: [] });
  assert.equal(e.enviados.length, 0);
  assert.equal(m.filas.size, 0);
});

test("de fábrica: el correo nace ENCENDIDO y el WhatsApp APAGADO", () => {
  assert.deepEqual(ORDER_NOTICE_DEFAULTS, { email: true, whatsapp: false, phone: null });
  const sql = leer("sql/barber_pedidos_avisos.sql");
  assert.match(sql, /"orderNotifyEmail"\s+BOOLEAN NOT NULL DEFAULT true/);
  assert.match(sql, /"orderNotifyWhatsapp"\s+BOOLEAN NOT NULL DEFAULT false/);
});

test("sin ningún dueño con correo: no se manda y queda anotado por qué", async () => {
  const m = memoria({ owners: [] });
  const e = enviador();
  const r = await avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, sendEmail: e.sendEmail, siteUrl: SITIO });
  assert.deepEqual(r.channels, [{ channel: "EMAIL", outcome: "skipped", detail: "ningún dueño activo con correo" }]);
  assert.equal(m.filas.get("ped-1|NEW|EMAIL")?.status, "SKIPPED");
});

test("destinatarios: sin repetir, sin correos rotos, con tope, y el correo de la barbería solo si no hay dueños", () => {
  assert.deepEqual(noticeRecipients(["A@x.mx", "a@x.mx ", "b@x.mx", "no-es-correo", null], ["respaldo@x.mx"]), ["a@x.mx", "b@x.mx"]);
  assert.deepEqual(noticeRecipients([], ["sede@x.mx", null, "matriz@x.mx", "sede@x.mx"]), ["sede@x.mx", "matriz@x.mx"]);
  assert.deepEqual(noticeRecipients([null, "roto"], []), []);
  const muchos = Array.from({ length: 12 }, (_, i) => `d${i}@x.mx`);
  assert.equal(noticeRecipients(muchos).length, ORDER_NOTICE_MAX_RECIPIENTS);
  assert.equal(ORDER_NOTICE_MAX_RECIPIENTS, 5);
});

// ── 4. El contenido, sin sorpresas ───────────────────────────────────────

test("lo que escribió el cliente va como TEXTO: ni etiquetas ni saltos en el asunto", () => {
  const mail = buildOwnerOrderEmail({
    kind: "NEW",
    order: pedido({ clientName: '<script>alert("x")</script>', items: [{ name: "Cera <b>fuerte</b> & más", qty: 1, unitPrice: 10 }], total: 10 }),
    shopName: "Barbería\nPrueba",
    branchName: null,
    panelUrl: `${SITIO}/barber/productos?tab=pedidos`,
  });
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(mail.html.includes("Cera &lt;b&gt;fuerte&lt;/b&gt; &amp; más"));
  assert.ok(!/[\r\n]/.test(mail.subject));
  assert.equal(mail.subject, "Pedido nuevo #K7M2Q — Barbería Prueba");
});

test("la forma de pago se dice de tres maneras y nunca ambigua; el nombre de la sede no se repite", () => {
  assert.equal(orderPayLabel({ payOnline: false, paid: false }), "Paga en la barbería");
  assert.equal(orderPayLabel({ payOnline: true, paid: false }), "Eligió pagar en línea (todavía no paga)");
  assert.equal(orderPayLabel({ payOnline: true, paid: true }), "Pagado en línea");
  assert.equal(orderPayLabel({ payOnline: false, paid: true }), "Pagado en línea", "pagado manda");
  assert.equal(orderPayLabel({ payOnline: false, paid: false }, "en"), "Pays at the shop");
  assert.equal(noticeShopLabel("El Corte", "Norte"), "El Corte · Norte");
  assert.equal(noticeShopLabel("El Corte", "el corte"), "El Corte");
  assert.equal(noticeShopLabel("El Corte", null), "El Corte");
});

test("en inglés (barbería con el panel en inglés): asunto, textos y botón traducidos", () => {
  const mail = buildOwnerOrderEmail({ kind: "NEW", order: pedido(), shopName: "The Cut", panelUrl: `${SITIO}/barber/productos?tab=pedidos`, locale: "en" });
  assert.equal(mail.subject, "New order #K7M2Q — The Cut");
  assert.match(mail.html, /lang="en"/);
  assert.ok(mail.html.includes("Pays at the shop"));
  assert.match(mail.html, />View order<\/a>/);
  assert.ok(!/Pedido|Paga en|Ver pedido/.test(mail.html));
  const pagado = buildOwnerOrderEmail({ kind: "PAID", order: pedido({ paid: true }), shopName: "The Cut", panelUrl: "x", locale: "en-US" });
  assert.equal(pagado.subject, "Order paid online #K7M2Q — The Cut");
});

// ── 5. Configuración → Notificaciones ────────────────────────────────────

function ctxDe(role: "OWNER" | "MANAGER" | "RECEPTION" | "BARBER", barbershopId = "sede-norte") {
  return {
    barbershopId,
    role,
    user: { permissionsOverride: null },
    barbershop: { parentId: "matriz", email: "sede@prueba.mx", plan: "PROFESIONAL" },
  } as unknown as BarberContext;
}

test("Notificaciones se lee de la sede en sesión y dice a qué correos llega", async () => {
  base.duenos = ["dueno@prueba.mx", "DUENO@prueba.mx", "socia@prueba.mx"];
  const v = await avisos.getOrderNoticeSettings(ctxDe("OWNER"));
  assert.deepEqual(v, { email: true, whatsapp: false, phone: null, persisted: true, recipients: ["dueno@prueba.mx", "socia@prueba.mx"], whatsappConnected: false });
  const usuarios = base.lecturas.find((l) => l.sql.includes('"barber_users"'));
  assert.deepEqual(usuarios?.valores[0], ["sede-norte", "matriz"], "la sede y su matriz");
  const ajustes = base.lecturas.find((l) => l.sql.includes('"orderNotifyEmail" AS'));
  assert.deepEqual(ajustes?.valores, ["sede-norte"]);
});

test("sin el SQL: la tarjeta sale con los valores de fábrica, marcada como pendiente, y no deja guardar", async () => {
  base.listo = false;
  const v = await avisos.getOrderNoticeSettings(ctxDe("OWNER"));
  assert.equal(v.persisted, false);
  assert.equal(v.email, true);
  assert.equal(v.whatsapp, false);
  const r = await avisos.saveOrderNoticeSettings(ctxDe("OWNER"), { email: false });
  assert.deepEqual(r, { ok: false, reason: "sql_pendiente", value: { email: true, whatsapp: false, phone: null } });
  assert.equal(base.escrituras.length, 0);
});

test("guardar: solo la sede en sesión, y solo quien puede editar la configuración", async () => {
  const r = await avisos.saveOrderNoticeSettings(ctxDe("OWNER"), { email: false });
  assert.deepEqual(r, { ok: true, value: { email: false, whatsapp: false, phone: null } });
  assert.equal(base.escrituras.length, 1);
  assert.match(base.escrituras[0].sql, /UPDATE "barber_shops"\s+SET "orderNotifyEmail" = \?, "orderNotifyWhatsapp" = \?, "orderNotifyPhone" = \?\s+WHERE "id" = \?/);
  assert.deepEqual(base.escrituras[0].valores, [false, false, null, "sede-norte"]);

  base.escrituras = [];
  await assert.rejects(() => avisos.saveOrderNoticeSettings(ctxDe("RECEPTION"), { email: false }), BarberForbiddenError);
  await assert.rejects(() => avisos.saveOrderNoticeSettings(ctxDe("BARBER"), { email: false }), BarberForbiddenError);
  assert.equal(base.escrituras.length, 0);
});

test("el WhatsApp del aviso: 10 dígitos de México o nada; encenderlo sin número no se guarda", async () => {
  assert.equal(cleanNoticePhone("999 123 4567"), "9991234567");
  assert.equal(cleanNoticePhone("+52 1 999 123 4567"), "9991234567");
  assert.equal(cleanNoticePhone("12345"), null);
  assert.equal(cleanNoticePhone(null), null);
  await assert.rejects(() => avisos.saveOrderNoticeSettings(ctxDe("OWNER"), { whatsapp: true }), /escribe a qué número/);
  await assert.rejects(() => avisos.saveOrderNoticeSettings(ctxDe("OWNER"), { phone: "123" }), /10 dígitos/);
  assert.equal(base.escrituras.length, 0);
  const ok = await avisos.saveOrderNoticeSettings(ctxDe("OWNER"), { whatsapp: true, phone: "(999) 123-4567" });
  assert.deepEqual(ok.value, { email: true, whatsapp: true, phone: "9991234567" });
  assert.deepEqual(base.escrituras[0].valores, [true, true, "9991234567", "sede-norte"]);
});

// ── 6. Dónde se engancha, y el SQL ───────────────────────────────────────

test("la ruta del pedido avisa DESPUÉS de responder (no espera al correo) y el webhook solo cuando el pago se aplicó", () => {
  const ruta = leer("src/app/api/barber/public/tienda/[slug]/pedidos/route.ts");
  assert.match(ruta, /afterResponse\(\(\) => onTiendaOrderCreated\(nuevo\)\);/);
  assert.doesNotMatch(ruta, /await onTiendaOrderCreated/);
  assert.ok(ruta.indexOf("await createTiendaOrder(") < ruta.indexOf("afterResponse("), "primero se guarda el pedido");
  const webhook = leer("src/app/api/barber/mercadopago/webhook/route.ts");
  assert.match(webhook, /if \(pago\.aplicado\) afterResponse\(\(\) => onTiendaOrderPaid\(pedido\)\);/);
  const ajustes = leer("src/app/api/barber/settings/route.ts");
  assert.match(ajustes, /section === "orderNotices"\) result = await saveOrderNoticeSettings\(ctx, body\)/);
  assert.match(ajustes, /orderNotices: "sql\/barber_pedidos_avisos\.sql"/);
});

test("el SQL es plano, aditivo e idempotente (se puede pegar dos veces) y no toca filas", () => {
  const sql = leer("sql/barber_pedidos_avisos.sql")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(sql, /\bDO \$\$|\bDROP\b|\bTRUNCATE\b|ALTER COLUMN|\bSET\b/i);
  // Cada sentencia EMPIEZA añadiendo algo (ni UPDATE ni DELETE sueltos; los
  // «ON DELETE / ON UPDATE CASCADE» de las llaves foráneas no son sentencias).
  for (const s of sql.split(";").map((x) => x.trim()).filter(Boolean)) {
    assert.match(s, /^(ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS|CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS)/, s.slice(0, 60));
  }
  assert.match(sql, /PRIMARY KEY \("order_id", "kind", "channel"\)/, "la marca de «avisado» es única por pedido, motivo y canal");
  assert.match(sql, /REFERENCES "barber_product_orders"\("id"\)\s+ON DELETE CASCADE/);
});

test("la marca de «avisado» se toma con un INSERT que no pisa (ON CONFLICT DO NOTHING)", () => {
  const src = leer("src/lib/barber/pedido-avisos.ts");
  assert.match(src, /INSERT INTO "barber_order_notices"[\s\S]{0,260}ON CONFLICT \("order_id", "kind", "channel"\) DO NOTHING\s+RETURNING "order_id"/);
  assert.match(src, /return rows\.length === 1;/);
});

test("por defecto usa el enviador de siempre (src/lib/email.ts) y la tarjeta está en Configuración", async () => {
  const src = leer("src/lib/barber/pedido-avisos.ts");
  assert.match(src, /import \{ sendEmail \} from "@\/lib\/email";/);
  // Sin doble inyectado, el correo sale por ese enviador (aquí, su doble: nada real).
  const m = memoria();
  await avisos.notifyOwnerOfOrder("NEW", "ped-1", { store: m.store, siteUrl: SITIO });
  assert.equal(correoGlobal.length, 1);
  assert.equal(correoGlobal[0].to, "dueno@prueba.mx");
  const pantalla = leer("src/components/barber/configuracion/configuracion-screen.tsx");
  assert.match(pantalla, /<NotificacionesCard/);
  const es = JSON.parse(leer("src/i18n/dictionaries/barber/ajustes.es.json")).configuracion.notifications;
  const en = JSON.parse(leer("src/i18n/dictionaries/barber/ajustes.en.json")).configuracion.notifications;
  assert.equal(es.email, "Avisarme por correo de pedidos de la tienda");
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort(), "mismas llaves en es y en");
});
