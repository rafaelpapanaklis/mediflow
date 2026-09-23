// ws1-t1 — Mercado Pago como método de pago de una factura, conducido de verdad:
// el servicio real contra una base en memoria (doble-base.ts: `where` real,
// candados reales, barrera) y un Mercado Pago de mentira.
//
// Cubre lo que no se negocia:
//   · el monto SIEMPRE es el saldo que lee el servidor (total − pagado);
//   · un pago no se aplica dos veces (webhook repetido, en fila y a la vez);
//   · el dinero va a la cuenta de la clínica y sin comisión (marketplace_fee 0);
//   · sin Mercado Pago conectado, el método no se ofrece;
// y además: el link se reutiliza, se rehace si el saldo cambió, no se cruza de
// clínica, y lo raro (cancelada, excedente, devolución) se registra marcado.
//
// Correr: npm run test:factura-mp

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DobleBase } from "./doble-base";
import { linkParaEnviar, SIN_PERMISO_LINK } from "../envio.server";
import {
  aplicarPagoDeFactura,
  cerrarLinksDeFactura,
  cobroMpDisponible,
  estadoDelLink,
  obtenerLinkDeFactura,
  type DepsFacturaMp,
} from "../servicio.server";
import { METODO_MERCADO_PAGO, lineaLinkWhatsApp, refDeFactura } from "../core";
import { buildPaymentNotice } from "../../invoices/payment-notice";
import { buildCorreoFactura } from "../../invoices/correo-factura";
import { normalizarCondiciones } from "../../quotes/condiciones-pago";
import type { CreatePreferenceOptions, MercadoPagoPayment } from "../../mercadopago";

const T0 = new Date("2026-09-23T16:00:00Z");
const DIA = 24 * 60 * 60 * 1000;

interface Mp {
  preferencias: Array<{ token: string; opts: CreatePreferenceOptions; id: string }>;
  expiradas: string[];
  pagos: Map<string, MercadoPagoPayment>;
  consultas: number;
  falla: boolean;
}

function escenario(opts: { cuenta?: boolean; plataforma?: boolean } = {}) {
  const db = new DobleBase();
  db.tablas.clinic.push({ id: "c1", name: "Clínica Sonrisa" }, { id: "c2", name: "Otra Clínica" });
  if (opts.cuenta !== false) {
    db.tablas.clinicMercadoPago.push({ clinicId: "c1", mpUserId: "999", accessToken: "v1:cifrado" });
  }
  // `balance` desfasado A PROPÓSITO: el link debe cobrar total − pagado (1000),
  // no la columna.
  db.tablas.invoice.push(
    { id: "f1", clinicId: "c1", patientId: "p1", invoiceNumber: "F-0001", status: "PENDING", total: 1500, paid: 500, balance: 1234.56, paymentMethod: null, paidAt: null },
    { id: "f2", clinicId: "c2", patientId: "p9", invoiceNumber: "F-0001", status: "PENDING", total: 800, paid: 0, balance: 800, paymentMethod: null, paidAt: null },
  );
  const mp: Mp = { preferencias: [], expiradas: [], pagos: new Map(), consultas: 0, falla: false };
  let ahora = T0;
  const deps: Partial<DepsFacturaMp> = {
    db: db.db(),
    plataformaLista: () => opts.plataforma !== false,
    baseUrl: () => "https://app.dalecontrol.test",
    ahora: () => ahora,
    credencial: async (clinicId) =>
      db.tablas.clinicMercadoPago.some((c) => c.clinicId === clinicId && c.accessToken)
        ? { accessToken: `tok-${clinicId}`, mpUserId: db.tablas.clinicMercadoPago.find((c) => c.clinicId === clinicId)!.mpUserId }
        : null,
    crearPreferencia: async (token, o) => {
      if (mp.falla) throw new Error("Mercado Pago 503");
      const id = `pref-${mp.preferencias.length + 1}`;
      mp.preferencias.push({ token, opts: o, id });
      return { id, initPoint: `https://mp.test/checkout/${id}` };
    },
    expirarPreferencia: async (_t, id) => { mp.expiradas.push(id); },
    consultarPago: async (_token, id) => {
      mp.consultas++;
      return mp.pagos.get(id) ?? null;
    },
  };
  return { db, mp, deps, avanzar: (ms: number) => { ahora = new Date(ahora.getTime() + ms); } };
}

function pagoMp(id: string, linkId: string, extra: Partial<MercadoPagoPayment> = {}): MercadoPagoPayment {
  return {
    id,
    status: "approved",
    statusDetail: "accredited",
    externalReference: refDeFactura(linkId),
    transactionAmount: 1000,
    currencyId: "MXN",
    transactionAmountRefunded: 0,
    dateApproved: "2026-09-23T09:55:00.000-06:00",
    collectorId: "999",
    payerEmail: "paciente@correo.test",
    paymentMethodId: "visa",
    ...extra,
  };
}

async function linkDeF1(e: ReturnType<typeof escenario>) {
  const r = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1", userId: "u1" }, e.deps);
  assert.ok(r.ok && r.link, `no salió el link: ${r.error}`);
  const fila = e.db.tablas.invoicePaymentLink.find((l) => l.checkoutUrl === r.link!.url)!;
  return { r, fila };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("el monto lo decide el servidor", () => {
  it("el link cobra total − pagado de la factura, no la columna balance ni nada del cliente", async () => {
    const e = escenario();
    const { r, fila } = await linkDeF1(e);
    assert.equal(r.link!.monto, 1000);
    assert.equal(fila.amount, 1000);
    assert.equal(e.mp.preferencias.length, 1);
    assert.deepEqual(e.mp.preferencias[0].opts.items, [{ title: "Nota F-0001 — Clínica Sonrisa", quantity: 1, unit_price: 1000 }]);
  });

  it("obtenerLinkDeFactura ni siquiera acepta un monto, y la ruta POST no lee el cuerpo", async () => {
    // Estructural: si alguien añade un `amount` a la firma o un req.json() a la
    // ruta, esta prueba lo dice antes que un paciente.
    const ruta = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "invoices", "[id]", "link-pago", "route.ts"), "utf8");
    const post = ruta.slice(ruta.indexOf("export async function POST"));
    assert.ok(!/req\.json\(|req\.text\(|req\.formData\(/.test(post), "el POST del link lee el cuerpo de la petición");
    const e = escenario();
    const r = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1", userId: "u1", amount: 1 } as any, e.deps);
    assert.equal(r.link!.monto, 1000, "un monto colado en los argumentos no se usa");
  });

  it("cobra la CUENTA DE LA CLÍNICA y sin comisión de DaleControl", async () => {
    const e = escenario();
    await linkDeF1(e);
    const p = e.mp.preferencias[0];
    assert.equal(p.token, "tok-c1", "la preferencia se crea con el token de la clínica");
    assert.equal(p.opts.marketplaceFee, 0);
    assert.equal(p.opts.externalReference, refDeFactura(e.db.tablas.invoicePaymentLink[0].id));
    assert.match(p.opts.notificationUrl, /\/api\/webhooks\/mercadopago\?ref=factura%3A/);
    assert.equal(e.db.tablas.invoicePaymentLink[0].mpCollectorId, "999");
  });
});

describe("sin Mercado Pago conectado el método ni se ofrece", () => {
  it("clínica sin cuenta: no disponible y no se crea nada en MP", async () => {
    const e = escenario({ cuenta: false });
    assert.equal(await cobroMpDisponible("c1", e.deps), false);
    const r = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "sin_mp");
    assert.equal(e.mp.preferencias.length, 0);
    assert.equal((await estadoDelLink({ clinicId: "c1", invoiceId: "f1" }, e.deps)).disponible, false);
  });

  it("cuenta desconectada (token en NULL): tampoco", async () => {
    const e = escenario();
    e.db.tablas.clinicMercadoPago[0].accessToken = null;
    assert.equal(await cobroMpDisponible("c1", e.deps), false);
  });

  it("plataforma sin variables de MP, o SQL de la rama sin aplicar: tampoco", async () => {
    assert.equal(await cobroMpDisponible("c1", escenario({ plataforma: false }).deps), false);
    const e = escenario();
    e.db.sinTabla.add("invoicePaymentLink");
    assert.equal(await cobroMpDisponible("c1", e.deps), false);
    assert.equal((await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps)).error, "sin_mp");
  });

  it("con la cuenta conectada, sí", async () => {
    assert.equal(await cobroMpDisponible("c1", escenario().deps), true);
  });
});

describe("el link", () => {
  it("se reutiliza: correo, WhatsApp y «copiar» reparten el MISMO link", async () => {
    const e = escenario();
    const a = await linkDeF1(e);
    const b = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(b.link!.url, a.r.link!.url);
    assert.equal(b.reutilizado, true);
    assert.equal(e.mp.preferencias.length, 1);
    const est = await estadoDelLink({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(est.link!.url, a.r.link!.url);
  });

  it("si el saldo cambió se hace otro, el viejo queda REPLACED y se cierra en MP", async () => {
    const e = escenario();
    const a = await linkDeF1(e);
    e.db.tablas.invoice[0].paid = 700; // la recepción cobró $200 en caja
    const b = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.notEqual(b.link!.url, a.r.link!.url);
    assert.equal(b.link!.monto, 800);
    assert.equal(a.fila.status, "REPLACED");
    assert.deepEqual(e.mp.expiradas, ["pref-1"]);
  });

  it("a punto de vencer no se reparte: se hace otro", async () => {
    const e = escenario();
    await linkDeF1(e);
    e.avanzar(29.5 * DIA);
    const b = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(b.reutilizado, false);
    assert.equal(e.mp.preferencias.length, 2);
  });

  it("no se cruza de clínica: la factura de c2 no existe para c1", async () => {
    const e = escenario();
    const r = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f2" }, e.deps);
    assert.equal(r.error, "no_encontrada");
    assert.equal(e.mp.preferencias.length, 0);
    const vacio = await obtenerLinkDeFactura({ clinicId: "", invoiceId: "f1" }, e.deps);
    assert.equal(vacio.error, "no_encontrada", "sin clinicId se corta antes de consultar");
  });

  it("solo facturas con saldo cobrable: borrador, pagada, cancelada y bajo el mínimo no", async () => {
    for (const [cambio, esperado] of [
      [{ status: "DRAFT" }, "estado"],
      [{ status: "CANCELLED" }, "estado"],
      [{ status: "PAID", paid: 1500 }, "estado"],
      [{ status: "PARTIAL", paid: 1500 }, "sin_saldo"],
      [{ status: "PARTIAL", paid: 1495 }, "bajo_minimo"],
    ] as const) {
      const e = escenario();
      Object.assign(e.db.tablas.invoice[0], cambio);
      const r = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
      assert.equal(r.error, esperado, JSON.stringify(cambio));
      assert.equal(e.mp.preferencias.length, 0);
    }
  });

  it("si MP no genera el link, no queda una fila PENDING sin link", async () => {
    const e = escenario();
    e.mp.falla = true;
    const r = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(r.error, "mp_fallo");
    assert.equal(e.db.tablas.invoicePaymentLink.length, 0);
  });

  it("dos clics a la vez: sale UN link, no dos (candado por factura)", async () => {
    const e = escenario();
    const [a, b] = await Promise.all([
      obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps),
      obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps),
    ]);
    assert.equal(a.link!.url, b.link!.url);
    assert.equal(e.mp.preferencias.length, 1);
    assert.ok(e.db.candadosPedidos.includes("advisory:factura-mp:f1"));
  });

  it("CONTROL: sin el candado, la misma prueba saca dos links (la barrera funciona)", async () => {
    const e = escenario();
    e.db.ignorarCandados = true;
    await Promise.all([
      obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps),
      obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps),
    ]);
    assert.equal(e.mp.preferencias.length, 2);
  });
});

describe("un link por un saldo viejo no se reparte", () => {
  it("el detalle NO enseña (ni deja copiar) un link cuyo monto ya no es el saldo", async () => {
    const e = escenario();
    const a = await linkDeF1(e);
    assert.equal((await estadoDelLink({ clinicId: "c1", invoiceId: "f1" }, e.deps)).link!.url, a.r.link!.url);
    e.db.tablas.invoice[0].paid = 900; // $400 en caja, por una vía que no cerró el link
    const est = await estadoDelLink({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(est.link, null, "el link de $1,000 no se ofrece con saldo de $600");
    assert.equal(est.habiaLink, true, "pero se sabe que se cobra por Mercado Pago (se ofrece hacer otro)");
    assert.equal(est.saldo, 600);
  });

  it("cobrar a mano cierra los links pendientes: quedan REPLACED y se cierran en MP", async () => {
    const e = escenario();
    const a = await linkDeF1(e);
    const n = await cerrarLinksDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(n, 1);
    assert.equal(e.db.candadosPedidos.filter((c) => c === "advisory:factura-mp:f1").length, 2, "crear y cerrar toman el mismo candado");
    assert.equal(a.fila.status, "REPLACED");
    assert.deepEqual(e.mp.expiradas, ["pref-1"]);
    assert.equal((await estadoDelLink({ clinicId: "c1", invoiceId: "f1" }, e.deps)).link, null);
  });

  it("un link que se está creando con el saldo VIEJO mientras cobran en caja: termina cerrado", async () => {
    // OJO: el doble no aísla transacciones (el cierre VE la fila a medio crear),
    // así que esta prueba pasaría también sin el candado. Lo que vigila que el
    // cierre y la creación se formen es la prueba de arriba (los dos piden
    // «advisory:factura-mp:<id>»); ésta documenta el resultado esperado.
    const e = escenario();
    let cierre: Promise<number> | null = null;
    const crear = e.deps.crearPreferencia!;
    e.deps.crearPreferencia = async (token, o) => {
      // A media llamada a MP, la recepción cobra en caja y la ruta llama al cierre.
      e.db.tablas.invoice[0].paid = 900;
      cierre = cerrarLinksDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
      await new Promise((r) => setTimeout(r, 20));
      return crear(token, o);
    };
    const r = await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    assert.equal(r.link!.monto, 1000, "el link salió con el saldo de antes");
    assert.equal(await cierre, 1, "el cierre esperó al candado y lo encontró");
    assert.equal(e.db.tablas.invoicePaymentLink[0].status, "REPLACED");
    assert.deepEqual(e.mp.expiradas, ["pref-1"]);
  });

  it("cerrar links nunca tumba el cobro: otra clínica no toca nada, sin SQL devuelve 0, MP caído no lanza", async () => {
    const e = escenario();
    const a = await linkDeF1(e);
    assert.equal(await cerrarLinksDeFactura({ clinicId: "c2", invoiceId: "f1" }, e.deps), 0);
    assert.equal(a.fila.status, "PENDING");
    assert.equal(await cerrarLinksDeFactura({ clinicId: "", invoiceId: "f1" }, e.deps), 0);
    const caido = { ...e.deps, expirarPreferencia: async () => { throw new Error("MP 503"); } };
    assert.equal(await cerrarLinksDeFactura({ clinicId: "c1", invoiceId: "f1" }, caido), 1);
    const sinSql = escenario();
    sinSql.db.sinTabla.add("invoicePaymentLink");
    assert.equal(await cerrarLinksDeFactura({ clinicId: "c1", invoiceId: "f1" }, sinSql.deps), 0);
  });
});

describe("el link en el correo / WhatsApp solo va si se pide", () => {
  it("sin pedirlo: nada, ni una llamada a Mercado Pago (Sabina enseña justo lo que sale)", async () => {
    const e = escenario();
    const r = await linkParaEnviar({ clinicId: "c1", invoiceId: "f1", userId: "u1", pedido: false, puedeCobrar: true }, e.deps);
    assert.deepEqual(r, { link: null, aviso: null });
    assert.equal(e.mp.preferencias.length, 0);
  });

  it("pedido sin permiso de cobrar: sale sin link y se dice por qué", async () => {
    const e = escenario();
    const r = await linkParaEnviar({ clinicId: "c1", invoiceId: "f1", userId: "u1", pedido: true, puedeCobrar: false }, e.deps);
    assert.equal(r.link, null);
    assert.equal(r.aviso, SIN_PERMISO_LINK);
    assert.equal(e.mp.preferencias.length, 0);
  });

  it("pedido con permiso: el link del saldo; sin cuenta de MP, el aviso", async () => {
    const e = escenario();
    const r = await linkParaEnviar({ clinicId: "c1", invoiceId: "f1", userId: "u1", pedido: true, puedeCobrar: true }, e.deps);
    assert.equal(r.link!.monto, 1000);
    const sin = escenario({ cuenta: false });
    const r2 = await linkParaEnviar({ clinicId: "c1", invoiceId: "f1", userId: "u1", pedido: true, puedeCobrar: true }, sin.deps);
    assert.equal(r2.link, null);
    assert.match(r2.aviso ?? "", /no tiene Mercado Pago conectado/);
  });

  it("una factura ya pagada mandada por correo con el pedido: sin link y sin aviso", async () => {
    const e = escenario();
    Object.assign(e.db.tablas.invoice[0], { status: "PAID", paid: 1500 });
    const r = await linkParaEnviar({ clinicId: "c1", invoiceId: "f1", userId: "u1", pedido: true, puedeCobrar: true }, e.deps);
    assert.deepEqual(r, { link: null, aviso: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("el webhook registra el pago solo", () => {
  it("pago aprobado: un Payment «mercadopago» con la referencia de MP y la factura PAGADA", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    const r = await aplicarPagoDeFactura(fila.id, "555", e.deps);
    assert.equal(r.aplicado, true);
    assert.equal(r.anomalia, null);
    const pagos = e.db.tablas.payment;
    assert.equal(pagos.length, 1);
    assert.equal(pagos[0].method, METODO_MERCADO_PAGO);
    assert.equal(pagos[0].reference, "555");
    assert.equal(pagos[0].amount, 1000);
    assert.equal(pagos[0].invoiceId, "f1");
    assert.equal(pagos[0].paidAt.toISOString(), "2026-09-23T15:55:00.000Z", "cuándo lo aprobó MP");
    const inv = e.db.tablas.invoice[0];
    assert.equal(inv.status, "PAID");
    assert.equal(inv.paid, 1500);
    assert.equal(inv.balance, 0);
    assert.equal(inv.paymentMethod, METODO_MERCADO_PAGO);
    assert.equal(fila.status, "PAID");
    assert.equal(fila.mpPaymentId, "555");
    assert.ok(e.db.candadosPedidos.includes("invoices:f1"), "toma el FOR UPDATE de la factura");
  });

  it("el importe es lo que MP dice que se pagó: un abono menor deja la factura PARCIAL", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("556", pagoMp("556", fila.id, { transactionAmount: 400 }));
    await aplicarPagoDeFactura(fila.id, "556", e.deps);
    const inv = e.db.tablas.invoice[0];
    assert.equal(inv.status, "PARTIAL");
    assert.equal(inv.paid, 900);
    assert.equal(inv.balance, 600);
  });

  it("webhook REPETIDO: la segunda entrega no crea otro pago", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    const otra = await aplicarPagoDeFactura(fila.id, "555", e.deps);
    const otraMas = await aplicarPagoDeFactura(fila.id, "555", e.deps);
    assert.equal(otra.aplicado, false);
    assert.equal(otra.motivo, "pago ya aplicado");
    assert.equal(otraMas.aplicado, false);
    assert.equal(e.db.tablas.payment.length, 1);
    assert.equal(e.db.tablas.invoice[0].paid, 1500);
  });

  it("dos entregas del MISMO pago A LA VEZ: un solo Payment (FOR UPDATE + dedup)", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    const rs = await Promise.all([
      aplicarPagoDeFactura(fila.id, "555", e.deps),
      aplicarPagoDeFactura(fila.id, "555", e.deps),
      aplicarPagoDeFactura(fila.id, "555", e.deps),
    ]);
    assert.equal(rs.filter((r) => r.aplicado).length, 1);
    assert.equal(e.db.tablas.payment.length, 1);
    assert.equal(e.db.tablas.invoice[0].paid, 1500);
  });

  it("CONTROL: sin el candado, las mismas tres entregas SÍ duplican (la prueba muerde)", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    e.db.ignorarCandados = true;
    await Promise.all([
      aplicarPagoDeFactura(fila.id, "555", e.deps),
      aplicarPagoDeFactura(fila.id, "555", e.deps),
    ]);
    assert.equal(e.db.tablas.payment.length, 2);
  });

  it("nada del cuerpo del webhook se cree: se re-consulta el pago a MP con el token de la clínica", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    // MP no conoce ese pago (id inventado por quien llama al webhook).
    const r = await aplicarPagoDeFactura(fila.id, "999999", e.deps);
    assert.equal(r.aplicado, false);
    assert.equal(e.mp.consultas, 1);
    assert.equal(e.db.tablas.payment.length, 0);
  });

  it("pago de OTRO link (referencia que no coincide) u otra cuenta: se ignora", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("1", pagoMp("1", "otro-link"));
    e.mp.pagos.set("2", pagoMp("2", fila.id, { collectorId: "123" }));
    assert.equal((await aplicarPagoDeFactura(fila.id, "1", e.deps)).aplicado, false);
    assert.equal((await aplicarPagoDeFactura(fila.id, "2", e.deps)).aplicado, false);
    assert.equal(e.db.tablas.payment.length, 0);
    assert.equal(e.db.tablas.invoice[0].status, "PENDING");
  });

  it("pago rechazado o en proceso: no registra nada, se anota en el link", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("7", pagoMp("7", fila.id, { status: "rejected", statusDetail: "cc_rejected_insufficient_amount" }));
    e.mp.pagos.set("8", pagoMp("8", fila.id, { status: "in_process" }));
    await aplicarPagoDeFactura(fila.id, "7", e.deps);
    assert.equal(fila.lastMpStatus, "rejected");
    await aplicarPagoDeFactura(fila.id, "8", e.deps);
    assert.equal(e.db.tablas.payment.length, 0);
    assert.equal(fila.status, "PENDING");
  });

  it("clínica que desconectó la cuenta: LANZA para que MP reintente (no se pierde el pago)", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    e.db.tablas.clinicMercadoPago[0].accessToken = null;
    await assert.rejects(aplicarPagoDeFactura(fila.id, "555", e.deps));
    assert.equal(e.db.tablas.payment.length, 0);
    // La reconecta y el reintento de MP lo aplica.
    e.db.tablas.clinicMercadoPago[0].accessToken = "v1:otro";
    assert.equal((await aplicarPagoDeFactura(fila.id, "555", e.deps)).aplicado, true);
  });

  it("conectó OTRA cuenta después de mandar el link: LANZA y lo anota", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.db.tablas.clinicMercadoPago[0].mpUserId = "777";
    await assert.rejects(aplicarPagoDeFactura(fila.id, "555", e.deps));
    assert.equal(fila.lastMpStatus, "otra_cuenta");
    assert.equal(e.mp.consultas, 0);
  });

  it("una fecha de aprobación en el futuro (reloj de MP) no se acepta: se usa la de ahora", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id, { dateApproved: "2026-09-23T12:00:00.000-06:00" }));
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    assert.equal(e.db.tablas.payment[0].paidAt.toISOString(), T0.toISOString());
  });

  it("excedente (cobraron una parte en caja con el link ya enviado): entra tal cual y queda MARCADO", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.db.tablas.invoice[0].paid = 1100; // $600 en caja; el link pedía 1000
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    const r = await aplicarPagoDeFactura(fila.id, "555", e.deps);
    assert.match(r.anomalia ?? "", /excedente de \$600\.00/);
    assert.match(e.db.tablas.payment[0].notes, /^⚠️/);
    assert.equal(e.db.tablas.invoice[0].paid, 2100);
    assert.equal(e.db.tablas.invoice[0].balance, 0);
    assert.equal(e.db.tablas.invoice[0].status, "PAID");
  });

  it("factura cancelada: el pago se registra marcado y la factura NO cambia", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.db.tablas.invoice[0].status = "CANCELLED";
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    const r = await aplicarPagoDeFactura(fila.id, "555", e.deps);
    assert.equal(r.aplicado, true);
    assert.match(r.anomalia ?? "", /factura cancelada/);
    assert.equal(e.db.tablas.payment.length, 1);
    assert.equal(e.db.tablas.invoice[0].paid, 500);
    assert.equal(e.db.tablas.invoice[0].status, "CANCELLED");
  });

  it("un link viejo (REPLACED) que alguien paga igual: el dinero se registra", async () => {
    const e = escenario();
    const viejo = await linkDeF1(e);
    e.db.tablas.invoice[0].paid = 600;
    await obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1" }, e.deps);
    e.mp.pagos.set("555", pagoMp("555", viejo.fila.id));
    const r = await aplicarPagoDeFactura(viejo.fila.id, "555", e.deps);
    assert.equal(r.aplicado, true);
    assert.equal(e.db.tablas.invoice[0].paid, 1600);
    assert.match(r.anomalia ?? "", /excedente/);
  });

  it("reembolso PARCIAL (el pago sigue approved): el Payment queda anotado una vez, la factura no se toca", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    e.mp.pagos.set("555", pagoMp("555", fila.id, { transactionAmountRefunded: 250 }));
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    const p = e.db.tablas.payment[0];
    assert.equal((p.notes.match(/\$250\.00 devueltos/g) ?? []).length, 1);
    assert.equal(e.db.tablas.payment.length, 1);
    assert.equal(e.db.tablas.invoice[0].paid, 1500);
  });

  it("MP reporta DESPUÉS una devolución: el Payment queda anotado y la factura no se toca sola", async () => {
    const e = escenario();
    const { fila } = await linkDeF1(e);
    e.mp.pagos.set("555", pagoMp("555", fila.id));
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    e.mp.pagos.set("555", pagoMp("555", fila.id, { status: "refunded" }));
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    await aplicarPagoDeFactura(fila.id, "555", e.deps);
    const p = e.db.tablas.payment[0];
    assert.equal((p.notes.match(/refunded/g) ?? []).length, 1, "la nota no se repite");
    assert.equal(e.db.tablas.invoice[0].status, "PAID");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("los mensajes llevan el link y el monto", () => {
  const link = { url: "https://mp.test/checkout/pref-1", monto: 1000 };

  it("WhatsApp: frase corta, monto y link en su propia línea; la plantilla no cambia", () => {
    const base = { patient: { firstName: "Ana", lastName: "Ruiz" }, clinicName: "Clínica Sonrisa", clinicPhone: "5550001111", invoiceNumber: "F-0001", balance: 1000, items: [] };
    const con = buildPaymentNotice({ ...base, linkPago: link });
    const sin = buildPaymentNotice(base);
    assert.ok(con.body.includes(lineaLinkWhatsApp(link.url, 1000)));
    assert.match(con.body, /\$1,000\.00 en línea con Mercado Pago aquí:\nhttps:\/\/mp\.test\/checkout\/pref-1\n/);
    assert.deepEqual(con.templateParams, sin.templateParams);
    assert.ok(!sin.body.includes("Mercado Pago"), "sin link, el aviso de siempre");
  });

  it("correo: el link y el monto en texto y en HTML (escapado); a una pagada no se le manda", () => {
    const base = { patient: { firstName: "Ana" }, clinicName: "Clínica Sonrisa", clinicPhone: "5550001111", invoiceNumber: "F-0001", total: 1500, paid: 500, balance: 1000, items: [] };
    const c = buildCorreoFactura({ ...base, linkPago: { url: 'https://mp.test/x?a=1&b="2"', monto: 1000 } });
    assert.match(c.text, /Paga \$1,000\.00 en línea con Mercado Pago:\nhttps:\/\/mp\.test\/x\?a=1&b="2"/);
    assert.ok(c.html.includes('href="https://mp.test/x?a=1&amp;b=&quot;2&quot;"'));
    const pagada = buildCorreoFactura({ ...base, paid: 1500, balance: 0, linkPago: link });
    assert.ok(!pagada.text.includes("Mercado Pago"));
  });
});

describe("el trato de la factura", () => {
  it("Mercado Pago se guarda en un solo pago, y en un plan a plazos no", () => {
    assert.equal(normalizarCondiciones({ modo: "unico", metodo: "mercadopago" }, 1000).metodo, "mercadopago");
    assert.equal(normalizarCondiciones({ modo: "plazos", metodo: "mercadopago", numPagos: 3 }, 1000).metodo, null);
  });
});
