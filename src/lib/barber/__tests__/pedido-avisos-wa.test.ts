// WHATSAPP AL DUEÑO POR UN PEDIDO NUEVO (ws6-t6, 2.ª parte, punto 4, 16-nov-2026).
//
// Solo si la barbería tiene SU WhatsApp conectado; sale de su número al
// WhatsApp que el dueño escribió en Notificaciones; fuera de la ventana de
// 24 h necesita la plantilla `dc_barber_pedido_nuevo_dueno` APROBADA por Meta
// (si no, nada: el correo basta). Interruptor APAGADO por defecto.
//
// 🔴 AQUÍ NO SE LE HABLA A META NI SE MANDA NINGÚN MENSAJE: `fetch` es un doble
// que hace de Graph API y apunta lo que se le pide; la base es de memoria; no
// se crea ni se manda ninguna plantilla de verdad.
//
//   npx tsx --test src/lib/barber/__tests__/pedido-avisos-wa.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Module from "node:module";
import {
  BARBER_OWNER_NOTICE_TTL_MS,
  BARBER_WA_TEMPLATES,
  barberOutboxStaleReason,
  barberWaTemplate,
  checkBarberWaTemplate,
  countBarberWaVariables,
} from "@/lib/barber/whatsapp-core";
import { ORDER_NOTICE_DEFAULTS, ORDER_NOTICE_WHATSAPP_KINDS, type OrderNoticeOrder } from "@/lib/barber/pedido-avisos-core";
import {
  OWNER_ORDER_WA_MARK,
  decideOwnerWa,
  ownerOrderWaParams,
  parseOwnerOrderWaBody,
  renderOwnerOrderWaText,
} from "@/lib/barber/pedido-avisos-wa-core";
import { getBarberT } from "@/i18n/dictionaries/barber";

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);
const leer = (rel: string) => readFileSync(abs(rel), "utf8");

// ── La base de memoria (solo lo que el emisor toca) ───────────────────────
type Fila = Record<string, unknown>;
const mundo = {
  shop: null as Fila | null,
  mensajes: [] as Fila[],
  cupoSumado: 0,
  seq: 0,
};
const casa = (fila: Fila, where: Fila) => Object.entries(where).every(([k, v]) => (fila[k] ?? null) === (v ?? null));
const fakePrisma = {
  barbershop: {
    findUnique: async ({ where }: { where: { id: string } }) => (mundo.shop && mundo.shop.id === where.id ? mundo.shop : null),
    updateMany: async () => ({ count: 0 }),
    update: async () => {
      mundo.cupoSumado++;
      return {};
    },
  },
  barberMessage: {
    findFirst: async ({ where }: { where: Fila }) => [...mundo.mensajes].reverse().find((m) => casa(m, where)) ?? null,
    create: async ({ data }: { data: Fila }) => {
      const fila = { id: `msg-${++mundo.seq}`, errorMessage: null, waMessageId: null, createdAt: new Date(), ...data };
      mundo.mensajes.push(fila);
      return fila;
    },
    updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
      const hits = mundo.mensajes.filter((m) => casa(m, where));
      hits.forEach((m) => Object.assign(m, data));
      return { count: hits.length };
    },
    update: async ({ where, data }: { where: Fila; data: Fila }) => {
      const m = mundo.mensajes.find((x) => casa(x, where));
      if (m) Object.assign(m, data);
      return m ?? {};
    },
  },
};

// ── Meta de mentira ───────────────────────────────────────────────────────
interface Llamada {
  metodo: string;
  url: string;
  cuerpo: Record<string, unknown> | null;
}
const meta = {
  llamadas: [] as Llamada[],
  /** Estado con el que Meta «tiene» la plantilla (null = no la lista). */
  plantilla: "APPROVED" as string | null,
  idioma: "es_MX",
  /** true = Meta rechaza el envío. */
  falla: false,
};
const fetchDoble = (async (url: unknown, init?: { method?: string; body?: string }) => {
  const u = String(url);
  const metodo = init?.method ?? "GET";
  meta.llamadas.push({ metodo, url: u, cuerpo: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
  if (!u.startsWith("https://graph.facebook.com/")) throw new Error(`PRUEBA: salida a la red no prevista (${u.slice(0, 60)})`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("/message_templates") && metodo === "GET") {
    return json({ data: meta.plantilla ? [{ name: "dc_barber_pedido_nuevo_dueno", status: meta.plantilla, language: meta.idioma, rejected_reason: "NONE" }] : [] });
  }
  if (u.endsWith("/messages") && metodo === "POST") {
    return meta.falla ? json({ error: { message: "Recipient not available", code: 131026 } }, 400) : json({ messages: [{ id: "wamid.PRUEBA" }] });
  }
  return json({ error: { message: "no previsto en la prueba" } }, 404);
}) as typeof fetch;

let cuota = 100;
const DOUBLES = new Map<string, unknown>([
  [abs("src/lib/prisma.ts"), { __esModule: true, prisma: fakePrisma }],
  [abs("src/lib/barber/plans.ts"), { __esModule: true, getBarberPlan: async () => ({ id: "PROFESIONAL", messageQuota: cuota, features: { products: true } }) }],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
const fetchOriginal = globalThis.fetch;
let wa: typeof import("@/lib/barber/whatsapp");

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
  globalThis.fetch = fetchDoble;
  wa = await import("@/lib/barber/whatsapp");
});
after(() => {
  M._load = originalLoad;
  globalThis.fetch = fetchOriginal;
});

const DUENO = "9991234567";
function tienda(extra: Fila = {}): Fila {
  return {
    id: "sede-norte",
    name: "Barbería Prueba",
    timezone: "America/Mexico_City",
    locale: "es",
    address: null,
    city: null,
    state: null,
    phone: "9995550000",
    parentId: null,
    isActive: true,
    plan: "PROFESIONAL",
    subscriptionStatus: "active",
    whatsappSenderMode: "OWN_WABA",
    wabaId: "waba-1",
    phoneNumberId: "pnid-1",
    whatsappToken: "token-de-prueba",
    whatsappVerifiedAt: new Date(),
    messagesUsedPeriod: 0,
    messagesPeriodStart: new Date(),
    ...extra,
  };
}
beforeEach(() => {
  mundo.shop = tienda();
  mundo.mensajes = [];
  mundo.cupoSumado = 0;
  meta.llamadas = [];
  meta.plantilla = "APPROVED";
  meta.idioma = "es_MX";
  meta.falla = false;
  cuota = 100;
});

const PARAMS = ["K7M2Q", "$499.48", "Paga en la barbería"] as const;
const avisar = (extra: Partial<Parameters<typeof wa.notifyBarberOwnerOrder>[0]> = {}) =>
  wa.notifyBarberOwnerOrder({ barbershopId: "sede-norte", kind: "NEW", enabled: true, ownerPhone: DUENO, params: PARAMS, ...extra });
const envios = () => meta.llamadas.filter((l) => l.metodo === "POST" && l.url.endsWith("/messages"));
const altas = () => meta.llamadas.filter((l) => l.metodo === "POST" && l.url.includes("/message_templates"));
async function callado<T>(fn: () => Promise<T>): Promise<T> {
  const e = console.error;
  console.error = () => undefined;
  try {
    return await fn();
  } finally {
    console.error = e;
  }
}

// ── 1. La plantilla, en el catálogo que la barbería manda a revisión ─────

test("la plantilla «pedido nuevo para el dueño» está en el catálogo: utilidad, es_MX, corta, con folio, total y forma de pago", () => {
  const tpl = barberWaTemplate("ownerOrder");
  assert.equal(tpl.name, "dc_barber_pedido_nuevo_dueno");
  assert.equal(tpl.category, "UTILITY");
  assert.equal(tpl.lang, "es_MX");
  assert.deepEqual(tpl.variables, ["folio", "total", "forma de pago"]);
  assert.equal(countBarberWaVariables(tpl.body), 3);
  assert.equal(tpl.sample.length, 3);
  assert.equal(checkBarberWaTemplate(tpl), null, "cumple las reglas de Meta (no empieza ni acaba en variable, sin dos seguidas)");
  assert.ok(tpl.body.length < 200, "texto corto");
  assert.equal(tpl.optional, false, "se da de alta con las demás de utilidad, desde el panel");
  assert.equal(tpl.buttons, undefined);
  assert.equal(BARBER_WA_TEMPLATES.filter((t) => t.kind === "ownerOrder").length, 1);
  // Va al final: el orden del catálogo es el de la pantalla de Plantillas.
  assert.equal(BARBER_WA_TEMPLATES[BARBER_WA_TEMPLATES.length - 1].kind, "ownerOrder");
  for (const locale of ["es", "en"] as const) {
    const label = getBarberT(locale)("barber.whatsapp.templates.kind.ownerOrder");
    assert.ok(!label.includes("barber.whatsapp"), `${locale}: falta el nombre de la plantilla en la pantalla`);
  }
});

test("los parámetros salen en el orden de la plantilla, en español, y el dinero como en el panel", () => {
  const o: Pick<OrderNoticeOrder, "folio" | "total" | "payOnline" | "paid"> = { folio: "K7M2Q", total: 1349.5, payOnline: false, paid: false };
  assert.deepEqual(ownerOrderWaParams(o), ["K7M2Q", "$1,349.50", "Paga en la barbería"]);
  assert.deepEqual(ownerOrderWaParams({ ...o, payOnline: true }), ["K7M2Q", "$1,349.50", "Eligió pagar en línea (todavía no paga)"]);
  assert.deepEqual(ownerOrderWaParams({ ...o, payOnline: true, paid: true }), ["K7M2Q", "$1,349.50", "Pagado en línea"]);
});

test("el texto libre lleva lo mismo que la plantilla y de él se recuperan los tres parámetros", () => {
  const texto = renderOwnerOrderWaText(PARAMS);
  assert.equal(texto.split("\n")[0], OWNER_ORDER_WA_MARK);
  for (const p of PARAMS) assert.ok(texto.includes(p));
  assert.deepEqual(parseOwnerOrderWaBody(texto), [...PARAMS]);
  // Un valor con saltos no rompe los renglones.
  assert.deepEqual(parseOwnerOrderWaBody(renderOwnerOrderWaText(["K7M2Q", "$10.00", "Paga en\nla barbería"])), ["K7M2Q", "$10.00", "Paga en la barbería"]);
  // Cualquier otro texto no es un aviso de éstos.
  for (const otro of [null, "", "Hola", `${OWNER_ORDER_WA_MARK}\nFolio: X`, texto.replace("Total: ", "Monto: "), renderOwnerOrderWaText(["", "$1", "x"])]) {
    assert.equal(parseOwnerOrderWaBody(otro), null);
  }
});

// ── 2. La decisión ───────────────────────────────────────────────────────

test("cuándo sale: apagado, otro motivo, sin número, sin WhatsApp, mismo número y sin cupo → no; ventana abierta → texto; plantilla aprobada → plantilla", () => {
  const base = { enabled: true, kind: "NEW" as const, ownerPhone: DUENO, connected: true, shopPhone: "9995550000", hasQuota: true, windowOpen: false, templateStatus: "APPROVED" };
  assert.deepEqual(decideOwnerWa(base), { send: "template" });
  assert.deepEqual(decideOwnerWa({ ...base, enabled: false }), { send: null, reason: "off" });
  assert.deepEqual(decideOwnerWa({ ...base, kind: "PAID" }), { send: null, reason: "kind" });
  assert.deepEqual(decideOwnerWa({ ...base, ownerPhone: null }), { send: null, reason: "noPhone" });
  assert.deepEqual(decideOwnerWa({ ...base, connected: false }), { send: null, reason: "notConnected" });
  assert.deepEqual(decideOwnerWa({ ...base, shopPhone: DUENO }), { send: null, reason: "samePhone" });
  assert.deepEqual(decideOwnerWa({ ...base, hasQuota: false }), { send: null, reason: "noQuota" });
  // Ventana abierta: texto gratis, aunque la plantilla no esté aprobada.
  assert.deepEqual(decideOwnerWa({ ...base, windowOpen: true, templateStatus: "PENDING" }), { send: "text" });
  // Fuera de la ventana SOLO con la plantilla APROBADA.
  for (const st of ["PENDING", "REJECTED", "MISSING", "PAUSED", "DISABLED", "IN_APPEAL", "OTHER_LANGUAGE", "", null]) {
    assert.deepEqual(decideOwnerWa({ ...base, templateStatus: st }), { send: null, reason: "templateNotApproved" }, String(st));
  }
  assert.deepEqual(decideOwnerWa({ ...base, templateStatus: "approved" }), { send: "template" });
  // El primer «no» manda: apagado gana a todo.
  assert.deepEqual(decideOwnerWa({ ...base, enabled: false, ownerPhone: null, connected: false }), { send: null, reason: "off" });
});

test("solo se avisa por WhatsApp de un pedido NUEVO (un segundo mensaje al pagarse sería otro cobro de Meta)", () => {
  assert.deepEqual([...ORDER_NOTICE_WHATSAPP_KINDS], ["NEW"]);
  assert.equal(ORDER_NOTICE_DEFAULTS.whatsapp, false, "nace APAGADO");
});

// ── 3. El emisor de verdad, contra una Meta de mentira ───────────────────

test("apagado, motivo PAID o sin número: no se toca ni la base ni Meta", async () => {
  mundo.shop = null; // si alguien leyera la base, no encontraría barbería
  assert.deepEqual(await avisar({ enabled: false }), { outcome: "skipped", reason: "off", messageId: null });
  assert.deepEqual(await avisar({ kind: "PAID" }), { outcome: "skipped", reason: "kind", messageId: null });
  assert.deepEqual(await avisar({ ownerPhone: null }), { outcome: "skipped", reason: "noPhone", messageId: null });
  assert.deepEqual(await avisar({ ownerPhone: "12345" }), { outcome: "skipped", reason: "noPhone", messageId: null });
  assert.equal(meta.llamadas.length, 0);
  assert.equal(mundo.mensajes.length, 0);
});

test("la barbería sin su WhatsApp conectado: no se manda nada (y no se pregunta nada a Meta)", async () => {
  mundo.shop = tienda({ whatsappToken: null, phoneNumberId: null });
  assert.deepEqual(await avisar(), { outcome: "skipped", reason: "notConnected", messageId: null });
  mundo.shop = tienda({ isActive: false });
  assert.equal((await avisar()).reason, "notConnected");
  assert.equal(meta.llamadas.length, 0);
  assert.equal(mundo.mensajes.length, 0);
});

test("si el número del dueño es el teléfono de la propia barbería, no se manda", async () => {
  mundo.shop = tienda({ phone: "+52 999 123 4567" });
  assert.deepEqual(await avisar(), { outcome: "skipped", reason: "samePhone", messageId: null });
  assert.equal(meta.llamadas.length, 0);
});

test("plantilla APROBADA y ventana cerrada: sale UNA plantilla, del número de la barbería al del dueño, con sus tres datos", async () => {
  const r = await avisar();
  assert.equal(r.outcome, "sent");
  assert.equal(altas().length, 0, "🔴 nunca se da de alta una plantilla desde aquí");
  const consulta = meta.llamadas.filter((l) => l.metodo === "GET");
  assert.equal(consulta.length, 1);
  assert.match(consulta[0].url, /\/waba-1\/message_templates\?.*name=dc_barber_pedido_nuevo_dueno/);
  const e = envios();
  assert.equal(e.length, 1);
  assert.match(e[0].url, /\/pnid-1\/messages$/, "sale del número de ESTA barbería");
  assert.deepEqual(e[0].cuerpo, {
    messaging_product: "whatsapp",
    to: `52${DUENO}`,
    type: "template",
    template: {
      name: "dc_barber_pedido_nuevo_dueno",
      language: { code: "es_MX" },
      components: [{ type: "body", parameters: PARAMS.map((text) => ({ type: "text", text })) }],
    },
  });
  // Queda registrado como cualquier otro mensaje de la barbería, y cuenta en su cupo.
  assert.equal(mundo.mensajes.length, 1);
  assert.equal(mundo.mensajes[0].status, "SENT");
  assert.equal(mundo.mensajes[0].waMessageId, "wamid.PRUEBA");
  assert.equal(mundo.mensajes[0].phone, DUENO);
  assert.equal(mundo.mensajes[0].templateName, "dc_barber_pedido_nuevo_dueno");
  assert.equal(mundo.cupoSumado, 1);
});

test("plantilla en revisión, rechazada, sin dar de alta o en otro idioma: NO se manda nada y nada queda en cola", async () => {
  for (const caso of [{ plantilla: "PENDING" }, { plantilla: "REJECTED" }, { plantilla: null }, { plantilla: "PAUSED" }, { plantilla: "APPROVED", idioma: "en_US" }]) {
    meta.llamadas = [];
    mundo.mensajes = [];
    meta.plantilla = caso.plantilla;
    meta.idioma = caso.idioma ?? "es_MX";
    const r = await avisar();
    assert.deepEqual(r, { outcome: "skipped", reason: "templateNotApproved", messageId: null }, JSON.stringify(caso));
    assert.equal(envios().length, 0);
    assert.equal(altas().length, 0);
    assert.equal(mundo.mensajes.length, 0, "ni una fila esperando la aprobación");
  }
});

test("si el dueño le escribió a la barbería en las últimas 24 h: sale como TEXTO (gratis), sin preguntar por la plantilla", async () => {
  mundo.mensajes.push({ id: "in-1", barbershopId: "sede-norte", phone: DUENO, direction: "INBOUND", status: "DELIVERED", createdAt: new Date(Date.now() - 60 * 60 * 1000) });
  meta.plantilla = null; // ni siquiera está dada de alta
  const r = await avisar();
  assert.equal(r.outcome, "sent");
  assert.equal(meta.llamadas.filter((l) => l.metodo === "GET").length, 0);
  const e = envios();
  assert.equal(e.length, 1);
  assert.equal(e[0].cuerpo?.type, "text");
  assert.equal((e[0].cuerpo?.text as { body: string }).body, renderOwnerOrderWaText(PARAMS));
  assert.equal(e[0].cuerpo?.to, `52${DUENO}`);
});

test("una ventana de hace más de 24 h no cuenta: vuelve a exigir la plantilla aprobada", async () => {
  mundo.mensajes.push({ id: "in-1", barbershopId: "sede-norte", phone: DUENO, direction: "INBOUND", status: "DELIVERED", createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
  meta.plantilla = "PENDING";
  assert.equal((await avisar()).reason, "templateNotApproved");
  assert.equal(envios().length, 0);
});

test("sin mensajes en el cupo del plan: no se manda (ni se pregunta a Meta)", async () => {
  cuota = 100;
  mundo.shop = tienda({ messagesUsedPeriod: 100 });
  assert.deepEqual(await avisar(), { outcome: "skipped", reason: "noQuota", messageId: null });
  assert.equal(meta.llamadas.length, 0);
});

test("si Meta rechaza el envío: no lanza, dice que falló y la fila queda FAILED (no se reintenta sola)", async () => {
  meta.falla = true;
  const r = await callado(() => avisar());
  assert.equal(r.outcome, "failed");
  assert.equal(envios().length, 1);
  assert.equal(mundo.mensajes[0].status, "FAILED");
  assert.equal(mundo.cupoSumado, 0, "lo que no salió no gasta cupo");
});

test("si la base revienta: no lanza", async () => {
  const original = fakePrisma.barbershop.findUnique;
  fakePrisma.barbershop.findUnique = async () => {
    throw new Error("la base no contesta");
  };
  try {
    const r = await callado(() => avisar());
    assert.deepEqual(r, { outcome: "failed", reason: "No se pudo enviar el aviso.", messageId: null });
  } finally {
    fakePrisma.barbershop.findUnique = original;
  }
});

test("un aviso al dueño que se quedó atorado más de 2 h ya no sale", () => {
  assert.equal(BARBER_OWNER_NOTICE_TTL_MS, 2 * 60 * 60 * 1000);
  const now = new Date("2026-11-16T20:00:00Z");
  const hace = (min: number) => new Date(now.getTime() - min * 60 * 1000);
  assert.equal(barberOutboxStaleReason({ kind: "ownerOrder", createdAt: hace(30), now, appointment: null }), null);
  assert.match(barberOutboxStaleReason({ kind: "ownerOrder", createdAt: hace(121), now, appointment: null }) ?? "", /caducó/);
});

// ── 4. Dentro del aviso del pedido (pedido-avisos.ts), con el emisor doblado ──

test("pedido nuevo con el WhatsApp encendido: se llama UNA vez al emisor con el número y los datos; el correo sale aparte", async () => {
  const avisos = await import("@/lib/barber/pedido-avisos");
  const filas = new Map<string, { status: string; detail: string | null }>();
  const llamadasWa: unknown[] = [];
  const correos: string[] = [];
  const store: import("@/lib/barber/pedido-avisos").OrderNoticeStore = {
    ready: async () => true,
    loadOrder: async () => ({
      order: { id: "ped-1", folio: "K7M2Q", clientName: "Luis", clientPhone: "9990000000", items: [{ name: "Cera", qty: 1, unitPrice: 499.48 }], total: 499.48, payOnline: false, paid: false },
      barbershopId: "sede-norte",
      parentId: null,
      shopName: "Barbería Prueba",
      branchName: null,
      locale: "en", // aunque el panel esté en inglés, la plantilla aprobada es en español
      fallbackEmails: [],
      settings: { email: true, whatsapp: true, phone: DUENO },
    }),
    ownerEmails: async () => ["dueno@prueba.mx"],
    claim: async (o, k, c) => {
      const key = `${o}|${k}|${c}`;
      if (filas.has(key)) return false;
      filas.set(key, { status: "SENDING", detail: null });
      return true;
    },
    finish: async (o, k, c, status, detail) => void filas.set(`${o}|${k}|${c}`, { status, detail }),
  };
  const deps = {
    store,
    siteUrl: "https://www.dalecontrol.com",
    sendEmail: async (p: { to: string }) => (correos.push(p.to), { delivered: true }),
    sendWhatsApp: async (a: unknown) => (llamadasWa.push(a), { outcome: "sent" as const, reason: null }),
  };
  const r = await avisos.notifyOwnerOfOrder("NEW", "ped-1", deps);
  assert.deepEqual(r.channels.map((c) => `${c.channel}:${c.outcome}`), ["EMAIL:sent", "WHATSAPP:sent"]);
  assert.deepEqual(llamadasWa, [{ barbershopId: "sede-norte", kind: "NEW", enabled: true, ownerPhone: DUENO, params: ["K7M2Q", "$499.48", "Paga en la barbería"] }]);
  assert.equal(filas.get("ped-1|NEW|WHATSAPP")?.status, "SENT");

  // Otra vez (reintento): ni otro correo ni otro WhatsApp.
  const otra = await avisos.notifyOwnerOfOrder("NEW", "ped-1", deps);
  assert.deepEqual(otra.channels.map((c) => c.outcome), ["duplicate", "duplicate"]);
  assert.equal(llamadasWa.length, 1);
  assert.equal(correos.length, 1);

  // Al pagarse: correo sí, WhatsApp no (ni se reclama).
  const pagado = await avisos.notifyOwnerOfOrder("PAID", "ped-1", { ...deps, store: { ...store, loadOrder: async () => ({ ...(await store.loadOrder("ped-1"))!, order: { ...(await store.loadOrder("ped-1"))!.order, paid: true } }) } });
  assert.deepEqual(pagado.channels.map((c) => `${c.channel}:${c.outcome}`), ["EMAIL:sent"]);
  assert.equal(llamadasWa.length, 1);
  assert.equal(filas.has("ped-1|PAID|WHATSAPP"), false);
});

test("con el WhatsApp APAGADO (como nace) el emisor ni se llama; si no toca mandarlo queda anotado por qué; si revienta, el correo ya salió", async () => {
  const avisos = await import("@/lib/barber/pedido-avisos");
  const hacer = async (settings: { email: boolean; whatsapp: boolean; phone: string | null }, wa: () => Promise<{ outcome: "sent" | "skipped" | "queued" | "failed"; reason: string | null }>) => {
    const filas = new Map<string, { status: string; detail: string | null }>();
    let llamadas = 0;
    const correos: string[] = [];
    const r = await avisos.notifyOwnerOfOrder("NEW", "ped-1", {
      siteUrl: "https://x",
      sendEmail: async (p) => (correos.push(p.to), { delivered: true }),
      sendWhatsApp: async () => {
        llamadas++;
        return wa();
      },
      store: {
        ready: async () => true,
        loadOrder: async () => ({
          order: { id: "ped-1", folio: "K7M2Q", clientName: "Luis", clientPhone: "9990000000", items: [], total: 10, payOnline: false, paid: false },
          barbershopId: "sede-norte",
          parentId: null,
          shopName: "Barbería Prueba",
          branchName: null,
          locale: "es",
          fallbackEmails: [],
          settings,
        }),
        ownerEmails: async () => ["dueno@prueba.mx"],
        claim: async (o, k, c) => (filas.has(`${o}|${k}|${c}`) ? false : (filas.set(`${o}|${k}|${c}`, { status: "SENDING", detail: null }), true)),
        finish: async (o, k, c, status, detail) => void filas.set(`${o}|${k}|${c}`, { status, detail }),
      },
    });
    return { r, filas, llamadas, correos };
  };
  const apagado = await hacer({ ...ORDER_NOTICE_DEFAULTS }, async () => ({ outcome: "sent", reason: null }));
  assert.equal(apagado.llamadas, 0);
  assert.deepEqual(apagado.r.channels.map((c) => c.channel), ["EMAIL"]);
  assert.equal(apagado.filas.has("ped-1|NEW|WHATSAPP"), false);

  const sinAprobar = await hacer({ email: true, whatsapp: true, phone: DUENO }, async () => ({ outcome: "skipped", reason: "templateNotApproved" }));
  assert.deepEqual(sinAprobar.r.channels[1], { channel: "WHATSAPP", outcome: "skipped", detail: "templateNotApproved" });
  assert.deepEqual(sinAprobar.filas.get("ped-1|NEW|WHATSAPP"), { status: "SKIPPED", detail: "templateNotApproved" });
  assert.equal(sinAprobar.correos.length, 1, "el correo basta");

  const revienta = await hacer({ email: true, whatsapp: true, phone: DUENO }, async () => {
    throw new Error("Meta caída");
  });
  assert.equal(revienta.r.ran, true);
  assert.deepEqual(revienta.r.channels.map((c) => `${c.channel}:${c.outcome}`), ["EMAIL:sent", "WHATSAPP:failed"]);
  assert.equal(revienta.filas.get("ped-1|NEW|WHATSAPP")?.status, "FAILED");

  const soloWa = await hacer({ email: false, whatsapp: true, phone: DUENO }, async () => ({ outcome: "queued", reason: "BUSY" }));
  assert.deepEqual(soloWa.r.channels, [{ channel: "WHATSAPP", outcome: "sent", detail: "en cola" }]);
  assert.equal(soloWa.correos.length, 0);
});

// ── 5. La pantalla ───────────────────────────────────────────────────────

test("Notificaciones: el interruptor de WhatsApp, su número y la nota del cobro de Meta, en es y en", () => {
  const tarjeta = leer("src/components/barber/configuracion/notificaciones-card.tsx");
  assert.match(tarjeta, /title=\{k\("whatsapp"\)\}/);
  assert.match(tarjeta, /data-aviso-costo-meta/);
  assert.match(tarjeta, /const waLocked = !value\.persisted \|\| \(!value\.whatsappConnected && !whatsapp\);/, "sin WhatsApp conectado no se puede encender");
  assert.match(tarjeta, /const waNeedsPhone = whatsapp && phoneClean === null;/, "encendido sin número no se guarda");
  const es = JSON.parse(leer("src/i18n/dictionaries/barber/ajustes.es.json")).configuracion.notifications;
  const en = JSON.parse(leer("src/i18n/dictionaries/barber/ajustes.en.json")).configuracion.notifications;
  assert.match(es.whatsapp, /^Avisarme por WhatsApp/);
  assert.match(es.whatsappCost, /^Meta te cobra cada aviso fuera de las 24 h/);
  assert.match(en.whatsappCost, /^Meta charges you for each notice outside the 24 h/);
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
});

test("el emisor decide ANTES de encolar, pregunta solo por ESA plantilla y manda por el camino de siempre", () => {
  const src = leer("src/lib/barber/whatsapp.ts");
  const fn = src.slice(src.indexOf("export async function notifyBarberOwnerOrder("), src.indexOf("/* ──────────────────────── recordatorios de cita"));
  assert.ok(fn.length > 500);
  assert.ok(fn.lastIndexOf("if (decision.send === null) return skipped(decision);") < fn.indexOf("await enqueueBarberMessage("), "primero la decisión, luego la fila");
  assert.match(fn, /fetchBarberTemplateRows\(creds, \{ name: tpl\.name \}\)/);
  assert.match(fn, /await deliverBarberMessageNow\(shop\.id, messageId\)/);
  assert.doesNotMatch(fn, /provisionBarberTemplates|message_templates`,\s*\{\s*method: "POST"/, "aquí no se dan de alta plantillas");
  assert.match(src, /if \(templateName === barberWaTemplate\("ownerOrder"\)\.name\) return "ownerOrder";/);
  assert.match(src, /const params = parseOwnerOrderWaBody\(row\.body\);/);
});
