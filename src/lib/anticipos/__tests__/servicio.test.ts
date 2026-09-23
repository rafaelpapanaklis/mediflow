// WS1-T5 — anticipo por WhatsApp: el servicio conducido de verdad, con una base
// en memoria (doble-base.ts) y un Mercado Pago de mentira. Cubre lo que pidió el
// encargo: webhook repetido (idempotencia), pago rechazado, pago fuera de plazo,
// monto manipulado desde el cliente y clínica sin cuenta conectada; más el link
// que no sale, la comisión en pesos y la limpieza del cron.
// Correr: npm run test:anticipos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DobleBase } from "./doble-base";
import {
  aplicarPagoDeAnticipo,
  anticipoParaAnunciar,
  crearCitaDesdeBot,
  liberarAnticiposVencidos,
  type AvisoAnticipo,
  type DepsAnticipos,
} from "../servicio.server";
import { refDeAnticipo } from "../core";
import { MOTIVO_APARTADO_LIBERADO } from "../../agenda/apartado";
import type { MercadoPagoPayment } from "../../mercadopago";

const T0 = new Date("2026-09-22T16:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

const CITA = {
  clinicId: "c1",
  patientId: "p1",
  doctorId: "d1",
  dateISO: "2026-09-25",
  time: "10:00",
  durationMin: 30,
  reason: "Limpieza",
  serviceId: "svc1",
  threadId: "t1",
};

function escenario(opts: {
  cuenta?: boolean;
  config?: Record<string, unknown>;
  linkFalla?: boolean;
} = {}) {
  const db = new DobleBase();
  db.tablas.clinic.push(
    { id: "c1", name: "Clínica Sonrisa", timezone: "America/Mexico_City" },
    { id: "c2", name: "Otra Clínica", timezone: "America/Mexico_City" },
  );
  db.tablas.procedureCatalog.push({ id: "svc1", clinicId: "c1", isActive: true, basePrice: 1200 });
  db.tablas.inboxThread.push({ id: "t1", clinicId: "c1", externalId: "5215512345678" });
  if (opts.cuenta !== false) {
    db.tablas.clinicMercadoPago.push({
      clinicId: "c1",
      mpUserId: "999",
      accessToken: "v1:cifrado",
      depositEnabled: true,
      depositMode: "fixed",
      depositAmount: 300,
      depositPercent: 0,
      holdMinutes: 30,
      marketplaceFeeMode: "fixed",
      marketplaceFeeValue: 0,
      ...opts.config,
    });
  }

  let reloj = T0;
  const preferencias: Array<{ token: string; opts: any }> = [];
  const citasCreadas: any[] = [];
  const avisos: AvisoAnticipo[] = [];
  const pagos = new Map<string, MercadoPagoPayment>();
  let usuarioConectado = "999";

  const deps: Partial<DepsAnticipos> = {
    db: db.cliente(),
    plataformaLista: () => true,
    credencial: async (clinicId) => {
      const f = db.tablas.clinicMercadoPago.find((x) => x.clinicId === clinicId && x.accessToken);
      return f ? { accessToken: `TOKEN-${clinicId}`, mpUserId: usuarioConectado } : null;
    },
    consultarPago: async (token, id) => {
      assert.equal(token, "TOKEN-c1", "el pago se verifica con el token de la clínica");
      return pagos.get(id) ?? null;
    },
    crearPreferencia: async (token, o) => {
      preferencias.push({ token, opts: o });
      if (opts.linkFalla) throw new Error("Mercado Pago 503");
      return { id: `pref-${preferencias.length}`, initPoint: `https://mpago.la/${preferencias.length}` };
    },
    // Hace lo que hace createBotAppointment: la cita y, si viene apartada, su
    // anticipo PENDING en la misma escritura.
    crearCita: async (p: any) => {
      citasCreadas.push(p);
      const id = db.nuevoId("apt");
      db.tablas.appointment.push({
        id,
        clinicId: p.clinicId,
        patientId: p.patientId,
        doctorId: p.doctorId,
        status: "SCHEDULED",
        startsAt: new Date("2026-09-25T16:00:00Z"),
        endsAt: new Date("2026-09-25T16:30:00Z"),
        holdExpiresAt: p.apartado?.vence ?? null,
      });
      if (!p.apartado) return { ok: true, appointmentId: id };
      const depId = db.nuevoId("dep");
      db.tablas.appointmentDeposit.push({
        id: depId,
        clinicId: p.clinicId,
        appointmentId: id,
        patientId: p.patientId,
        amount: p.apartado.anticipo.amount,
        marketplaceFee: p.apartado.anticipo.marketplaceFee,
        currency: "MXN",
        status: "PENDING",
        expiresAt: p.apartado.vence,
        mpCollectorId: p.apartado.anticipo.mpCollectorId,
        waPhone: p.apartado.anticipo.waPhone,
        appointmentConfirmed: false,
        mpPaymentId: null,
        lastMpStatus: null,
      });
      return { ok: true, appointmentId: id, depositId: depId };
    },
    avisar: async (a) => {
      avisos.push(a);
    },
    ahora: () => reloj,
    baseUrl: () => "https://app.dalecontrol.test",
  };

  return {
    db,
    deps,
    preferencias,
    citasCreadas,
    avisos,
    pagar(id: string, over: Partial<MercadoPagoPayment> & { depositId: string }) {
      const { depositId, ...resto } = over;
      pagos.set(id, {
        id,
        status: "approved",
        statusDetail: "accredited",
        externalReference: refDeAnticipo(depositId),
        transactionAmount: 300,
        currencyId: "MXN",
        // Lo añadió el arreglo de reembolsos (H3): un pago sin devolver lleva 0.
        transactionAmountRefunded: 0,
        dateApproved: reloj.toISOString(),
        collectorId: "999",
        payerEmail: "paciente@correo.test",
        paymentMethodId: "visa",
        ...resto,
      });
    },
    reloj(nuevo: Date) {
      reloj = nuevo;
    },
    conectarOtraCuenta(id: string) {
      usuarioConectado = id;
    },
    deposito() {
      return db.tablas.appointmentDeposit[0];
    },
    cita() {
      return db.tablas.appointment[0];
    },
  };
}

async function apartar(e: ReturnType<typeof escenario>) {
  const r = await crearCitaDesdeBot(CITA, e.deps);
  assert.equal(r.ok, true);
  assert.ok(r.anticipo, "la cita salió apartada con link");
  return r;
}

describe("clínica SIN cuenta conectada: la función entera está apagada", () => {
  it("el bot agenda exactamente como siempre, sin apartado ni link", async () => {
    const e = escenario({ cuenta: false });
    assert.equal(await anticipoParaAnunciar("c1", "svc1", e.deps), null);
    const r = await crearCitaDesdeBot(CITA, e.deps);
    assert.equal(r.ok, true);
    assert.equal(r.anticipo, undefined);
    assert.equal(e.citasCreadas[0].apartado, undefined);
    assert.equal(e.cita().holdExpiresAt, null);
    assert.equal(e.preferencias.length, 0);
  });

  it("desconectada (token borrado) aunque el anticipo siga marcado: tampoco cobra", async () => {
    const e = escenario({ config: { accessToken: null } });
    const r = await crearCitaDesdeBot(CITA, e.deps);
    assert.equal(r.anticipo, undefined);
    assert.equal(e.preferencias.length, 0);
  });

  it("con la plataforma sin configurar (faltan credenciales de DaleControl), apagada", async () => {
    const e = escenario();
    const r = await crearCitaDesdeBot(CITA, { ...e.deps, plataformaLista: () => false });
    assert.equal(r.anticipo, undefined);
    assert.equal(e.preferencias.length, 0);
  });
});

describe("con cuenta: aparta el hueco y manda el link", () => {
  it("la cita nace SCHEDULED y apartada 30 min; el link se crea en la cuenta de la clínica", async () => {
    const e = escenario();
    const r = await apartar(e);
    const dep = e.deposito();
    assert.equal(e.cita().status, "SCHEDULED");
    assert.equal(e.cita().holdExpiresAt.getTime(), min(30).getTime());
    assert.equal(dep.status, "PENDING");
    assert.equal(dep.amount, 300);
    assert.equal(dep.waPhone, "5215512345678");
    assert.equal(dep.checkoutUrl, "https://mpago.la/1");

    const { token, opts } = e.preferencias[0];
    assert.equal(token, "TOKEN-c1");
    assert.equal(opts.items[0].unit_price, 300);
    assert.equal(opts.externalReference, refDeAnticipo(dep.id));
    assert.equal(opts.notificationUrl, `https://app.dalecontrol.test/api/webhooks/mercadopago?ref=anticipo%3A${dep.id}`);
    assert.equal(opts.expiresAt.getTime(), min(30).getTime(), "el link caduca con el apartado");
    assert.equal(opts.binaryMode, true, "solo aprobado o rechazado");
    assert.deepEqual(opts.excludedPaymentTypes, ["ticket", "atm"], "sin OXXO: tarda horas");
    assert.equal(opts.marketplaceFee, 0, "la comisión arranca en 0");
    assert.deepEqual(r.anticipo, { url: "https://mpago.la/1", monto: 300, venceA: min(30).toISOString(), minutos: 30 });
  });

  it("comisión en %: MP recibe PESOS, calculados en este cobro", async () => {
    const e = escenario({ config: { marketplaceFeeMode: "percent", marketplaceFeeValue: 5 } });
    await apartar(e);
    assert.equal(e.preferencias[0].opts.marketplaceFee, 15);
    assert.equal(e.deposito().marketplaceFee, 15);
  });

  it("porcentaje del servicio: el precio sale del catálogo de la clínica", async () => {
    const e = escenario({ config: { depositMode: "percent", depositPercent: 25 } });
    assert.deepEqual(await anticipoParaAnunciar("c1", "svc1", e.deps), { monto: 300, minutos: 30 });
    await apartar(e);
    assert.equal(e.preferencias[0].opts.items[0].unit_price, 300);
  });

  it("cita para dentro de 20 min: el plazo se recorta al inicio de la cita", async () => {
    const e = escenario();
    // T0 = 10:00 en CDMX (UTC-6 todo el año).
    const r = await crearCitaDesdeBot({ ...CITA, dateISO: "2026-09-22", time: "10:20" }, e.deps);
    assert.equal(r.anticipo?.minutos, 20);
    assert.equal(r.anticipo?.venceA, min(20).toISOString());
    assert.equal(e.preferencias[0].opts.expiresAt.getTime(), min(20).getTime());
  });

  it("cita para dentro de 5 min: no da tiempo a pagar, se agenda SIN anticipo (como siempre)", async () => {
    const e = escenario();
    const r = await crearCitaDesdeBot({ ...CITA, dateISO: "2026-09-22", time: "10:05" }, e.deps);
    assert.equal(r.ok, true);
    assert.equal(r.anticipo, undefined);
    assert.equal(e.citasCreadas[0].apartado, undefined);
    assert.equal(e.preferencias.length, 0);
  });

  it("si el link no sale, el apartado se deshace: la cita no queda tomada", async () => {
    const e = escenario({ linkFalla: true });
    const r = await crearCitaDesdeBot(CITA, e.deps);
    assert.deepEqual(r, { ok: false, error: "pago_no_disponible" });
    assert.equal(e.cita().status, "CANCELLED");
    assert.equal(e.deposito().status, "FAILED");
  });

  it("una comisión que se come el anticipo no genera link ni aparta nada", async () => {
    const e = escenario({ config: { marketplaceFeeValue: 300 } });
    const r = await crearCitaDesdeBot(CITA, e.deps);
    assert.deepEqual(r, { ok: false, error: "pago_no_disponible" });
    assert.equal(e.db.tablas.appointment.length, 0);
  });
});

describe("monto manipulado desde el cliente", () => {
  it("lo que venga pegado a la petición no llega al link: manda el servidor", async () => {
    const e = escenario();
    const conBasura = { ...CITA, monto: 1, amount: 1, unit_price: 1, anticipo: { monto: 1 } } as any;
    await crearCitaDesdeBot(conBasura, e.deps);
    assert.equal(e.preferencias[0].opts.items[0].unit_price, 300);
    assert.equal(e.deposito().amount, 300);
  });

  it("un pago por menos del anticipo NO confirma: el peso entra a favor y queda marcado", async () => {
    const e = escenario();
    await apartar(e);
    e.pagar("501", { depositId: e.deposito().id, transactionAmount: 1 });
    const r = await aplicarPagoDeAnticipo(e.deposito().id, "501", e.deps);
    assert.equal(r.aplicado, true);
    assert.equal(r.aplicado && r.confirmada, false);
    assert.equal(e.cita().status, "SCHEDULED");
    assert.equal(e.deposito().status, "PENDING", "sigue esperando el anticipo completo");
    assert.equal(e.db.tablas.patientCredit.length, 1);
    assert.equal(e.db.tablas.patientCredit[0].amount, 1);
    assert.match(e.db.tablas.appointmentDepositPayment[0].anomaly, /NO se confirmó/);
    assert.equal(e.avisos.length, 0, "no se le dice «confirmada» a quien pagó de menos");
  });
});

describe("el webhook: pago aprobado", () => {
  it("crea el saldo a favor, confirma la cita, deja rastro y avisa", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.pagar("777", { depositId: dep.id });
    const r = await aplicarPagoDeAnticipo(dep.id, "777", e.deps);
    assert.deepEqual(r, { aplicado: true, depositId: dep.id, monto: 300, confirmada: true, anomalia: null });

    assert.equal(e.cita().status, "CONFIRMED");
    assert.equal(e.cita().holdExpiresAt, null, "ya no caduca");
    assert.equal(e.cita().requiresValidation, false, "sale de la cola «por validar»: el pago la validó");
    assert.equal(dep.status, "PAID");
    assert.equal(dep.mpPaymentId, "777");
    assert.equal(dep.appointmentConfirmed, true);

    const [credito] = e.db.tablas.patientCredit;
    assert.equal(credito.amount, 300);
    assert.equal(credito.patientId, "p1");
    assert.equal(credito.clinicId, "c1");
    assert.equal(credito.source, "anticipo_mercadopago");
    assert.match(credito.description, /^Anticipo de la cita del 25\/09\/2026, 10:00, .*\(pago 777\)\. Se descuenta del tratamiento\.$/);

    const [rastro] = e.db.tablas.appointmentDepositPayment;
    assert.equal(rastro.mpPaymentId, "777");
    assert.equal(rastro.payerEmail, "paciente@correo.test");
    assert.equal(rastro.patientCreditId, credito.id);
    assert.equal(rastro.anomaly, null);
    assert.deepEqual(e.avisos, [{ tipo: "confirmada", depositId: dep.id, monto: 300 }]);
  });
});

describe("webhook repetido: idempotencia", () => {
  it("el mismo pago tres veces seguidas y tres a la vez = UN saldo a favor", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.pagar("888", { depositId: dep.id });
    for (let i = 0; i < 3; i++) await aplicarPagoDeAnticipo(dep.id, "888", e.deps);
    await Promise.all([1, 2, 3].map(() => aplicarPagoDeAnticipo(dep.id, "888", e.deps)));

    assert.equal(e.db.tablas.patientCredit.length, 1, "no se le regalan $1,500 a nadie");
    assert.equal(e.db.tablas.appointmentDepositPayment.length, 1);
    assert.equal(e.avisos.length, 1, "un solo «quedó confirmada»");
    assert.equal(e.cita().status, "CONFIRMED");
  });

  it("dos entregas que se cruzan: el índice único de mpPaymentId frena el segundo saldo", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.pagar("889", { depositId: dep.id });
    // Justo antes de escribir el rastro, «otra entrega» ya lo escribió.
    e.db.antesDeCrear = (modelo, data) => {
      if (modelo !== "appointmentDepositPayment") return;
      e.db.antesDeCrear = null;
      e.db.tablas.appointmentDepositPayment.push({ id: "otra", ...data, patientCreditId: "cr-otra" });
    };
    const r = await aplicarPagoDeAnticipo(dep.id, "889", e.deps);
    assert.deepEqual(r, { aplicado: false, motivo: "pago ya aplicado" });
    assert.equal(e.db.tablas.patientCredit.length, 0, "el saldo de esta entrega se deshizo (ROLLBACK)");
    assert.equal(e.avisos.length, 0);
  });

  it("un SEGUNDO pago distinto del mismo link se registra y se marca para devolver", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.pagar("1", { depositId: dep.id });
    e.pagar("2", { depositId: dep.id });
    await aplicarPagoDeAnticipo(dep.id, "1", e.deps);
    const r = await aplicarPagoDeAnticipo(dep.id, "2", e.deps);
    assert.equal(r.aplicado && r.anomalia !== null, true);
    assert.equal(e.db.tablas.patientCredit.length, 2, "el dinero entró dos veces: es del paciente");
    assert.equal(dep.mpPaymentId, "1", "el anticipo lo saldó el primero");
    assert.equal(e.avisos.length, 1);
  });
});

describe("pago rechazado (o todavía sin aprobar)", () => {
  it("rejected / in_process / pending: ni saldo ni cita confirmada; queda anotado", async () => {
    for (const status of ["rejected", "in_process", "pending"]) {
      const e = escenario();
      await apartar(e);
      const dep = e.deposito();
      e.pagar("9", { depositId: dep.id, status, statusDetail: "cc_rejected_insufficient_amount" });
      const r = await aplicarPagoDeAnticipo(dep.id, "9", e.deps);
      assert.equal(r.aplicado, false, status);
      assert.equal(e.db.tablas.patientCredit.length, 0, status);
      assert.equal(e.cita().status, "SCHEDULED", status);
      assert.equal(dep.status, "PENDING", status);
      assert.equal(dep.lastMpStatus, status);
      assert.equal(dep.lastMpStatusDetail, "cc_rejected_insufficient_amount");
    }
  });

  it("después de un rechazo, reintenta con el mismo link y el aprobado sí confirma", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.pagar("10", { depositId: dep.id, status: "rejected" });
    e.pagar("11", { depositId: dep.id });
    await aplicarPagoDeAnticipo(dep.id, "10", e.deps);
    await aplicarPagoDeAnticipo(dep.id, "11", e.deps);
    assert.equal(e.cita().status, "CONFIRMED");
    assert.equal(e.db.tablas.patientCredit.length, 1);
  });
});

describe("pago fuera de plazo", () => {
  it("si el hueco ya se liberó (otra cita lo pisó), el dinero queda a favor y la cita NO revive", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.reloj(min(40));
    // Lo que hace el trigger appt_liberar_apartado_vencido cuando otra cita entra encima.
    Object.assign(e.cita(), { status: "CANCELLED", cancelReason: MOTIVO_APARTADO_LIBERADO });
    e.pagar("20", { depositId: dep.id });
    const r = await aplicarPagoDeAnticipo(dep.id, "20", e.deps);
    assert.equal(r.aplicado && r.confirmada, false);
    assert.equal(e.cita().status, "CANCELLED");
    assert.equal(dep.status, "PAID");
    assert.equal(dep.appointmentConfirmed, false);
    assert.equal(e.db.tablas.patientCredit.length, 1);
    assert.deepEqual(e.avisos, [{ tipo: "pagada_sin_cita", depositId: dep.id, monto: 300 }]);
  });

  it("si el plazo venció pero NADIE tomó el hueco, se confirma (la base garantiza que sigue libre)", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.reloj(min(32));
    e.pagar("21", { depositId: dep.id });
    const r = await aplicarPagoDeAnticipo(dep.id, "21", e.deps);
    assert.equal(r.aplicado && r.confirmada, true);
    assert.equal(e.cita().status, "CONFIRMED");
  });

  it("el cron: vence, cancela con su motivo y avisa UNA vez; el pago tardío queda a favor", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();

    e.reloj(min(33)); // vencido, pero dentro de la gracia de 5 min
    let res = await liberarAnticiposVencidos(e.deps);
    assert.equal(res.vencidos, 0);
    assert.equal(dep.status, "PENDING");

    e.reloj(min(36));
    res = await liberarAnticiposVencidos(e.deps);
    assert.equal(res.vencidos, 1);
    assert.equal(dep.status, "EXPIRED");
    assert.equal(e.cita().status, "CANCELLED");
    assert.equal(e.cita().cancelReason, MOTIVO_APARTADO_LIBERADO);
    assert.deepEqual(e.avisos, [{ tipo: "liberada", depositId: dep.id }]);

    res = await liberarAnticiposVencidos(e.deps);
    assert.equal(res.vencidos, 0);
    assert.equal(e.avisos.length, 1, "la segunda corrida no vuelve a avisar");

    e.pagar("22", { depositId: dep.id });
    await aplicarPagoDeAnticipo(dep.id, "22", e.deps);
    assert.equal(e.cita().status, "CANCELLED");
    assert.equal(e.db.tablas.patientCredit.length, 1);
    assert.equal(e.avisos[1].tipo, "pagada_sin_cita");
  });

  it("el cron no avisa «se liberó» si el MISMO paciente volvió a tomar ese hueco", async () => {
    const e = escenario();
    await apartar(e);
    const vieja = e.cita();
    e.reloj(min(32));
    Object.assign(vieja, { status: "CANCELLED", cancelReason: MOTIVO_APARTADO_LIBERADO });
    e.db.tablas.appointment.push({
      id: "nueva", clinicId: "c1", patientId: vieja.patientId, doctorId: vieja.doctorId,
      status: "SCHEDULED", startsAt: vieja.startsAt, endsAt: vieja.endsAt, holdExpiresAt: min(62),
    });
    e.reloj(min(40));
    const r = await liberarAnticiposVencidos(e.deps);
    assert.equal(r.liberadas, 1);
    assert.equal(e.avisos.length, 0);
  });

  it("la limpieza de huérfanas nunca toca una cita con anticipo PAGADO", async () => {
    const e = escenario();
    await apartar(e);
    // Estado imposible por el trigger, pero la red de seguridad no debe fiarse.
    e.deposito().status = "PAID";
    e.reloj(min(90));
    const r = await liberarAnticiposVencidos(e.deps);
    assert.equal(r.huerfanas, 0);
    assert.equal(e.cita().status, "SCHEDULED");
  });

  it("el cron no le dice «se liberó» a una cita que la recepción confirmó a mano", async () => {
    const e = escenario();
    await apartar(e);
    e.cita().status = "CONFIRMED";
    e.reloj(min(60));
    await liberarAnticiposVencidos(e.deps);
    assert.equal(e.cita().status, "CONFIRMED");
    assert.equal(e.deposito().status, "EXPIRED");
    assert.equal(e.avisos.length, 0);
  });
});

describe("verificación del pago", () => {
  it("sin cuenta conectada al llegar el webhook: LANZA para que MP reintente", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.db.tablas.clinicMercadoPago[0].accessToken = null;
    e.pagar("30", { depositId: dep.id });
    await assert.rejects(() => aplicarPagoDeAnticipo(dep.id, "30", e.deps));
    assert.equal(e.db.tablas.patientCredit.length, 0);
  });

  it("si la clínica conectó OTRA cuenta después del link: no se aplica a ciegas, queda anotado y MP reintenta", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.conectarOtraCuenta("555");
    e.pagar("31", { depositId: dep.id });
    await assert.rejects(() => aplicarPagoDeAnticipo(dep.id, "31", e.deps));
    assert.equal(e.db.tablas.patientCredit.length, 0);
    assert.equal(dep.lastMpStatus, "otra_cuenta");
    assert.equal(dep.lastMpStatusDetail, "pago 31");
    // Vuelve a conectar la cuenta original: el reintento de MP lo aplica.
    e.conectarOtraCuenta("999");
    const r = await aplicarPagoDeAnticipo(dep.id, "31", e.deps);
    assert.equal(r.aplicado && r.confirmada, true);
  });

  it("un pago ya aplicado que MP reporta DEVUELTO queda marcado; el saldo no se toca solo", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.pagar("40", { depositId: dep.id });
    await aplicarPagoDeAnticipo(dep.id, "40", e.deps);
    e.pagar("40", { depositId: dep.id, status: "refunded", statusDetail: "refunded" });
    await aplicarPagoDeAnticipo(dep.id, "40", e.deps);
    await aplicarPagoDeAnticipo(dep.id, "40", e.deps); // MP reintenta: la nota no se duplica
    const [rastro] = e.db.tablas.appointmentDepositPayment;
    assert.match(rastro.anomaly, /«refunded».*NO se descontó solo/);
    assert.equal(rastro.anomaly.split("refunded").length - 1, 1);
    assert.equal(e.db.tablas.patientCredit.length, 1);
    assert.equal(e.db.tablas.patientCredit[0].amount, 300);
  });

  it("un pago de OTRO anticipo (referencia cruzada) no confirma esta cita", async () => {
    const e = escenario();
    await apartar(e);
    const dep = e.deposito();
    e.pagar("32", { depositId: "otro-anticipo" });
    const r = await aplicarPagoDeAnticipo(dep.id, "32", e.deps);
    assert.equal(r.aplicado, false);
    assert.equal(e.cita().status, "SCHEDULED");
  });

  it("un id de pago que MP no conoce (POST falso) no hace nada", async () => {
    const e = escenario();
    await apartar(e);
    const r = await aplicarPagoDeAnticipo(e.deposito().id, "404404", e.deps);
    assert.equal(r.aplicado, false);
    assert.equal(e.cita().status, "SCHEDULED");
    assert.equal(e.db.tablas.patientCredit.length, 0);
  });

  it("un anticipo que no existe no hace nada", async () => {
    const e = escenario();
    const r = await aplicarPagoDeAnticipo("no-existe", "1", e.deps);
    assert.equal(r.aplicado, false);
  });
});
