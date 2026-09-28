// ws1-t3 fase 1 — anticipo pedido DESDE EL PANEL (cita o factura): el
// servicio conducido de verdad, con la misma base en memoria y el mismo
// Mercado Pago de mentira que servicio.test.ts (WS1-T5). Cubre los casos que
// pidió el encargo: parcial, exacto, doble, tardío (hueco perdido), de otra
// cuenta, factura cancelada con el anticipo pendiente, y el permiso
// (doctor puede, readonly no).
// Correr: npm run test:anticipos-panel

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DobleBase } from "./doble-base";
import {
  pedirAnticipoDeCita,
  pedirAnticipoDeFactura,
  cerrarAnticiposDePanel,
  canalesAnticipoPanel,
  registrarAnticipoRecibido,
  type DepsAnticipoPanel,
} from "../panel.server";
import { aplicarPagoDeAnticipo } from "../servicio.server";
import { refDeAnticipo } from "../core";
import { hasPermission } from "../../auth/permissions";
import type { MercadoPagoPayment } from "../../mercadopago";

const T0 = new Date("2026-09-22T16:00:00Z");

function escenario(opts: { horas?: number; feeMode?: string; feeValue?: number } = {}) {
  const db = new DobleBase();
  db.tablas.clinic.push({ id: "c1", name: "Clínica Sonrisa", timezone: "America/Mexico_City" });
  db.tablas.clinicMercadoPago.push({
    clinicId: "c1",
    mpUserId: "999",
    accessToken: "v1:cifrado",
    panelDepositExpiryHours: opts.horas ?? 24,
    marketplaceFeeMode: opts.feeMode ?? "fixed",
    marketplaceFeeValue: opts.feeValue ?? 0,
  });
  db.tablas.procedureCatalog.push({ id: "svc1", clinicId: "c1", isActive: true, name: "Limpieza dental", basePrice: 1200 });

  let reloj = T0;
  const preferencias: Array<{ token: string; opts: any }> = [];
  const expiradas: string[] = [];
  const pagos = new Map<string, MercadoPagoPayment>();
  let usuarioConectado = "999";

  const deps: Partial<DepsAnticipoPanel> = {
    db: db.cliente(),
    plataformaLista: () => true,
    credencial: async (clinicId) => {
      const f = db.tablas.clinicMercadoPago.find((x) => x.clinicId === clinicId && x.accessToken);
      return f ? { accessToken: `TOKEN-${clinicId}`, mpUserId: usuarioConectado } : null;
    },
    crearPreferencia: async (token, o) => {
      preferencias.push({ token, opts: o });
      return { id: `pref-${preferencias.length}`, initPoint: `https://mpago.la/${preferencias.length}` };
    },
    expirarPreferencia: async (_token, prefId) => {
      expiradas.push(prefId);
    },
    ahora: () => reloj,
    baseUrl: () => "https://app.dalecontrol.test",
    // ws1-t3 fase 2 — datos bancarios de la sede (canalesAnticipoPanel y
    // pedirAnticipoDeFactura con metodo "transferencia"). Vacío por defecto:
    // los escenarios que la necesitan la cargan con e.cargarBanco().
    datosBancarios: async (clinicId) => {
      const f = db.tablas.clinicBankAccount.find((x) => x.clinicId === clinicId);
      return f ? { banco: f.banco, beneficiario: f.beneficiario, clabe: f.clabe, referencia: f.referencia ?? null } : null;
    },
  };

  // Mismos deps para aplicarPagoDeAnticipo (servicio.server.ts): reutiliza la
  // MISMA base y el MISMO Mercado Pago de mentira.
  const depsPago = {
    db: db.cliente(),
    plataformaLista: () => true,
    credencial: deps.credencial!,
    consultarPago: async (token: string, id: string) => {
      assert.equal(token, "TOKEN-c1");
      return pagos.get(id) ?? null;
    },
    crearPreferencia: deps.crearPreferencia!,
    crearCita: async () => {
      throw new Error("no se usa en estos escenarios");
    },
    avisar: async () => {},
    ahora: () => reloj,
    baseUrl: () => "https://app.dalecontrol.test",
  };

  function factura(over: Partial<Record<string, unknown>> = {}) {
    const id = db.nuevoId("inv");
    db.tablas.invoice.push({
      id,
      clinicId: "c1",
      patientId: "p1",
      invoiceNumber: `MF-${id}`,
      status: "PENDING",
      total: 1000,
      paid: 0,
      ...over,
    });
    return id;
  }

  function pagar(id: string, over: Partial<MercadoPagoPayment> = {}) {
    pagos.set(id, {
      id,
      status: "approved",
      externalReference: "",
      transactionAmount: 300,
      currencyId: "MXN",
      statusDetail: "accredited",
      dateApproved: reloj.toISOString(),
      collectorId: "999",
      payerEmail: null,
      paymentMethodId: "visa",
      transactionAmountRefunded: null,
      ...over,
    });
  }

  return {
    db,
    deps,
    depsPago,
    factura,
    pagar,
    preferencias,
    expiradas,
    avanzar: (min: number) => { reloj = new Date(reloj.getTime() + min * 60_000); },
    desconectarOtraCuenta: () => { usuarioConectado = "OTRA"; },
    // ws1-t3 fase 2 — carga los datos bancarios de la sede (por defecto no hay
    // ninguno: el canal "transferencia" no se ofrece hasta que se cargan).
    cargarBanco: (over: Partial<Record<string, unknown>> = {}) => {
      db.tablas.clinicBankAccount.push({
        clinicId: "c1",
        banco: "BBVA",
        beneficiario: "Clínica Sonrisa SC",
        clabe: "012180001234567899",
        referencia: null,
        ...over,
      });
    },
  };
}

describe("pedirAnticipoDeFactura: el monto SIEMPRE se valida en el servidor", () => {
  it("dentro del rango: crea el anticipo y su link, ligado a la factura", async () => {
    const e = escenario();
    const invoiceId = e.factura();
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    assert.equal(r.ok, true);
    assert.equal(r.deposit?.amount, 300);
    assert.equal(r.deposit?.checkoutUrl, "https://mpago.la/1");
    const dep = e.db.tablas.appointmentDeposit[0];
    assert.equal(dep.invoiceId, invoiceId);
    assert.equal(dep.origin, "panel");
    assert.equal(dep.method, "mercadopago");
    assert.equal(dep.createdById, "u1");
  });

  it("monto MENOR al mínimo ($10): rechazado, ni se crea el anticipo", async () => {
    const e = escenario();
    const invoiceId = e.factura();
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 5 }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "monto_invalido");
    assert.equal(e.db.tablas.appointmentDeposit.length, 0);
  });

  it("monto MAYOR al saldo pendiente: rechazado (nunca se cobra de más)", async () => {
    const e = escenario();
    const invoiceId = e.factura({ total: 1000, paid: 700 }); // saldo 300
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 301 }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "monto_invalido");
  });

  it("un monto manipulado por el cliente NUNCA se usa tal cual: siempre pasa por el mínimo/máximo del servidor", async () => {
    const e = escenario();
    const invoiceId = e.factura({ total: 500, paid: 0 });
    // El cliente pide $1,000,000 sobre una factura de $500: se rechaza.
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 1_000_000 }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "monto_invalido");
  });

  it("DOBLE: pedirlo dos veces devuelve el MISMO link, nunca un segundo", async () => {
    const e = escenario();
    const invoiceId = e.factura();
    const r1 = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    const r2 = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 999 }, e.deps);
    assert.equal(r1.deposit?.id, r2.deposit?.id);
    assert.equal(r2.reutilizado, true);
    assert.equal(e.db.tablas.appointmentDeposit.length, 1, "nunca un segundo PENDING para la misma factura");
    assert.equal(e.preferencias.length, 1, "y solo UNA preferencia creada en Mercado Pago");
  });

  it("la cita SCHEDULED queda apartada (holdExpiresAt) y el plazo nunca pasa de su inicio", async () => {
    const e = escenario({ horas: 48 });
    e.db.tablas.appointment.push({
      id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED",
      startsAt: new Date(T0.getTime() + 3 * 3600_000), // en 3 h — mucho antes de las 48 h pedidas
    });
    const invoiceId = e.factura({ appointmentId: "apt1" });
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    assert.equal(r.deposit?.apartada, true);
    const appt = e.db.tablas.appointment[0];
    assert.equal(appt.holdExpiresAt.getTime(), appt.startsAt.getTime(), "el plazo se topa con el inicio de la cita, no las 48 h");
  });
});

describe("pedirAnticipoDeCita: crea la factura si hace falta", () => {
  // La creación real de la factura (crearFacturaDesdeCita) usa el folio y el
  // saldo a favor de siempre (nextInvoiceNumber, aplicarSaldoAFavor), que no
  // tienen doble: se prueban con Postgres real, igual que
  // POST /api/invoices/from-appointment (sin prueba con base en memoria en
  // todo el repo). Aquí solo se cubre lo que SÍ es puro: que sin concepto no
  // se crea nada, y que con una factura YA existente no se duplica.
  it("la cita YA tiene factura: la usa tal cual, nunca crea una segunda", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 86_400_000) });
    const invoiceId = e.factura({ appointmentId: "apt1" });
    const r = await pedirAnticipoDeCita({ clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 300 }, e.deps);
    assert.equal(r.ok, true);
    assert.equal(r.deposit?.invoiceId, invoiceId);
    assert.equal(e.db.tablas.invoice.length, 1, "no se creó una segunda factura");
  });

  it("sin factura y SIN concepto: no crea nada, error claro", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 86_400_000) });
    const r = await pedirAnticipoDeCita({ clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 300 }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "sin_concepto");
    assert.equal(e.db.tablas.invoice.length, 0);
  });

  // ws1-t1 (A2, QA ws1-t10): antes, un monto o un plazo inválidos SÍ creaban
  // la factura (crearFacturaDesdeCita) y solo el anticipo se rechazaba
  // después, dentro de pedirAnticipoDeFactura — dejando una cuenta por cobrar
  // huérfana si recepción desistía. Ahora se valida ANTES de tocar la base.
  it("sin factura, con concepto pero monto INVÁLIDO (bajo el mínimo): rechaza y NO crea la factura", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 86_400_000) });
    const r = await pedirAnticipoDeCita(
      { clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 5, concepto: { serviceId: "svc1" } }, // svc1 = $1,200
      e.deps,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "monto_invalido");
    assert.equal(e.db.tablas.invoice.length, 0, "sin factura huérfana: A2");
  });

  it("sin factura, con concepto pero monto MAYOR al precio del concepto: rechaza y NO crea la factura", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 86_400_000) });
    const r = await pedirAnticipoDeCita(
      { clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 5000, concepto: { description: "Consulta", unitPrice: 1000 } },
      e.deps,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "monto_invalido");
    assert.equal(e.db.tablas.invoice.length, 0, "sin factura huérfana: A2");
  });

  it("sin factura, monto válido pero PLAZO inválido: rechaza y NO crea la factura", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 86_400_000) });
    const r = await pedirAnticipoDeCita(
      { clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 300, horas: 999, concepto: { serviceId: "svc1" } },
      e.deps,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "plazo_invalido");
    assert.equal(e.db.tablas.invoice.length, 0, "sin factura huérfana: A2");
  });

  // N3 (QA ronda 4): antes el canal (Mercado Pago desconectado, o sin datos
  // bancarios para transferencia) solo se comprobaba DENTRO de
  // pedirAnticipoDeFactura, que ya corría con la factura recién creada por
  // crearFacturaDesdeCita — un 409 "sin_mp" dejaba la factura viva de todos
  // modos. Ahora se valida antes de tocar la base (resolverCanal).
  it("sin factura, Mercado Pago desconectado (sin pedir transferencia): rechaza el CANAL y NO crea la factura", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 86_400_000) });
    e.db.tablas.clinicMercadoPago[0].accessToken = undefined; // se desconectó
    const r = await pedirAnticipoDeCita(
      { clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 300, concepto: { serviceId: "svc1" } },
      e.deps,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "sin_mp");
    assert.equal(e.db.tablas.invoice.length, 0, "sin factura huérfana: N3");
  });

  it("sin factura, transferencia pedida SIN datos bancarios cargados: rechaza el CANAL y NO crea la factura", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 86_400_000) });
    const r = await pedirAnticipoDeCita(
      { clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 300, concepto: { serviceId: "svc1" }, metodo: "transferencia" },
      e.deps,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "sin_mp");
    assert.equal(e.db.tablas.invoice.length, 0, "sin factura huérfana: N3");
  });
});

describe("Ajuste 2 (decisión de Rafael): SOLO citas futuras, y sin comisión de DaleControl", () => {
  it("cita PASADA (SCHEDULED pero startsAt ya pasó): rechazada, no crea factura ni anticipo", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() - 3600_000) });
    const r = await pedirAnticipoDeCita(
      { clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 300, concepto: { serviceId: "svc1" } },
      e.deps,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "cita_no_futura");
    assert.equal(e.db.tablas.invoice.length, 0);
  });

  it("cita COMPLETED (aunque su hora sea futura): rechazada — no es SCHEDULED ni CONFIRMED", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "COMPLETED", startsAt: new Date(T0.getTime() + 3600_000) });
    const r = await pedirAnticipoDeCita({ clinicId: "c1", appointmentId: "apt1", userId: "u1", monto: 300 }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "cita_no_futura");
  });

  it("CONFIRMED y futura: SÍ elegible (no solo SCHEDULED)", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "CONFIRMED", startsAt: new Date(T0.getTime() + 3600_000) });
    const invoiceId = e.factura({ appointmentId: "apt1" });
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    assert.equal(r.ok, true);
  });

  it("desde la FACTURA: si su cita ya pasó, rechazada; si NO tiene cita, permitida", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() - 3600_000) });
    const invoiceConCitaPasada = e.factura({ appointmentId: "apt1" });
    const r1 = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId: invoiceConCitaPasada, userId: "u1", monto: 300 }, e.deps);
    assert.equal(r1.ok, false);
    assert.equal(r1.error, "cita_no_futura");

    const invoiceSinCita = e.factura(); // sin appointmentId
    const r2 = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId: invoiceSinCita, userId: "u1", monto: 300 }, e.deps);
    assert.equal(r2.ok, true);
  });

  it("los anticipos del panel NUNCA cobran comisión de DaleControl, aunque la clínica tenga una configurada para el bot", async () => {
    const e = escenario({ feeMode: "percent", feeValue: 10 }); // 10% configurado para el bot
    const invoiceId = e.factura();
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    assert.equal(r.ok, true);
    assert.equal(e.db.tablas.appointmentDeposit[0].marketplaceFee, 0);
    // Y la preferencia de Mercado Pago tampoco lleva marketplace_fee.
    assert.equal(e.preferencias[0].opts.marketplaceFee, 0);
  });
});

describe("al pagarse: se aplica a LA FACTURA (Total / Anticipo / Pendiente), no a saldo a favor", () => {
  it("pago EXACTO: Payment en la factura, PARTIAL, deposit PAID con paymentId sellado", async () => {
    const e = escenario();
    const invoiceId = e.factura({ total: 1000, paid: 0 });
    const pedido = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    const depId = pedido.deposit!.id;
    e.pagar("501", { externalReference: refDeAnticipo(depId), transactionAmount: 300 });

    const r = await aplicarPagoDeAnticipo(depId, "501", e.depsPago as any);
    assert.equal(r.aplicado, true);

    const inv = e.db.tablas.invoice.find((i) => i.id === invoiceId);
    assert.equal(inv.paid, 300);
    assert.equal(inv.status, "PARTIAL");
    assert.equal(e.db.tablas.payment.length, 1);
    assert.equal(e.db.tablas.payment[0].invoiceId, invoiceId);
    assert.equal(e.db.tablas.payment[0].amount, 300);
    assert.equal(e.db.tablas.payment[0].method, "mercadopago");
    assert.equal(e.db.tablas.patientCredit.length, 0, "nunca se cuenta dos veces: aquí NO hay saldo a favor");

    const dep = e.db.tablas.appointmentDeposit.find((d: any) => d.id === depId);
    assert.equal(dep.status, "PAID");
    assert.equal(dep.paymentId, e.db.tablas.payment[0].id, "el anticipo queda sellado a ESE Payment, nunca a dos destinos");
  });

  it("pago exacto CON cita apartada: además confirma la cita y quita el apartado", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 3600_000) });
    const invoiceId = e.factura({ appointmentId: "apt1" });
    const pedido = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    const depId = pedido.deposit!.id;
    e.pagar("502", { externalReference: refDeAnticipo(depId), transactionAmount: 300 });
    const r = await aplicarPagoDeAnticipo(depId, "502", e.depsPago as any);
    assert.equal(r.aplicado && r.confirmada, true);
    const appt = e.db.tablas.appointment.find((a: any) => a.id === "apt1");
    assert.equal(appt.status, "CONFIRMED");
    assert.equal(appt.holdExpiresAt, null);
  });

  it("TARDÍO: si el hueco ya se liberó, el dinero va a SALDO A FAVOR y NO toca la factura", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 3600_000) });
    const invoiceId = e.factura({ appointmentId: "apt1" });
    const pedido = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, horas: 1 }, e.deps);
    const depId = pedido.deposit!.id;

    // El hueco se pierde: otra persona lo tomó y el trigger canceló la cita
    // (aquí, a mano — el trigger vive en SQL y no lo prueba este doble).
    const appt = e.db.tablas.appointment.find((a: any) => a.id === "apt1");
    appt.status = "CANCELLED";
    appt.holdExpiresAt = null;

    e.pagar("503", { externalReference: refDeAnticipo(depId), transactionAmount: 300 });
    const r = await aplicarPagoDeAnticipo(depId, "503", e.depsPago as any);
    assert.equal(r.aplicado, true);
    assert.equal(r.aplicado && r.confirmada, false);

    const inv = e.db.tablas.invoice.find((i) => i.id === invoiceId);
    assert.equal(inv.paid, 0, "la factura NO se tocó");
    assert.equal(e.db.tablas.payment.length, 0);
    assert.equal(e.db.tablas.patientCredit.length, 1, "el dinero SÍ entra, como saldo a favor");
    assert.equal(e.db.tablas.patientCredit[0].amount, 300);
  });

  it("DE OTRA CUENTA: si la clínica conectó otra cuenta de MP, no se aplica a ciegas (lanza para que MP reintente)", async () => {
    const e = escenario();
    const invoiceId = e.factura();
    const pedido = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    const depId = pedido.deposit!.id;
    e.desconectarOtraCuenta();
    e.pagar("504", { externalReference: refDeAnticipo(depId), transactionAmount: 300 });
    await assert.rejects(() => aplicarPagoDeAnticipo(depId, "504", e.depsPago as any));
    const inv = e.db.tablas.invoice.find((i) => i.id === invoiceId);
    assert.equal(inv.paid, 0);
  });

  it("factura CANCELADA con el anticipo pendiente: se registra el pago pero queda marcado para revisar, sin tocar el total", async () => {
    const e = escenario();
    const invoiceId = e.factura();
    const pedido = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);
    const depId = pedido.deposit!.id;
    const inv = e.db.tablas.invoice.find((i) => i.id === invoiceId);
    inv.status = "CANCELLED";

    e.pagar("505", { externalReference: refDeAnticipo(depId), transactionAmount: 300 });
    const r = await aplicarPagoDeAnticipo(depId, "505", e.depsPago as any);
    assert.equal(r.aplicado, true);
    assert.match(r.aplicado && r.anomalia || "", /cancelada/);
    assert.equal(e.db.tablas.payment.length, 1, "el dinero se registra igual (es del paciente)");
    assert.equal(inv.paid, 0, "pero el total de la factura cancelada no se toca");
  });
});

describe("cerrarAnticiposDePanel: la factura cambia con el anticipo pendiente", () => {
  it("cierra la preferencia en Mercado Pago, marca el anticipo EXPIRED y quita SOLO el apartado (la cita sigue viva)", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 3600_000) });
    const invoiceId = e.factura({ appointmentId: "apt1" });
    await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300 }, e.deps);

    const cerrados = await cerrarAnticiposDePanel({ clinicId: "c1", invoiceId }, e.deps);
    assert.equal(cerrados, 1);
    assert.equal(e.db.tablas.appointmentDeposit[0].status, "EXPIRED");
    assert.equal(e.expiradas.length, 1, "la preferencia de Mercado Pago se cierra");
    const appt = e.db.tablas.appointment.find((a: any) => a.id === "apt1");
    assert.equal(appt.status, "SCHEDULED", "la cita NO se cancela: ya existía antes del anticipo");
    assert.equal(appt.holdExpiresAt, null, "solo se le quita el apartado");
  });

  it("sin ningún PENDING, no hace nada (nunca lanza)", async () => {
    const e = escenario();
    const invoiceId = e.factura();
    const cerrados = await cerrarAnticiposDePanel({ clinicId: "c1", invoiceId }, e.deps);
    assert.equal(cerrados, 0);
  });
});

describe("permiso billing.deposit: quién puede pedir un anticipo (ws1-t3)", () => {
  const u = (role: string, permissionsOverride: string[] = []) => ({ role: role as any, permissionsOverride });
  it("ADMIN, SUPER_ADMIN, RECEPTIONIST y DOCTOR pueden por default", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "RECEPTIONIST", "DOCTOR"]) {
      assert.equal(hasPermission(u(role), "billing.deposit"), true, `${role} debería poder pedir anticipo`);
    }
  });
  it("READONLY no, por default (dinero: no es de solo lectura)", () => {
    assert.equal(hasPermission(u("READONLY"), "billing.deposit"), false);
  });
  it("una clínica se lo puede quitar al doctor desde Equipo → Permisos (el override reemplaza)", () => {
    const sinDeposito = ["today.view", "agenda.view", "billing.view"]; // override explícito sin billing.deposit
    assert.equal(hasPermission(u("DOCTOR", sinDeposito), "billing.deposit"), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FASE 2 — «Pedir anticipo → Transferencia» y «Registrar anticipo recibido»
// ═══════════════════════════════════════════════════════════════════════

describe("canalesAnticipoPanel: los dos canales son independientes", () => {
  it("sin cuenta de MP y sin datos bancarios: los dos apagados", async () => {
    const e = escenario();
    e.db.tablas.clinicMercadoPago[0].accessToken = null; // "sin cuenta" para el doble
    const c = await canalesAnticipoPanel("c1", e.deps);
    assert.equal(c.mercadopago, false);
    assert.equal(c.transferencia, false);
  });

  it("con cuenta de MP pero SIN datos bancarios: solo mercadopago", async () => {
    const e = escenario();
    const c = await canalesAnticipoPanel("c1", e.deps);
    assert.equal(c.mercadopago, true);
    assert.equal(c.transferencia, false);
  });

  it("con datos bancarios pero SIN cuenta de MP: solo transferencia", async () => {
    const e = escenario();
    e.db.tablas.clinicMercadoPago[0].accessToken = null;
    e.cargarBanco();
    const c = await canalesAnticipoPanel("c1", e.deps);
    assert.equal(c.mercadopago, false);
    assert.equal(c.transferencia, true);
  });

  it("con los dos: los dos encendidos", async () => {
    const e = escenario();
    e.cargarBanco();
    const c = await canalesAnticipoPanel("c1", e.deps);
    assert.equal(c.mercadopago, true);
    assert.equal(c.transferencia, true);
  });
});

describe("pedirAnticipoDeFactura con metodo=\"transferencia\": sin link, sin llamar a Mercado Pago", () => {
  it("sin datos bancarios cargados: rechazado con sin_mp, no toca Mercado Pago", async () => {
    const e = escenario();
    const invoiceId = e.factura();
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, metodo: "transferencia" }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "sin_mp");
    assert.equal(e.preferencias.length, 0);
  });

  it("con datos bancarios: crea el PENDING con checkoutUrl null y metodo transferencia, NUNCA llama a crearPreferencia", async () => {
    const e = escenario();
    e.cargarBanco();
    const invoiceId = e.factura();
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, metodo: "transferencia" }, e.deps);
    assert.equal(r.ok, true);
    assert.equal(r.deposit?.checkoutUrl, null);
    assert.equal(r.deposit?.metodo, "transferencia");
    assert.equal(e.preferencias.length, 0, "transferencia no pide ningún link a Mercado Pago");
    const dep = e.db.tablas.appointmentDeposit[0];
    assert.equal(dep.method, "transferencia");
    assert.equal(dep.mpCollectorId, null);
    assert.equal(dep.status, "PENDING");
  });

  it("aparta la cita igual que Mercado Pago (holdExpiresAt tope al inicio de la cita)", async () => {
    const e = escenario({ horas: 48 });
    e.cargarBanco();
    e.db.tablas.appointment.push({
      id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED",
      startsAt: new Date(T0.getTime() + 3 * 3600_000),
    });
    const invoiceId = e.factura({ appointmentId: "apt1" });
    const r = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, metodo: "transferencia" }, e.deps);
    assert.equal(r.deposit?.apartada, true);
    const appt = e.db.tablas.appointment[0];
    assert.equal(appt.holdExpiresAt.getTime(), appt.startsAt.getTime());
  });

  it("DOBLE: pedirlo dos veces (transferencia) devuelve el MISMO PENDING, nunca un segundo", async () => {
    const e = escenario();
    e.cargarBanco();
    const invoiceId = e.factura();
    const r1 = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, metodo: "transferencia" }, e.deps);
    const r2 = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 999, metodo: "transferencia" }, e.deps);
    assert.equal(r1.deposit?.id, r2.deposit?.id);
    assert.equal(r2.reutilizado, true);
    assert.equal(e.db.tablas.appointmentDeposit.length, 1);
  });
});

describe("registrarAnticipoRecibido (fase 2): efectivo/transferencia/terminal, sin webhook", () => {
  it("efectivo: crea el Payment con method REAL (no \"anticipo\"), suma a paid/balance, confirma la cita SCHEDULED", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "SCHEDULED", startsAt: new Date(T0.getTime() + 3600_000) });
    const invoiceId = e.factura({ total: 1000, paid: 0, appointmentId: "apt1" });
    const r = await registrarAnticipoRecibido({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, method: "cash" }, e.deps);
    assert.equal(r.ok, true);
    assert.equal(r.registrado?.citaConfirmada, true);
    assert.equal(r.registrado?.anomalia, null);
    const pago = e.db.tablas.payment[0];
    assert.equal(pago.method, "cash", "el método REAL, para arqueo y CFDI — nunca \"anticipo\"");
    assert.equal(pago.amount, 300);
    const inv = e.db.tablas.invoice.find((i: any) => i.id === invoiceId);
    assert.equal(inv.paid, 300);
    assert.equal(inv.status, "PARTIAL");
    const appt = e.db.tablas.appointment.find((a: any) => a.id === "apt1");
    assert.equal(appt.status, "CONFIRMED");
    assert.equal(appt.holdExpiresAt, null);
    const dep = e.db.tablas.appointmentDeposit[0];
    assert.equal(dep.status, "PAID");
    assert.equal(dep.method, "manual", "efectivo/débito/crédito se guardan como \"manual\" en el anticipo — lo granular vive en el Payment");
    assert.equal(dep.paymentId, pago.id);
    // ws1-t1 (M6): sin esto, `appointmentConfirmed` se quedaba en su default
    // (false) aunque la cita SÍ se haya confirmado — «Últimos anticipos» lee
    // esta columna, no la variable en memoria de la respuesta.
    assert.equal(dep.appointmentConfirmed, true, "M6: se persiste, no solo se devuelve en la respuesta");
  });

  it("transferencia SIN referencia: rechazada, no crea nada", async () => {
    const e = escenario();
    const invoiceId = e.factura({ total: 1000, paid: 0 });
    const r = await registrarAnticipoRecibido({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, method: "transfer" }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "referencia_requerida");
    assert.equal(e.db.tablas.payment.length, 0);
  });

  it("transferencia CON referencia: la guarda en Payment.reference y el depósito queda method=transferencia", async () => {
    const e = escenario();
    const invoiceId = e.factura({ total: 1000, paid: 0 });
    const r = await registrarAnticipoRecibido(
      { clinicId: "c1", invoiceId, userId: "u1", monto: 300, method: "transfer", reference: "CR123456" },
      e.deps,
    );
    assert.equal(r.ok, true);
    assert.equal(e.db.tablas.payment[0].reference, "CR123456");
    assert.equal(e.db.tablas.appointmentDeposit[0].method, "transferencia");
  });

  it("reusa el PENDING que ya existía de \"Pedir anticipo → Transferencia\" (no crea un segundo depósito)", async () => {
    const e = escenario();
    e.cargarBanco();
    const invoiceId = e.factura({ total: 1000, paid: 0 });
    const pedido = await pedirAnticipoDeFactura({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, metodo: "transferencia" }, e.deps);
    assert.equal(e.db.tablas.appointmentDeposit.length, 1);
    const r = await registrarAnticipoRecibido(
      { clinicId: "c1", invoiceId, userId: "u1", monto: 300, method: "transfer", reference: "REF1" },
      e.deps,
    );
    assert.equal(r.ok, true);
    assert.equal(e.db.tablas.appointmentDeposit.length, 1, "el mismo depósito, no uno nuevo");
    assert.equal(e.db.tablas.appointmentDeposit[0].id, pedido.deposit?.id);
    assert.equal(e.db.tablas.appointmentDeposit[0].status, "PAID");
  });

  it("monto MAYOR al saldo pendiente: rechazado, ni el Payment ni la factura se tocan", async () => {
    const e = escenario();
    const invoiceId = e.factura({ total: 1000, paid: 700 }); // saldo 300
    const r = await registrarAnticipoRecibido({ clinicId: "c1", invoiceId, userId: "u1", monto: 301, method: "cash" }, e.deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, "monto_invalido");
    assert.equal(e.db.tablas.payment.length, 0);
  });

  it("la cita ya NO está SCHEDULED (el hueco se perdió): el dinero se registra igual, pero queda anomalía y NO se confirma sola", async () => {
    const e = escenario();
    e.db.tablas.appointment.push({ id: "apt1", clinicId: "c1", patientId: "p1", doctorId: "d1", status: "CANCELLED", startsAt: new Date(T0.getTime() + 3600_000) });
    const invoiceId = e.factura({ total: 1000, paid: 0, appointmentId: "apt1" });
    const r = await registrarAnticipoRecibido({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, method: "cash" }, e.deps);
    assert.equal(r.ok, true, "el dinero SIEMPRE se registra, pase lo que pase con la cita");
    assert.equal(r.registrado?.citaConfirmada, false);
    assert.match(r.registrado?.anomalia ?? "", /no estaba disponible/);
    const inv = e.db.tablas.invoice.find((i: any) => i.id === invoiceId);
    assert.equal(inv.paid, 300, "el pago SÍ entró aunque la cita no se haya podido confirmar");
    const appt = e.db.tablas.appointment.find((a: any) => a.id === "apt1");
    assert.equal(appt.status, "CANCELLED", "no se toca a ciegas");
    const pago = e.db.tablas.payment[0];
    assert.match(pago.notes ?? "", /⚠️/, "la anomalía queda anotada en el Payment, visible en Caja");
    const dep = e.db.tablas.appointmentDeposit[0];
    assert.equal(dep.appointmentConfirmed, false, "M6: tampoco queda en true cuando no se pudo confirmar");
  });

  // ws1-t1 (M6, QA ws1-t10): un anticipo registrado a mano SIN ninguna cita
  // ligada (factura suelta) no tiene ningún hueco que confirmar o perder —
  // «Últimos anticipos» (pantalla.server.ts → anticipos-client.tsx) no debe
  // pintar «el horario ya se había liberado» sobre él.
  it("SIN cita ligada (factura suelta): citaConfirmada es false pero NO hay anomalía — nunca hubo hueco que perder", async () => {
    const e = escenario();
    const invoiceId = e.factura({ total: 1000, paid: 0 }); // sin appointmentId
    const r = await registrarAnticipoRecibido({ clinicId: "c1", invoiceId, userId: "u1", monto: 300, method: "cash" }, e.deps);
    assert.equal(r.ok, true);
    assert.equal(r.registrado?.citaConfirmada, false);
    assert.equal(r.registrado?.anomalia, null, "sin cita no hay «hueco perdido» que anotar");
    const dep = e.db.tablas.appointmentDeposit[0];
    assert.equal(dep.appointmentId, null);
  });
});
