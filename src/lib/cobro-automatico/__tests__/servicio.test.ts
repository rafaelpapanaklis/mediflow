/**
 * Cobro automático con tarjeta (ws1-t6) — el servicio entero con un Mercado Pago
 * SIMULADO y una base en memoria. Ni red, ni base, ni cobros reales: `@/lib/prisma`
 * se sustituye por un doble que LANZA si alguien lo usa, y cada llamada a MP se
 * anota para comprobar QUÉ se le habría pedido.
 *
 * Run: npm run test:cobro-automatico
 */
import Module from "node:module";
import path from "node:path";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");
const prohibido = new Proxy({}, { get: (_t, k) => { throw new Error(`prueba: nadie debe tocar la base real (prisma.${String(k)})`); } });
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown; _resolveFilename: (r: string, p: unknown, m: boolean) => string };
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let r: string | null = null;
  try { r = M._resolveFilename(req, parent, isMain); } catch { r = null; }
  if (r === path.join(RAIZ, "src/lib/prisma.ts")) return { prisma: prohibido };
  return cargaOriginal.call(this, req, parent, isMain);
};

const S = require("../servicio.server") as typeof import("../servicio.server");
import type { DepsCobro } from "../servicio.server";
import type { FilaCobro, FilaIntento, RepoCobros } from "../db";
import type { DatosFactura } from "../factura.server";
import type { CobroMp } from "../core";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import type { SuscripcionMp } from "../mp-api";
import type { MercadoPagoPayment } from "@/lib/mercadopago";

const PLAN: CondicionesPago = {
  modo: "plazos", metodo: "credit", enganche: 6000, numPagos: 6, frecuencia: "MONTHLY",
  primerPago: "2026-01-05", difiereConSuBanco: false,
};

/* ── La base en memoria ──────────────────────────────────────────────── */

/** Como una base de verdad: lo que se lee es una COPIA, no la fila viva. */
function copia<T extends object>(x: T | undefined): T | null {
  return x ? { ...x } : null;
}

class Mundo {
  interruptor = new Map<string, boolean>();
  cobros: FilaCobro[] = [];
  intentos: FilaIntento[] = [];
  facturas = new Map<string, DatosFactura>();
  /** Payments registrados: referencia → monto (por factura). */
  pagos: Array<{ invoiceId: string; referencia: string; monto: number }> = [];
  aFavor: Array<{ referencia: string; monto: number }> = [];
  tablas: boolean | null = true;
  seq = 0;

  factura(o: Partial<DatosFactura> = {}): DatosFactura {
    const f: DatosFactura = {
      id: "inv1", clinicId: "c1", invoiceNumber: "F-0101", status: "PARTIAL", total: 24000, paid: 9000, patientId: "pac1",
      paciente: { nombre: "Ana Prueba", email: "ana@prueba.test", telefono: "9990000000" },
      clinica: { nombre: "Clínica QA", timezone: "America/Mexico_City" },
      condiciones: PLAN, caso: { id: "caso1", status: "IN_PROGRESS" }, ...o,
    };
    this.facturas.set(`${f.clinicId}:${f.id}`, f);
    return f;
  }

  repo(): RepoCobros {
    const m = this;
    const vivos = ["creating", "pending", "authorized", "paused"];
    return {
      async leerInterruptor(c) { return m.interruptor.get(c) === true; },
      async guardarInterruptor(c, e) { m.interruptor.set(c, e); },
      async contarVivos(c) { return m.cobros.filter((x) => x.clinicId === c && vivos.includes(x.status) && x.status !== "creating").length; },
      async ultimoDeFactura(c, i) { return copia([...m.cobros].reverse().find((x) => x.clinicId === c && x.invoiceId === i)); },
      async vivoDeFactura(c, i) { return copia([...m.cobros].reverse().find((x) => x.clinicId === c && x.invoiceId === i && vivos.includes(x.status))); },
      async porId(c, id) { return copia(m.cobros.find((x) => x.clinicId === c && x.id === id)); },
      async porPreapproval(p) { return copia(m.cobros.find((x) => x.mpPreapprovalId === p)); },
      async crear(f) {
        if (m.cobros.some((x) => x.invoiceId === f.invoiceId && vivos.includes(x.status))) return null;
        const fila: FilaCobro = {
          id: `cob${++m.seq}`, clinicId: f.clinicId, invoiceId: f.invoiceId, patientId: f.patientId, treatmentPlanId: f.treatmentPlanId,
          mpPreapprovalId: null, mpCollectorId: f.mpCollectorId, status: "creating", amount: f.amount, payerEmail: f.payerEmail,
          initPoint: null, startDate: f.startDate, endDate: f.endDate, nextPaymentDate: null, cancelReason: null, lastSyncAt: null,
          reanudarEl: null, pausaMotivo: null,
          createdById: f.createdById, createdAt: new Date(), updatedAt: new Date(),
        };
        m.cobros.push(fila);
        return { ...fila };
      },
      async actualizar(c, id, cambios) {
        const f = m.cobros.find((x) => x.clinicId === c && x.id === id);
        if (f) Object.assign(f, cambios);
      },
      async borrarCreando(c, id) { m.cobros = m.cobros.filter((x) => !(x.clinicId === c && x.id === id && x.status === "creating")); },
      async intentoPorMp(c, a) { return copia(m.intentos.find((x) => x.clinicId === c && x.mpAuthorizedPaymentId === a)); },
      async guardarIntento(i) {
        let f = m.intentos.find((x) => x.mpAuthorizedPaymentId === i.mpAuthorizedPaymentId);
        if (f && f.clinicId !== i.clinicId) throw new Error("otra clínica");
        if (!f) {
          f = { id: `int${++m.seq}`, clinicId: i.clinicId, cobroId: i.cobroId, mpAuthorizedPaymentId: i.mpAuthorizedPaymentId, mpPaymentId: null,
            status: null, paymentStatus: null, statusDetail: null, amount: null, paymentRowId: null, creditoId: null, debitDate: null,
            avisoRecepcion: false, avisoMotivo: null, revisadoAt: null, createdAt: new Date() };
          m.intentos.push(f);
        }
        Object.assign(f, {
          mpPaymentId: i.mpPaymentId ?? f.mpPaymentId, status: i.status, paymentStatus: i.paymentStatus, statusDetail: i.statusDetail,
          amount: i.amount ?? f.amount, paymentRowId: f.paymentRowId ?? i.paymentRowId ?? null, avisoRecepcion: i.avisoRecepcion ?? false,
          creditoId: f.creditoId ?? i.creditoId ?? null, debitDate: i.debitDate ?? f.debitDate, avisoMotivo: i.avisoMotivo ?? f.avisoMotivo,
        });
        return { ...f };
      },
      async intentosDeCobro(c, cobroId) { return m.intentos.filter((x) => x.clinicId === c && x.cobroId === cobroId).map((x) => ({ ...x })); },
      async listarParaCron() { return m.cobros.filter((x) => x.status === "authorized" || x.status === "paused").map((x) => ({ ...x })); },
      async porRevisar(c) {
        return m.intentos.filter((x) => x.clinicId === c && x.avisoRecepcion && !x.revisadoAt)
          .map((x) => ({ ...x, paciente: "Ana Prueba", invoiceNumber: "F-0101", invoiceId: "inv1" }));
      },
      async marcarRevisado(c, id) {
        const f = m.intentos.find((x) => x.clinicId === c && x.id === id && !x.revisadoAt);
        if (!f) return false;
        f.revisadoAt = new Date();
        return true;
      },
    };
  }
}

/* ── Mercado Pago simulado ───────────────────────────────────────────── */

class MpSimulado {
  llamadas: Array<{ op: string; token: string; args: unknown }> = [];
  suscripciones = new Map<string, SuscripcionMp>();
  cobros = new Map<string, CobroMp>();
  pagos = new Map<string, MercadoPagoPayment>();
  falla: Error | null = null;
  initPoint = "https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=PRE1";

  api(): DepsCobro["mp"] {
    const mp = this;
    return {
      async crear(token, s) {
        mp.llamadas.push({ op: "crear", token, args: s });
        if (mp.falla) throw mp.falla;
        const sus: SuscripcionMp = { id: "PRE1", status: "pending", initPoint: mp.initPoint, externalReference: s.externalReference,
          collectorId: "999", transactionAmount: s.autoRecurring.transaction_amount, nextPaymentDate: null };
        mp.suscripciones.set(sus.id, sus);
        return { ...sus };
      },
      async consultar(token, id) { mp.llamadas.push({ op: "consultar", token, args: id }); return mp.suscripciones.get(id) ?? null; },
      async actualizar(token, id, cambio) {
        mp.llamadas.push({ op: "actualizar", token, args: { id, ...cambio } });
        if (mp.falla) throw mp.falla;
        const s = mp.suscripciones.get(id);
        if (!s) throw new Error("no existe");
        if (cambio.status) s.status = cambio.status;
        if (cambio.monto != null) s.transactionAmount = cambio.monto;
        return { ...s };
      },
      async consultarCobro(token, id) { mp.llamadas.push({ op: "consultarCobro", token, args: id }); return token === "tok-c1" ? mp.cobros.get(id) ?? null : null; },
      async buscarCobros(token, pre) { mp.llamadas.push({ op: "buscarCobros", token, args: pre }); return [...mp.cobros.values()].filter((c) => c.preapprovalId === pre); },
      async consultarPago(token, id) { mp.llamadas.push({ op: "consultarPago", token, args: id }); return token === "tok-c1" ? mp.pagos.get(id) ?? null : null; },
    };
  }
}

let mundo: Mundo;
let mp: MpSimulado;
let efectos: { recibos: unknown[]; movimientos: Array<{ texto: string; userId: string | null }>; saldo: unknown[] };
let d: DepsCobro;
/** El reloj de la prueba (las 10:00 de la Ciudad de México del día que toque). */
let reloj = new Date("2026-02-20T16:00:00Z");
const elDia = (dia: string) => { reloj = new Date(`${dia}T16:00:00Z`); };

function armar(): DepsCobro {
  return {
    tablas: async () => mundo.tablas,
    repo: mundo.repo(),
    plataformaLista: () => true,
    baseUrl: () => "https://app.dalecontrol.test",
    credencial: async (c) => (c === "c1" ? { accessToken: "tok-c1", mpUserId: "999" } : c === "c2" ? { accessToken: "tok-c2", mpUserId: "999" } : null),
    clinicasDeCuentaMp: async (u) => (u === "999" ? ["c2", "c1"] : []),
    leerFactura: async (c, i) => {
      const f = mundo.facturas.get(`${c}:${i}`);
      return f ? { ...f } : null;
    },
    registrar: async (a) => {
      const f = mundo.facturas.get(`${a.clinicId}:${a.invoiceId}`)!;
      const pagadoAntes = f.paid;
      if (mundo.pagos.some((p) => p.invoiceId === a.invoiceId && p.referencia === a.referencia)) {
        return { aplicado: false, paymentRowId: `pay-${a.referencia}`, pagadoAntes, aFactura: 0, aFavor: 0, creditoId: null, anomalia: null };
      }
      // Como registrarCobroEnFactura (F12): a la factura lo que falta, el resto a favor.
      const aFactura = f.status === "CANCELLED" ? 0 : Math.max(0, Math.min(a.monto, f.total - f.paid));
      const aFavor = Math.round((a.monto - aFactura) * 100) / 100;
      mundo.pagos.push({ invoiceId: a.invoiceId, referencia: a.referencia, monto: a.monto });
      if (aFavor > 0) mundo.aFavor.push({ referencia: a.referencia, monto: aFavor });
      f.paid = Math.round((f.paid + aFactura) * 100) / 100;
      if (f.paid >= f.total) f.status = "PAID";
      return { aplicado: true, paymentRowId: aFactura > 0 ? `pay-${a.referencia}` : null, pagadoAntes, aFactura, aFavor,
        creditoId: aFavor > 0 ? `cred-${a.referencia}` : null,
        anomalia: aFavor > 0 ? `$${aFavor.toFixed(2)} del cobro automático quedaron a favor del paciente: la factura ya estaba pagada. Revisa si se deja a favor o se devuelve.` : null };
    },
    mp: mp.api(),
    efectos: {
      recibo: async (a) => { efectos.recibos.push(a); },
      movimiento: async (a) => { efectos.movimientos.push({ texto: a.texto, userId: a.userId }); },
      saldoCambio: async (a) => {
        efectos.saldo.push(a);
        // Como en producción: el cambio de saldo pasa por el gancho → reconciliar.
        await S.reconciliarFactura(a, d);
      },
    },
    ahora: () => reloj,
  };
}

beforeEach(() => {
  reloj = new Date("2026-02-20T16:00:00Z");
  mundo = new Mundo();
  mp = new MpSimulado();
  efectos = { recibos: [], movimientos: [], saldo: [] };
  mundo.factura();
  d = armar();
});

async function activo(): Promise<FilaCobro> {
  mundo.interruptor.set("c1", true);
  const r = await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null, treatmentPlanId: "caso1" }, d);
  assert.equal(r.ok, true, r.error ?? "");
  const fila = mundo.cobros[0];
  // El paciente registró la tarjeta: MP la pasa a authorized.
  mp.suscripciones.get("PRE1")!.status = "authorized";
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_preapproval", dataId: "PRE1", mpUserId: "999" }, d);
  return fila;
}

/* ── 1. Interruptor y visibilidad ─────────────────────────────────────── */

test("APAGADO de fábrica: sin encender, ni se ofrece ni se puede activar, y MP no se toca", async () => {
  const e = await S.estadoDeFactura({ clinicId: "c1", invoiceId: "inv1" }, d);
  assert.equal(e.visible, false);
  const r = await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: "ana@prueba.test" }, d);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /apagado/);
  assert.equal(mp.llamadas.length, 0);
});

test("sin el SQL pegado: todo oculto, el interruptor no se guarda y MP no se toca", async () => {
  mundo.tablas = false;
  mundo.interruptor.set("c1", true);
  assert.equal((await S.estadoDeFactura({ clinicId: "c1", invoiceId: "inv1" }, d)).visible, false);
  assert.equal((await S.guardarInterruptor({ clinicId: "c1", enabled: true, userId: "u1" }, d)).ok, false);
  assert.equal((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: "a@b.mx" }, d)).ok, false);
  assert.equal(await S.procesarAvisoDeSuscripcion({ tipo: "subscription_preapproval", dataId: "PRE1", mpUserId: "999" }, d), "sin tablas o sin id");
  assert.equal(mp.llamadas.length, 0);
});

test("encender exige la cuenta de MP conectada; apagar siempre se deja", async () => {
  assert.equal((await S.guardarInterruptor({ clinicId: "sin-cuenta", enabled: true, userId: "u1" }, d)).ok, false);
  assert.equal((await S.guardarInterruptor({ clinicId: "sin-cuenta", enabled: false, userId: "u1" }, d)).ok, true);
  assert.equal((await S.guardarInterruptor({ clinicId: "c1", enabled: true, userId: "u1" }, d)).ok, true);
  const cfg = await S.estadoConfig("c1", d);
  assert.deepEqual(cfg, { plataforma: true, conectado: true, tablas: true, encendido: true, vivos: 0 });
});

/* ── 2. Activar ───────────────────────────────────────────────────────── */

test("activar: suscripción PENDIENTE en la cuenta de la clínica, con los campos de la doc y la fecha del plan", async () => {
  mundo.interruptor.set("c1", true);
  const e = await S.estadoDeFactura({ clinicId: "c1", invoiceId: "inv1" }, d);
  assert.equal(e.puedeActivar, true);
  assert.equal(e.plan?.monto, 3000);

  const r = await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null, treatmentPlanId: "caso1" }, d);
  assert.equal(r.ok, true);
  assert.equal(r.cobro?.estado, "pending");
  assert.equal(r.cobro?.link, mp.initPoint);

  const crear = mp.llamadas.find((l) => l.op === "crear")!;
  assert.equal(crear.token, "tok-c1", "cobra la CLÍNICA con su token OAuth");
  assert.deepEqual(crear.args, {
    reason: "Mensualidades · factura F-0101 · Clínica QA",
    externalReference: `cobroauto:${mundo.cobros[0].id}`,
    payerEmail: "ana@prueba.test",
    backUrl: "https://app.dalecontrol.test/pago/cobro-automatico",
    autoRecurring: {
      frequency: 1,
      frequency_type: "months",
      start_date: "2026-03-05T10:00:00.000-06:00",
      end_date: "2026-07-05T23:00:00.000-06:00",
      transaction_amount: 3000,
    },
  });
  assert.equal(mundo.cobros[0].mpPreapprovalId, "PRE1");
  assert.equal(mundo.cobros[0].mpCollectorId, "999");
  assert.equal(efectos.movimientos.length, 1);
  assert.equal(efectos.movimientos[0].userId, "u1");
});

test("activar dos veces la misma factura: la segunda no crea otra suscripción", async () => {
  mundo.interruptor.set("c1", true);
  assert.equal((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d)).ok, true);
  const r = await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d);
  assert.equal(r.ok, false);
  assert.equal(mp.llamadas.filter((l) => l.op === "crear").length, 1);
});

test("activar: sin correo, de otro caso, caso cerrado o factura de otra clínica → no; MP no se toca", async () => {
  mundo.interruptor.set("c1", true);
  mundo.factura({ paciente: { nombre: "Ana", email: null, telefono: null } });
  assert.match((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d)).error ?? "", /correo/);
  mundo.factura();
  assert.equal((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null, treatmentPlanId: "otro-caso" }, d)).ok, false);
  mundo.factura({ caso: { id: "caso1", status: "COMPLETED" } });
  assert.equal((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d)).ok, false);
  mundo.interruptor.set("c2", true);
  assert.equal((await S.activar({ clinicId: "c2", invoiceId: "inv1", userId: "u1", correo: "a@b.mx" }, d)).ok, false);
  assert.equal(mp.llamadas.filter((l) => l.op === "crear").length, 0);
});

test("si MP falla al crear, no queda ninguna fila viva y se puede reintentar", async () => {
  mundo.interruptor.set("c1", true);
  mp.falla = new Error("MercadoPago error 503");
  const r = await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d);
  assert.equal(r.ok, false);
  assert.equal(mundo.cobros.length, 0);
  mp.falla = null;
  assert.equal((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d)).ok, true);
});

test("un alta que murió a medias («creándose» hace más de 10 min) no bloquea volver a activar", async () => {
  mundo.interruptor.set("c1", true);
  await mundo.repo().crear({ clinicId: "c1", invoiceId: "inv1", patientId: "pac1", treatmentPlanId: null, mpCollectorId: "999",
    amount: 3000, payerEmail: "a@b.mx", startDate: "2026-03-05", endDate: "2026-07-05", createdById: "u1" });
  // Recién creada: todavía puede estar esperando a MP → no se toca.
  mundo.cobros[0].createdAt = new Date("2026-02-20T15:55:00Z");
  assert.equal((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d)).ok, false);
  mundo.cobros[0].createdAt = new Date("2026-02-20T15:00:00Z");
  assert.equal((await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d)).ok, true);
  assert.equal(mundo.cobros.length, 1);
});

test("un init_point que no es de Mercado Pago no se le da al paciente: se cancela en MP", async () => {
  mundo.interruptor.set("c1", true);
  mp.initPoint = "https://phishing.test/checkout";
  const r = await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d);
  assert.equal(r.ok, false);
  assert.equal(mundo.cobros.length, 0);
  assert.deepEqual(mp.llamadas.at(-1)?.args, { id: "PRE1", status: "cancelled" });
});

/* ── 3. Avisos de MP: la tarjeta, los cobros ─────────────────────────── */

test("el paciente registra la tarjeta → activo, y queda en Movimientos", async () => {
  await activo();
  assert.equal(mundo.cobros[0].status, "authorized");
  assert.match(efectos.movimientos.at(-1)!.texto, /registró su tarjeta/);
});

function cobroAprobado(id = "AP1", pago = "PAY1", monto = 3000): void {
  mp.cobros.set(id, {
    id, preapprovalId: "PRE1", status: "processed", paymentId: pago, paymentStatus: "approved", paymentStatusDetail: "accredited",
    transactionAmount: monto, currencyId: "MXN", debitDate: "2026-03-05T10:00:00.000-06:00", retryAttempt: 0,
  });
  mp.pagos.set(pago, {
    id: pago, status: "approved", externalReference: null, transactionAmount: monto, currencyId: "MXN", transactionAmountRefunded: null,
    statusDetail: "accredited", dateApproved: "2026-02-20T15:00:00Z", collectorId: "999", payerEmail: "ana@prueba.test", paymentMethodId: "visa",
  } as MercadoPagoPayment);
}

test("cobro aprobado: UN Payment en la factura, recibo, Movimientos y cierre de links — aunque MP avise tres veces", async () => {
  await activo();
  cobroAprobado();
  for (let i = 0; i < 3; i++) {
    await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP1", mpUserId: "999" }, d);
  }
  assert.deepEqual(mundo.pagos, [{ invoiceId: "inv1", referencia: "PAY1", monto: 3000 }]);
  assert.equal(mundo.facturas.get("c1:inv1")!.paid, 12000);
  assert.equal(efectos.recibos.length, 1);
  assert.deepEqual(efectos.recibos[0], { clinicId: "c1", invoiceId: "inv1", patientId: "pac1", monto: 3000, folio: "F-0101", cuota: "mensualidad 2 de 6" });
  assert.equal(efectos.saldo.length, 1);
  assert.match(efectos.movimientos.at(-1)!.texto, /aprobado: \$3,000\.00 \(mensualidad 2 de 6\)/);
  assert.equal(mundo.intentos[0].paymentRowId, "pay-PAY1");
});

test("el aviso del cobro se busca con el token de la clínica DUEÑA (la cuenta conectada en dos clínicas)", async () => {
  await activo();
  cobroAprobado();
  const r = await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP1", mpUserId: "999" }, d);
  assert.equal(r, "registrado");
  // c2 comparte cuenta: con su token MP no da el cobro (en el simulado), y nunca se registra en c2.
  assert.ok(mp.llamadas.some((l) => l.op === "consultarCobro" && l.token === "tok-c2"));
  assert.equal(mundo.pagos.length, 1);
});

test("un cobro de una suscripción ajena, o de otra cuenta que cobró, no registra nada", async () => {
  await activo();
  mp.cobros.set("AJENO", { id: "AJENO", preapprovalId: "OTRA", status: "processed", paymentId: "P9", paymentStatus: "approved",
    paymentStatusDetail: null, transactionAmount: 3000, currencyId: "MXN", debitDate: null, retryAttempt: 0 });
  assert.equal(await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AJENO", mpUserId: "999" }, d), "cobro ajeno");
  cobroAprobado("AP2", "PAY2");
  mp.pagos.get("PAY2")!.collectorId = "111";
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP2", mpUserId: "999" }, d);
  assert.equal(mundo.pagos.length, 0);
  // Sin user_id no se adivina la clínica: lo recoge el respaldo.
  assert.equal(await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP2", mpUserId: null }, d), "sin cuenta");
});

test("cobro rechazado: aviso a recepción, la mensualidad sigue pendiente, sin recibo; si un reintento entra, el aviso se apaga", async () => {
  await activo();
  mp.cobros.set("AP1", { id: "AP1", preapprovalId: "PRE1", status: "recycling", paymentId: "PAYR", paymentStatus: "rejected",
    paymentStatusDetail: "cc_rejected_insufficient_amount", transactionAmount: 3000, currencyId: "MXN", debitDate: null, retryAttempt: 1 });
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP1", mpUserId: "999" }, d);
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP1", mpUserId: "999" }, d);
  assert.equal(mundo.pagos.length, 0);
  assert.equal(mundo.facturas.get("c1:inv1")!.paid, 9000);
  assert.equal(efectos.recibos.length, 0);
  const avisos = await S.porRevisar("c1", d);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].motivo, /fondos insuficientes.*cóbrala a mano/);
  assert.equal(efectos.movimientos.filter((m) => /rechazó/.test(m.texto)).length, 1, "un solo movimiento por rechazo, no uno por aviso");

  cobroAprobado("AP1", "PAY1");
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP1", mpUserId: "999" }, d);
  assert.equal(mundo.pagos.length, 1);
  assert.equal((await S.porRevisar("c1", d)).length, 0);
});

test("recepción marca el aviso como revisado; de otra clínica no puede", async () => {
  await activo();
  mp.cobros.set("AP1", { id: "AP1", preapprovalId: "PRE1", status: "processed", paymentId: "PAYR", paymentStatus: "rejected",
    paymentStatusDetail: null, transactionAmount: 3000, currencyId: "MXN", debitDate: null, retryAttempt: 4 });
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP1", mpUserId: "999" }, d);
  const [aviso] = await S.porRevisar("c1", d);
  assert.equal(await S.marcarRevisado({ clinicId: "c2", id: aviso.id, userId: "u2" }, d), false);
  assert.equal(await S.marcarRevisado({ clinicId: "c1", id: aviso.id, userId: "u1" }, d), true);
  assert.equal((await S.porRevisar("c1", d)).length, 0);
});

test("MP cancela la suscripción por su lado (3 rechazos) → cancelada y aviso a recepción", async () => {
  await activo();
  mp.suscripciones.get("PRE1")!.status = "cancelled";
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_preapproval", dataId: "PRE1", mpUserId: "999" }, d);
  assert.equal(mundo.cobros[0].status, "cancelled");
  const avisos = await S.porRevisar("c1", d);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].motivo, /canceló el cobro automático/);
});

test("respaldo: si el aviso se perdió, abrir el caso registra el cobro (una vez)", async () => {
  await activo();
  cobroAprobado();
  mundo.cobros[0].lastSyncAt = null;
  await S.estadoDeFactura({ clinicId: "c1", invoiceId: "inv1" }, d);
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP1", mpUserId: "999" }, d);
  assert.equal(mundo.pagos.length, 1);
});

/* ── 4. Reconciliar con la factura ───────────────────────────────────── */

test("descuento: la factura baja y el cobro automático baja con ella", async () => {
  await activo();
  mundo.factura({ total: 21000, paid: 9000 }); // 6 de $2,500 tras el enganche
  assert.equal(await S.reconciliarFactura({ clinicId: "c1", invoiceId: "inv1" }, d), "monto");
  assert.deepEqual(mp.llamadas.at(-1)?.args, { id: "PRE1", monto: 2500 });
  assert.equal(mundo.cobros[0].amount, 2500);
});

test("se liquida en caja: la suscripción se cancela en MP (no cobra ni un peso más)", async () => {
  await activo();
  mundo.factura({ paid: 24000, status: "PAID" });
  assert.equal(await S.reconciliarFactura({ clinicId: "c1", invoiceId: "inv1" }, d), "cancelada");
  assert.deepEqual(mp.llamadas.at(-1)?.args, { id: "PRE1", status: "cancelled" });
  assert.equal(mundo.cobros[0].status, "cancelled");
  assert.match(mundo.cobros[0].cancelReason ?? "", /pagada/);
});

test("el caso se termina: se cancela; la factura cancelada: también", async () => {
  await activo();
  mundo.factura({ caso: { id: "caso1", status: "DROPPED_OUT" } });
  assert.equal(await S.reconciliarFactura({ clinicId: "c1", invoiceId: "inv1" }, d), "cancelada");
});

test("la última mensualidad: el cobro que la cubre deja el monto en lo que falta", async () => {
  await activo();
  mundo.factura({ paid: 20000 });
  cobroAprobado("AP9", "PAY9", 3000);
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: "AP9", mpUserId: "999" }, d);
  // paid 23000 → falta 1000: el gancho del cambio de saldo bajó el monto.
  assert.equal(mundo.cobros[0].amount, 1000);
});

test("reconciliar nunca lanza (MP caído)", async () => {
  await activo();
  mundo.factura({ total: 21000 });
  mp.falla = new Error("MercadoPago error 500");
  assert.equal(await S.reconciliarFactura({ clinicId: "c1", invoiceId: "inv1" }, d), "error");
});

/* ── 5. Pausar / reanudar / cancelar ─────────────────────────────────── */

test("pausar, reanudar y cancelar desde el caso", async () => {
  await activo();
  assert.equal((await S.cambiarEstado({ clinicId: "c1", invoiceId: "inv1", userId: "u1", accion: "reanudar" }, d)).ok, false);
  const p = await S.cambiarEstado({ clinicId: "c1", invoiceId: "inv1", userId: "u1", accion: "pausar" }, d);
  assert.equal(p.cobro?.estado, "paused");
  assert.deepEqual(mp.llamadas.at(-1)?.args, { id: "PRE1", status: "paused" });
  const r = await S.cambiarEstado({ clinicId: "c1", invoiceId: "inv1", userId: "u1", accion: "reanudar" }, d);
  assert.equal(r.cobro?.estado, "authorized");
  const c = await S.cambiarEstado({ clinicId: "c1", invoiceId: "inv1", userId: "u1", accion: "cancelar" }, d);
  assert.equal(c.cobro?.estado, "cancelled");
  // Cancelada, ya se puede activar otra.
  assert.equal((await S.estadoDeFactura({ clinicId: "c1", invoiceId: "inv1" }, d)).puedeActivar, true);
});

test("otra clínica no puede pausar ni cancelar la suscripción de esta", async () => {
  await activo();
  const r = await S.cambiarEstado({ clinicId: "c2", invoiceId: "inv1", userId: "u2", accion: "cancelar" }, d);
  assert.equal(r.ok, false);
  assert.equal(mundo.cobros[0].status, "authorized");
});

test("apagar el interruptor NO cancela las vivas: siguen visibles para poder cancelarlas", async () => {
  await activo();
  mundo.interruptor.set("c1", false);
  const e = await S.estadoDeFactura({ clinicId: "c1", invoiceId: "inv1" }, d);
  assert.equal(e.visible, true);
  assert.equal(e.cobro?.estado, "authorized");
  assert.equal(e.puedeActivar, false);
});

/* ═══ F1 — el cobro doble, de punta a punta (MP simulado) ═══════════════
 * Plan de 12 × $2,000 sin enganche, cargos los días 5 desde el 5-oct-2026. */

const DOCE: CondicionesPago = { modo: "plazos", metodo: "credit", enganche: 0, numPagos: 12, frecuencia: "MONTHLY", primerPago: "2026-10-05", difiereConSuBanco: false };

/** Activa el 1-oct (primer cargo 5-oct) y el paciente registra su tarjeta. */
async function activoDoce(): Promise<void> {
  elDia("2026-10-01");
  mundo.factura({ total: 24000, paid: 0, status: "PENDING", condiciones: DOCE });
  mundo.interruptor.set("c1", true);
  const r = await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d);
  assert.equal(r.ok, true, r.error ?? "");
  assert.equal(mundo.cobros[0].startDate, "2026-10-05");
  mp.suscripciones.get("PRE1")!.status = "authorized";
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_preapproval", dataId: "PRE1", mpUserId: "999" }, d);
  assert.equal(mundo.cobros[0].status, "authorized");
}

/** Lo que pasa cuando recepción cobra a mano: la factura cambia y el gancho reconcilia. */
async function cobroEnCaja(monto: number): Promise<void> {
  const f = mundo.facturas.get("c1:inv1")!;
  f.paid += monto;
  f.status = f.paid >= f.total ? "PAID" : "PARTIAL";
  await S.reconciliarFactura({ clinicId: "c1", invoiceId: "inv1" }, d);
}

/** MP cobra (o rechaza) el cargo de un día, como llegaría por el webhook. */
async function mpCobra(id: string, dia: string, estado: "approved" | "rejected", status = "processed"): Promise<void> {
  mp.cobros.set(id, { id, preapprovalId: "PRE1", status, paymentId: `PAY-${id}`, paymentStatus: estado, paymentStatusDetail: estado === "approved" ? "accredited" : "cc_rejected_insufficient_amount",
    transactionAmount: 2000, currencyId: "MXN", debitDate: `${dia}T10:00:00.000-06:00`, retryAttempt: 0 });
  if (estado === "approved") {
    mp.pagos.set(`PAY-${id}`, { id: `PAY-${id}`, status: "approved", externalReference: null, transactionAmount: 2000, currencyId: "MXN", transactionAmountRefunded: null,
      statusDetail: "accredited", dateApproved: `${dia}T16:00:00Z`, collectorId: "999", payerEmail: "ana@prueba.test", paymentMethodId: "visa" } as MercadoPagoPayment);
  }
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_authorized_payment", dataId: id, mpUserId: "999" }, d);
}

/** ¿MP cobraría hoy? Solo si la suscripción está activa (authorized). */
const mpCobraria = () => mp.suscripciones.get("PRE1")!.status === "authorized";
const cargosAprobados = () => mundo.pagos.filter((p) => p.referencia.startsWith("PAY-")).length;

test("F1 · 3-oct: $2,000 en caja → el aviso lo dice antes; MP se pausa; 5-oct no cobra; 6-oct el cron la reanuda con $2,000; un solo cobro de octubre", async () => {
  await activoDoce();
  elDia("2026-10-03");
  const aviso = await S.avisoParaCobro({ clinicId: "c1", invoiceId: "inv1", monto: 2000 }, d);
  assert.equal(aviso?.tipo, "pausa");
  assert.equal(aviso?.texto, "Este paciente tiene cobro automático con tarjeta: el cargo del 5 de octubre se pausará (esa mensualidad quedará pagada con este cobro) y se reanuda solo para el cargo del 5 de noviembre, por $2,000.00.");

  await cobroEnCaja(2000);
  assert.deepEqual(mp.llamadas.filter((l) => l.op === "actualizar").at(-1)?.args, { id: "PRE1", status: "paused" });
  assert.equal(mundo.cobros[0].status, "paused");
  assert.equal(mundo.cobros[0].pausaMotivo, "ciclo");
  assert.equal(mundo.cobros[0].reanudarEl, "2026-10-06");
  assert.match(efectos.movimientos.at(-1)!.texto, /se pausó para el cargo del 5 de octubre.*Se reanuda solo el 6 de octubre, a tiempo para el cargo del 5 de noviembre/);

  elDia("2026-10-05");
  await S.correrCron(d);
  assert.equal(mpCobraria(), false, "el 5-oct MP no cobra: está pausada");

  elDia("2026-10-06");
  const r = await S.correrCron(d);
  assert.equal(r.reanudadas, 1);
  assert.equal(mpCobraria(), true);
  assert.equal(mundo.cobros[0].status, "authorized");
  assert.equal(mundo.cobros[0].pausaMotivo, null);
  assert.equal(mundo.cobros[0].reanudarEl, null);
  assert.equal(mp.suscripciones.get("PRE1")!.transactionAmount, 2000, "el monto no cambió");
  assert.equal(cargosAprobados(), 0, "octubre se pagó una sola vez (en caja)");

  // El 5-nov MP cobra noviembre normalmente.
  elDia("2026-11-05");
  await mpCobra("NOV", "2026-11-05", "approved");
  assert.equal(mundo.facturas.get("c1:inv1")!.paid, 4000);
});

test("F1 · 3-oct: abono parcial de $500 → no se pausa, el monto sigue en $2,000, y el aviso lo explica", async () => {
  await activoDoce();
  elDia("2026-10-03");
  const aviso = await S.avisoParaCobro({ clinicId: "c1", invoiceId: "inv1", monto: 500 }, d);
  assert.equal(aviso?.tipo, "sigue");
  assert.match(aviso?.texto ?? "", /el 5 de octubre Mercado Pago cobrará \$2,000\.00/);
  const antes = mp.llamadas.length;
  await cobroEnCaja(500);
  assert.equal(mp.llamadas.slice(antes).filter((l) => l.op === "actualizar").length, 0, "ni pausa ni cambio de monto");
  assert.equal(mundo.cobros[0].status, "authorized");
  assert.equal(mundo.cobros[0].amount, 2000);
});

test("F1 · caso inverso: MP cobró el 5-oct; el 6-oct cobrar $2,000 a mano se FRENA (409) salvo que se confirme el adelanto", async () => {
  await activoDoce();
  elDia("2026-10-05");
  await mpCobra("OCT", "2026-10-05", "approved");
  assert.equal(mundo.facturas.get("c1:inv1")!.paid, 2000);
  elDia("2026-10-06");
  const freno = await S.frenoCobroDoble({ clinicId: "c1", invoiceId: "inv1", monto: 2000, confirmado: false }, d);
  assert.equal(freno.bloquear, true);
  assert.match(freno.texto ?? "", /La mensualidad del 5 de octubre ya se cobró con tarjeta \(Mercado Pago, \$2,000\.00\).*el cargo del 5 de noviembre se pausaría/);
  assert.deepEqual(await S.frenoCobroDoble({ clinicId: "c1", invoiceId: "inv1", monto: 2000, confirmado: true }, d), { bloquear: false, texto: null });
  // Confirmado como adelanto: noviembre queda pagado → se pausa el cargo del 5-nov y vuelve el 6-nov.
  await cobroEnCaja(2000);
  assert.equal(mundo.cobros[0].status, "paused");
  assert.equal(mundo.cobros[0].reanudarEl, "2026-11-06");
});

test("F1 · adelanto de 3 mensualidades ($6,000) el 3-oct → pausada hasta el 6-dic; el cron no la reanuda antes", async () => {
  await activoDoce();
  elDia("2026-10-03");
  const aviso = await S.avisoParaCobro({ clinicId: "c1", invoiceId: "inv1", monto: 6000 }, d);
  assert.match(aviso?.texto ?? "", /los cargos del 5 de octubre, 5 de noviembre y 5 de diciembre se pausarán .* para el cargo del 5 de enero/);
  await cobroEnCaja(6000);
  assert.equal(mundo.cobros[0].reanudarEl, "2026-12-06");
  for (const dia of ["2026-10-06", "2026-11-05", "2026-12-05"]) {
    elDia(dia);
    await S.correrCron(d);
    assert.equal(mpCobraria(), false, `el ${dia} sigue pausada`);
  }
  elDia("2026-12-06");
  await S.correrCron(d);
  assert.equal(mpCobraria(), true);
});

test("F1 · liquidar todo el caso en caja → el aviso lo dice y la suscripción se CANCELA en MP", async () => {
  await activoDoce();
  elDia("2026-10-03");
  assert.equal((await S.avisoParaCobro({ clinicId: "c1", invoiceId: "inv1", monto: 24000 }, d))?.tipo, "liquida");
  await cobroEnCaja(24000);
  assert.equal(mp.suscripciones.get("PRE1")!.status, "cancelled");
  assert.equal(mundo.cobros[0].status, "cancelled");
});

test("F1 · MP rechazó el 5-oct (reintentará); el 7-oct se cobra en caja → pausada hasta el 16-oct; el cron la reanuda ese día", async () => {
  await activoDoce();
  elDia("2026-10-05");
  await mpCobra("OCT", "2026-10-05", "rejected", "recycling");
  elDia("2026-10-07");
  assert.equal((await S.avisoParaCobro({ clinicId: "c1", invoiceId: "inv1", monto: 2000 }, d))?.tipo, "reintento");
  await cobroEnCaja(2000);
  assert.equal(mundo.cobros[0].status, "paused");
  assert.equal(mundo.cobros[0].reanudarEl, "2026-10-16");
  elDia("2026-10-15");
  await S.correrCron(d);
  assert.equal(mpCobraria(), false);
  elDia("2026-10-16");
  await S.correrCron(d);
  assert.equal(mpCobraria(), true);
});

test("F1 · una pausa MANUAL desde el caso no la reanuda el cron", async () => {
  await activoDoce();
  await S.cambiarEstado({ clinicId: "c1", invoiceId: "inv1", userId: "u1", accion: "pausar" }, d);
  assert.equal(mundo.cobros[0].pausaMotivo, "manual");
  elDia("2026-11-20");
  await S.correrCron(d);
  assert.equal(mundo.cobros[0].status, "paused");
  assert.equal(mpCobraria(), false);
});

test("F1 · si la tarjeta se registra DESPUÉS de un cobro en caja, se pausa al activarse", async () => {
  elDia("2026-10-01");
  mundo.factura({ total: 24000, paid: 0, status: "PENDING", condiciones: DOCE });
  mundo.interruptor.set("c1", true);
  await S.activar({ clinicId: "c1", invoiceId: "inv1", userId: "u1", correo: null }, d);
  elDia("2026-10-03");
  await cobroEnCaja(2000); // aún pendiente: no hay nada que pausar en MP
  assert.equal(mundo.cobros[0].status, "pending");
  mp.suscripciones.get("PRE1")!.status = "authorized";
  await S.procesarAvisoDeSuscripcion({ tipo: "subscription_preapproval", dataId: "PRE1", mpUserId: "999" }, d);
  assert.equal(mundo.cobros[0].status, "paused");
  assert.equal(mundo.cobros[0].reanudarEl, "2026-10-06");
});

/* ═══ F12 — dinero de MP que no cabe en la factura ═════════════════════ */

test("F12 · un cobro automático de $2,000 sobre una factura ya pagada → $2,000 a favor, paid sin cambio, aviso en Caja", async () => {
  await activoDoce();
  mundo.factura({ total: 24000, paid: 24000, status: "PAID", condiciones: DOCE });
  elDia("2026-10-05");
  await mpCobra("OCT", "2026-10-05", "approved");
  assert.equal(mundo.facturas.get("c1:inv1")!.paid, 24000);
  assert.deepEqual(mundo.aFavor, [{ referencia: "PAY-OCT", monto: 2000 }]);
  const avisos = await S.porRevisar("c1", d);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].motivo, /\$2000\.00 del cobro automático quedaron a favor del paciente/);
  // Un segundo aviso del mismo cobro no apaga el aviso ni duplica nada.
  await mpCobra("OCT", "2026-10-05", "approved");
  assert.equal(mundo.aFavor.length, 1);
  assert.equal((await S.porRevisar("c1", d)).length, 1);
});
