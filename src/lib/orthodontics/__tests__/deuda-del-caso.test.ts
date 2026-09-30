// ws1-t4 (revisión final en panel.108, antes de migrar una clínica real).
//  · Fallo 1: lo que debe el caso es UN número (`deudaDelCaso`) en Cobranza, la
//    ficha, Casos y la cabecera; la colocación sin plazos de «Pago por control»
//    (y el pago único de «Precio total») cuenta.
//  · Fallo 2: el catálogo sembrado con la columna en NULL sigue siendo «con costo
//    aparte» (`cobroDelProcedimiento`).
//  · Fallo 5: la marca interna de la factura no se ve y no se pierde al editar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cobranzaDelCasoUnificada, deudaDelCaso, type CargoDeControl } from "../cobranza-caso";
import { filasDeCobranza, resumenDeCobranza } from "../cobranza-modulo";
import { cobroDelProcedimiento } from "../catalog-procedures";
import { vencimientoDeFacturaPrincipal } from "../cobranza-controles-db";
import { marcaInternaDe, notasParaGuardar, notasVisibles } from "@/lib/invoices/marcas-internas";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import type { OrthoCaseSummary } from "../specialty-kpis";

const ZONA = "America/Mexico_City";
const AHORA = new Date("2026-09-30T18:00:00Z"); // 30-sep, 12:00 en México

const control = (p: Partial<CargoDeControl>): CargoDeControl => ({
  invoiceId: "ctl-1",
  invoiceNumber: "MF-1081",
  total: 300,
  pagado: 0,
  vencimiento: "2026-09-29",
  status: "PARTIAL",
  ...p,
});

// «QaF1P Control Dos»: colocación $3,000 (MF-1080, sin plazos, sin pagar), un control $300 con $100 abonados.
function controlDos() {
  return cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [], invoiceId: "col-1", vencimiento: "2026-09-29" },
    cargosControl: [control({ pagado: 100 })],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
}

test("fallo 1: la colocación sin plazos de «Pago por control» ya es deuda del caso ($3,000 + $200 = $3,200)", () => {
  const c = controlDos();
  assert.ok(c);
  assert.equal(c!.saldoTotal, 3200);
  assert.equal(c!.vencidas.length, 2);
  const colocacion = c!.vencidas.find((q) => q.invoiceId === "col-1");
  assert.equal(colocacion?.falta, 3000);
  const d = deudaDelCaso(c, undefined);
  assert.deepEqual(
    { porCobrar: d.porCobrar, delPlan: d.delPlan, extras: d.extras, vencido: d.vencido, facturado: d.facturado, pagado: d.pagado },
    { porCobrar: 3200, delPlan: 3200, extras: 0, vencido: 3200, facturado: 3300, pagado: 100 },
  );
  // Facturado − pagado + extras = por cobrar: las tres cifras de la ficha cuadran.
  assert.equal(d.facturado - d.pagado + d.extras, d.porCobrar);
});

test("fallo 1: con un extra de $250 sin pagar, lo que debe el caso es $3,550 (lo mismo que la lista de Pacientes)", () => {
  const c = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [], invoiceId: "col-3", vencimiento: "2026-09-29" },
    cargosControl: [control({ invoiceId: "ctl-3", pagado: 0 })],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  const d = deudaDelCaso(c, { monto: 250, cantidad: 1 });
  assert.equal(d.porCobrar, 3550);
  assert.equal(d.extras, 250);
  assert.equal(d.extrasCantidad, 1);
  assert.equal(d.facturado - d.pagado + d.extras, d.porCobrar);
});

test("fallo 1: la colocación pagada de más no cuenta como deuda y lo de más es saldo a favor", () => {
  const c = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [{ amount: 3200 }], invoiceId: "col", vencimiento: "2026-09-01" },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(c!.saldoTotal, 0);
  assert.equal(c!.pagadas.length, 1);
  assert.equal(c!.cuotaDeHoy, null);
  assert.equal(c!.saldoAFavor, 200);
});

test("fallo 1: un reembolso resta de lo pagado de la colocación", () => {
  const c = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [{ amount: 3000 }, { amount: 500, method: "refund" }], vencimiento: "2026-10-05" },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(c!.saldoTotal, 500);
  assert.equal(c!.proximas.length, 1);
  assert.equal(c!.proximoVencimiento, "2026-10-05");
});

test("fallo 1: «Precio total» de pago único sin fecha se debe, pero no sale vencido", () => {
  const c = cobranzaDelCasoUnificada({
    modo: "PRECIO_TOTAL",
    facturaPrincipal: { condiciones: null, totalFactura: 30000, cobros: [{ amount: 10000 }], vencimiento: null },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(c!.saldoTotal, 20000);
  assert.equal(c!.vencidas.length, 0);
  assert.equal(c!.proximas.length, 1);
  assert.equal(c!.proximoVencimiento, null);
});

test("fallo 1: un plan a plazos se sigue calculando igual (la cuota única solo es para facturas sin plazos)", () => {
  const plazos: CondicionesPago = { ...condicionesPorDefecto(), modo: "plazos", numPagos: 3, primerPago: "2026-01-03" };
  const c = cobranzaDelCasoUnificada({
    modo: "PRECIO_TOTAL",
    facturaPrincipal: { condiciones: plazos, totalFactura: 6000, cobros: [{ amount: 2000 }], vencimiento: "2020-01-01", invoiceId: "x" },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(c!.pagadas.length + c!.vencidas.length + c!.proximas.length, 3);
  assert.equal(c!.saldoTotal, 4000);
  // Las cuotas de la factura a plazos no llevan invoiceId propio (así se distinguen de los controles).
  assert.ok([...c!.pagadas, ...c!.vencidas].every((q) => q.invoiceId === undefined));
});

test("fallo 1: cuándo vence la factura principal sin plazos", () => {
  const creada = new Date("2026-09-29T01:30:00Z"); // 28-sep 19:30 en México
  assert.equal(vencimientoDeFacturaPrincipal("PAGO_POR_CONTROL", null, creada, ZONA), "2026-09-28");
  assert.equal(vencimientoDeFacturaPrincipal("PRECIO_TOTAL", null, creada, ZONA), null);
  assert.equal(vencimientoDeFacturaPrincipal(null, null, creada, ZONA), null);
  assert.equal(vencimientoDeFacturaPrincipal("PRECIO_TOTAL", new Date("2026-10-15T00:00:00Z"), creada, ZONA), "2026-10-15");
});

function caso(p: Partial<OrthoCaseSummary>): OrthoCaseSummary {
  return {
    planId: "p1",
    patientId: "pa1",
    patientName: "QaF1P Control Dos",
    treatingDoctorId: null,
    treatingDoctorName: null,
    status: "IN_PROGRESS",
    installedAt: null,
    estimatedDurationMonths: 24,
    droppedOutAt: null,
    statusUpdatedAt: new Date("2026-09-01T00:00:00Z"),
    diasEnPausa: 0,
    cobranza: null,
    ...p,
  } as OrthoCaseSummary;
}

test("fallo 1: Cobranza dice el mismo «por cobrar» que la ficha (colocación + control + extras)", () => {
  const filas = filasDeCobranza([caso({ cobranza: controlDos(), extrasPendientes: { monto: 250, cantidad: 1 } })], "2026-09-30");
  assert.equal(filas.length, 1);
  const f = filas[0]!;
  assert.equal(f.situacion, "vencido");
  assert.equal(f.porCobrar, deudaDelCaso(controlDos(), { monto: 250, cantidad: 1 }).porCobrar);
  assert.equal(f.porCobrar, 3450);
  assert.equal(f.vencido, 3200);
  assert.equal(f.extrasPendientes, 250);
  const r = resumenDeCobranza(filas);
  assert.equal(r.porCobrar, 3450);
  assert.equal(r.extras, 250);
});

test("fallo 1: un caso sin plan que solo debe extras dice cuánto debe", () => {
  const filas = filasDeCobranza([caso({ cobranza: null, extrasPendientes: { monto: 350, cantidad: 1 } })], "2026-09-30");
  assert.equal(filas[0]!.situacion, "sin-plan");
  assert.equal(filas[0]!.porCobrar, 350);
});

test("fallo 2: el catálogo sembrado con la columna en NULL se cobra como dice la precarga o la descripción", () => {
  assert.equal(cobroDelProcedimiento({ name: "Microimplante (TAD)", description: "Con costo aparte.", orthoIncludedInTreatment: null }), false);
  assert.equal(cobroDelProcedimiento({ name: "Reposición de bracket", description: null, orthoIncludedInTreatment: null }), false);
  assert.equal(cobroDelProcedimiento({ name: "Colocación de elásticos", description: null, orthoIncludedInTreatment: null }), true);
  // Fuera de la precarga: manda la descripción.
  assert.equal(cobroDelProcedimiento({ name: "Mini-implante extra", description: "Con costo aparte, por pieza.", orthoIncludedInTreatment: null }), false);
  assert.equal(cobroDelProcedimiento({ name: "Otra cosa", description: "Incluido en el tratamiento.", orthoIncludedInTreatment: null }), true);
  assert.equal(cobroDelProcedimiento({ name: "Otra cosa", description: "", orthoIncludedInTreatment: null }), null);
  // El control y lo que se hace dentro del control no tienen cobro propio.
  assert.equal(cobroDelProcedimiento({ name: "Control de ortodoncia", description: "… se cobra aparte en cada visita.", orthoIncludedInTreatment: null }), null);
  assert.equal(cobroDelProcedimiento({ name: "Cambio de arco", description: "Incluido en el tratamiento.", orthoIncludedInTreatment: null }), null);
  // Si la columna dice algo, manda ella (aunque la descripción diga otra cosa).
  assert.equal(cobroDelProcedimiento({ name: "Microimplante (TAD)", description: "Con costo aparte.", orthoIncludedInTreatment: true }), true);
});

test("fallo 5: la marca interna no se ve y no se pierde al editar las notas", () => {
  const notas = "[control-hoja:33da2af3-1111-2222-3333-444455556666] Control de ortodoncia registrado desde la ficha, sin cita.";
  assert.equal(notasVisibles(notas), "Control de ortodoncia registrado desde la ficha, sin cita.");
  assert.equal(marcaInternaDe(notas), "[control-hoja:33da2af3-1111-2222-3333-444455556666]");
  assert.equal(notasVisibles("[extra-hoja:c1:p1] Extra de ortodoncia de la hoja de control 2: Recementado."), "Extra de ortodoncia de la hoja de control 2: Recementado.");
  assert.equal(notasVisibles("Nota normal [control-hoja:x] a media frase"), "Nota normal [control-hoja:x] a media frase");
  assert.equal(notasVisibles(null), "");

  // Lo editado vuelve con su marca delante: la factura sigue siendo el control de su hoja.
  assert.equal(notasParaGuardar(notas, "Pagará el viernes"), "[control-hoja:33da2af3-1111-2222-3333-444455556666] Pagará el viernes");
  assert.equal(notasParaGuardar(notas, null), "[control-hoja:33da2af3-1111-2222-3333-444455556666]");
  assert.equal(notasParaGuardar(notas, notas), notas);
  // Sin marca, se guarda lo que llega.
  assert.equal(notasParaGuardar("Nota vieja", "Nota nueva"), "Nota nueva");
  assert.equal(notasParaGuardar(null, null), null);
});

// ── Segunda pasada de ws1-t1, fallo A: lo pagado es `Invoice.paid` (lo mismo que Facturación) ──

test("fallo A: colocación migrada de Dentalink ya pagada ($8,000 en `paid`, sin filas en payments) no se debe", () => {
  // «QaF1 Ana Control Uno»: MF-1086 $8,000 PAID, controles MF-1087/1088 pagados.
  const c = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 8000, cobros: [], pagado: 8000, invoiceId: "mf-1086", vencimiento: "2026-06-01" },
    cargosControl: [control({ invoiceId: "mf-1087", total: 500, pagado: 500, vencimiento: "2026-07-10" }), control({ invoiceId: "mf-1088", total: 500, pagado: 500, vencimiento: "2026-08-10" })],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(c!.saldoTotal, 0);
  assert.equal(c!.vencidas.length, 0);
  const d = deudaDelCaso(c, undefined);
  assert.deepEqual([d.porCobrar, d.vencido, d.facturado, d.pagado], [0, 0, 9000, 9000]);
  // Cobranza: «Saldado», no «Vencido $8,000».
  assert.equal(filasDeCobranza([caso({ cobranza: c })], "2026-09-30")[0]!.situacion, "saldado");
});

test("fallo A: «Precio total» migrado sin plazos ($30,000 con $10,000 migrados) debe $20,000", () => {
  // «QaF1 Beto Total Dos»: MF-1089.
  const c = cobranzaDelCasoUnificada({
    modo: "PRECIO_TOTAL",
    facturaPrincipal: { condiciones: null, totalFactura: 30000, cobros: [], pagado: 10000, invoiceId: "mf-1089", vencimiento: null },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(c!.saldoTotal, 20000);
  assert.equal(deudaDelCaso(c, undefined).porCobrar, 20000);
  assert.equal(deudaDelCaso(c, undefined).pagado, 10000);
});

test("fallo A: con plazos, lo migrado también cubre cuotas en cascada", () => {
  const plazos: CondicionesPago = { ...condicionesPorDefecto(), modo: "plazos", numPagos: 3, primerPago: "2026-07-03" };
  const c = cobranzaDelCasoUnificada({
    modo: "PRECIO_TOTAL",
    facturaPrincipal: { condiciones: plazos, totalFactura: 6000, cobros: [], pagado: 4000, invoiceId: "x" },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(c!.pagadas.length, 2);
  assert.equal(c!.saldoTotal, 2000);
  assert.equal(c!.vencidas.length, 1, "la tercera (3-sep) ya venció");
});

test("fallo A: `paid` manda sobre las filas de payments; sin `paid`, se usan las filas (como antes)", () => {
  // Cobro normal + migrado + anticipo aplicado: Facturación dice paid = $2,500 aunque solo haya una fila de $1,000.
  const conPaid = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [{ amount: 1000, method: "cash" }], pagado: 2500, vencimiento: "2026-09-01" },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(conPaid!.saldoTotal, 500);
  const sinPaid = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [{ amount: 1000, method: "cash" }], vencimiento: "2026-09-01" },
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(sinPaid!.saldoTotal, 2000);
});

test("fallo A: Control Dos y Extras Tres siguen en $3,200 y $3,550 con `paid` real", () => {
  const dos = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [], pagado: 0, invoiceId: "mf-1080", vencimiento: "2026-09-29" },
    cargosControl: [control({ pagado: 100 })],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(deudaDelCaso(dos, undefined).porCobrar, 3200);
  const tres = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: { condiciones: null, totalFactura: 3000, cobros: [], pagado: 0, invoiceId: "mf-1082", vencimiento: "2026-09-29" },
    cargosControl: [control({ invoiceId: "mf-1083", pagado: 0 })],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.equal(deudaDelCaso(tres, { monto: 250, cantidad: 1 }).porCobrar, 3550);
});
