/**
 * Cupos, «última compra» y series del Dashboard de /admin.
 *
 * Run: npm run test:admin-uso
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bytesCortos, cercaDelTope, compararUltimaCompraDesc, metodoDePago, nivelCupo, pctCupo, senalesDeCupo,
  tokensCortos, tokensVigentes, ultimaCompra, USO_VACIO, type UsoClinica,
} from "../uso-core";
import { conteoMensual, serieNegocio, sumaMensual, sumaPorPeriodo, ultimosMesesAdmin } from "../serie-negocio";

const GB = 1024 ** 3;
// 26-sep-2026 a las 16:00 UTC = 11:00 en Mérida.
const AHORA = new Date("2026-09-26T16:00:00.000Z");
const DIA = 86_400_000;
const hace = (d: number) => new Date(AHORA.getTime() - d * DIA);

test("nivelCupo: sin tope nunca avisa; 80 % avisa; 100 % lleno", () => {
  assert.equal(nivelCupo(10, null), "ok");
  assert.equal(nivelCupo(10, 0), "ok");
  assert.equal(nivelCupo(79, 100), "ok");
  assert.equal(nivelCupo(80, 100), "aviso");
  assert.equal(nivelCupo(100, 100), "lleno");
  assert.equal(nivelCupo(140, 100), "lleno");
});

test("pctCupo satura a 100 y devuelve null sin tope", () => {
  assert.equal(pctCupo(50, 200), 25);
  assert.equal(pctCupo(300, 200), 100);
  assert.equal(pctCupo(5, null), null);
});

test("bytes y tokens en corto", () => {
  assert.equal(bytesCortos(61.2 * GB), "61 GB");
  assert.equal(bytesCortos(1.1 * GB), "1.1 GB");
  assert.equal(bytesCortos(null), "—");
  assert.equal(tokensCortos(612_000), "612k");
  assert.equal(tokensCortos(1_000_000), "1M");
  assert.equal(tokensCortos(1_250_000), "1.3M");
});

test("metodoDePago: manda lo que cobra hoy, no lo que se eligió en el alta", () => {
  assert.deepEqual(metodoDePago({ paymentMethodType: "card", paymentMethodLast4: "4242" }), { etiqueta: "Tarjeta ••4242", manual: false });
  assert.deepEqual(metodoDePago({ paymentMethodType: "transfer" }), { etiqueta: "Transferencia", manual: true });
  // Eligió transferencia al registrarse y luego pagó con tarjeta en Stripe Checkout: cobra sola.
  assert.deepEqual(metodoDePago({ paymentMethodType: "transfer", stripeSubscriptionId: "sub_1" }), { etiqueta: "Stripe", manual: false });
  assert.deepEqual(metodoDePago({ paymentMethodType: "card", paymentMethodLast4: "1111", stripeSubscriptionId: "sub_1" }), { etiqueta: "Tarjeta ••1111", manual: false });
  assert.deepEqual(metodoDePago({ paypalSubscriptionId: "I-1", paymentMethodType: "transfer" }), { etiqueta: "PayPal", manual: false });
  assert.deepEqual(metodoDePago({ stripeCustomerId: "cus_1" }), { etiqueta: "Stripe", manual: false });
  assert.deepEqual(metodoDePago({ preferredPaymentMethod: "none" }), { etiqueta: "No registrado", manual: true });
  assert.deepEqual(metodoDePago({}), { etiqueta: "No registrado", manual: true });
});

test("tokensVigentes: un contador de un mes anterior vale 0 este mes", () => {
  const ahora = new Date(2026, 8, 26, 12); // 26-sep-2026 local
  assert.equal(tokensVigentes(200_000, new Date(2026, 7, 3), ahora), 0, "reseteado en agosto: septiembre arranca en 0");
  assert.equal(tokensVigentes(150_000, new Date(2026, 8, 2), ahora), 150_000, "reseteado este mes: cuenta");
  assert.equal(tokensVigentes(9, null, ahora), 9, "sin fecha no se toca");
});

test("última compra: el pago manda; sin pago se usa el alta y se dice", () => {
  assert.deepEqual(ultimaCompra({ ultimoPagoAt: hace(9), createdAt: hace(400) }), { fecha: hace(9), esAlta: false });
  assert.deepEqual(ultimaCompra({ ultimoPagoAt: null, createdAt: hace(3) }), { fecha: hace(3), esAlta: true });
});

test("orden por última compra: primero las que compraron (más nueva arriba), luego las de alta", () => {
  const filas = [
    { id: "alta-vieja", ultimoPagoAt: null, createdAt: hace(90) },
    { id: "compra-vieja", ultimoPagoAt: hace(30), createdAt: hace(500) },
    { id: "alta-nueva", ultimoPagoAt: null, createdAt: hace(1) },
    { id: "compra-nueva", ultimoPagoAt: hace(2), createdAt: hace(400) },
  ];
  assert.deepEqual(
    filas.slice().sort(compararUltimaCompraDesc).map((f) => f.id),
    ["compra-nueva", "compra-vieja", "alta-nueva", "alta-vieja"],
  );
});

function entrada(uso: Partial<UsoClinica>, extra: Partial<Parameters<typeof senalesDeCupo>[0]> = {}) {
  return {
    id: "c1", nombre: "Clínica Altabrisa", uso: { ...USO_VACIO, ...uso },
    diasHastaRenovacion: null, suscripcionActiva: true, metodoManual: false,
    pagosPorVerificar: { cuantos: 0, monto: 0 }, ...extra,
  };
}

test("señales de cupo: sólo con dato, y la severidad sigue al nivel", () => {
  assert.deepEqual(senalesDeCupo(entrada({})), [], "sin medir no hay señal");
  const casi = senalesDeCupo(entrada({ storageUsado: 13 * GB, storageTope: 15 * GB }));
  assert.equal(casi.length, 1);
  assert.equal(casi[0].motivo, "almacenamiento");
  assert.equal(casi[0].severidad, "medio");
  assert.equal(casi[0].dato, "87% de 15 GB");
  const lleno = senalesDeCupo(entrada({ storageUsado: 16 * GB, storageTope: 15 * GB }));
  assert.equal(lleno[0].severidad, "alto");
});

test("tokens, CFDI, usuarios y saldo IA", () => {
  const s = senalesDeCupo(entrada({
    tokensUsados: 980_000, tokensTope: 1_000_000,
    cfdiUsados: 161, cfdiIncluidos: 150,
    usuarios: 6, usuariosTope: 6,
    saldoIaCents: -1200,
  }));
  assert.deepEqual(s.map((x) => x.motivo), ["tokens", "cfdi", "usuarios", "saldo-ia"]);
  assert.equal(s[0].severidad, "medio", "98 % es aviso; lleno es al 100 %");
  assert.equal(senalesDeCupo(entrada({ tokensUsados: 1_000_000, tokensTope: 1_000_000 }))[0].severidad, "alto");
  assert.equal(s[1].dato, "11 timbres extra");
  assert.equal(s[3].titulo, "Saldo IA en negativo");
  // Saldo bajo pero positivo: aviso medio. Sin monedero: nada. En $0 exacto
  // tampoco: el monedero se crea con sólo abrir la pantalla del saldo.
  assert.equal(senalesDeCupo(entrada({ saldoIaCents: 1500 }))[0].severidad, "medio");
  assert.deepEqual(senalesDeCupo(entrada({ saldoIaCents: null })), []);
  assert.deepEqual(senalesDeCupo(entrada({ saldoIaCents: 0 })), []);
  assert.deepEqual(senalesDeCupo(entrada({ saldoIaCents: -5, saldoIaStatus: "SIN_DATO" })), [], "si la consulta falló no se inventa");
  // cercaDelTope es la MISMA regla que las señales.
  assert.equal(cercaDelTope({ ...USO_VACIO, usuarios: 5, usuariosTope: 6 }), false, "usuarios al 83 % no es «al tope»");
  assert.equal(cercaDelTope({ ...USO_VACIO, usuarios: 6, usuariosTope: 6 }), true);
  assert.equal(cercaDelTope({ ...USO_VACIO, storageUsado: 13 * GB, storageTope: 15 * GB }), true);
  assert.equal(cercaDelTope(null), false);
  // Tokens sin cupo (BASIC) no avisan aunque used > 0.
  assert.deepEqual(senalesDeCupo(entrada({ tokensUsados: 500, tokensTope: 0 })), []);
});

test("renovación manual sólo si paga a mano, está activa y vence en ≤ 7 días", () => {
  const manual = (dias: number | null, activa = true, m = true) =>
    senalesDeCupo(entrada({}, { diasHastaRenovacion: dias, suscripcionActiva: activa, metodoManual: m }));
  assert.equal(manual(4).length, 1);
  assert.equal(manual(4)[0].dato, "en 4 d");
  assert.equal(manual(0)[0].dato, "vence hoy");
  assert.deepEqual(manual(8), []);
  assert.deepEqual(manual(4, true, false), [], "con tarjeta Stripe cobra solo: no es accionable");
  assert.deepEqual(manual(4, false), [], "sin suscripción viva no hay renovación");
  assert.deepEqual(manual(-1), [], "ya venció: eso lo dice el motivo de cobro, no éste");
});

test("pagos por verificar van primero y con su dinero", () => {
  const s = senalesDeCupo(entrada({ storageUsado: 16 * GB, storageTope: 15 * GB }, { pagosPorVerificar: { cuantos: 2, monto: 1378 } }));
  assert.equal(s[0].motivo, "pago-por-verificar");
  assert.equal(s[0].monto, 1378);
  assert.equal(s[0].dato, "2 pagos");
  assert.equal(s[0].cantidad, 2);
});

// ── Series ─────────────────────────────────────────────────────────────────

test("serieNegocio por semana: lunes a domingo de la semana EN CURSO de Mérida, con los días por venir a 0", () => {
  // 26-sep-2026 es sábado: la semana va del lunes 21 al domingo 27.
  const s = serieNegocio(
    [{ monto: 1719, cuando: AHORA }, { monto: 689, cuando: hace(2) }, { monto: 999, cuando: hace(6) }],
    [hace(1), hace(1), hace(9)],
    AHORA, "semana",
  );
  assert.deepEqual(s.map((p) => p.clave), ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
  assert.match(s[0].label, /^lun 21$/);
  assert.equal(s[5].ingresos, 1719, "hoy sábado");
  assert.equal(s[5].pagos, 1);
  assert.equal(s[3].ingresos, 689, "el jueves");
  assert.equal(s[6].ingresos, 0, "el domingo aún no llega");
  assert.equal(s.reduce((a, p) => a + p.ingresos, 0), 1719 + 689, "el cobro del domingo 20 queda fuera: es la semana pasada");
  assert.equal(s[4].altas, 2);
  assert.equal(s.reduce((a, p) => a + p.altas, 0), 2, "el alta del 17 es de la semana pasada");
});

test("serieNegocio: los tramos que aún no llegan van marcados como futuro, y hoy no", () => {
  const semana = serieNegocio([], [], AHORA, "semana"); // sábado 26
  assert.deepEqual(semana.map((p) => p.futuro), [false, false, false, false, false, false, true], "sólo el domingo 27 es futuro");
  const anio = serieNegocio([], [], AHORA, "anio");
  assert.deepEqual(anio.map((p) => p.futuro), [false, false, false, false, false, false, false, false, false, true, true, true], "oct, nov y dic");
  const mes = serieNegocio([], [], AHORA, "mes");
  assert.equal(mes.filter((p) => p.futuro).length, 4, "27, 28, 29 y 30 de septiembre");
  assert.equal(mes[25].futuro, false, "hoy 26 no es futuro");
  // Un cobro fechado por delante existe y se enseña: ese tramo deja de ser futuro.
  const conFuturo = serieNegocio([{ monto: 10, cuando: new Date("2026-11-10T16:00:00.000Z") }], [], AHORA, "anio");
  assert.equal(conFuturo[10].futuro, false);
  assert.equal(conFuturo[10].ingresos, 10);
});

test("serieNegocio por semana: un lunes la semana empieza ese mismo día", () => {
  const lunes = new Date("2026-09-21T16:00:00.000Z");
  const s = serieNegocio([], [], lunes, "semana");
  assert.equal(s[0].clave, "2026-09-21");
  assert.equal(s[6].clave, "2026-09-27");
});

test("serieNegocio por mes: el mes en curso entero, del 1 al 30", () => {
  const s = serieNegocio([{ monto: 100, cuando: new Date("2026-09-01T02:00:00.000Z") }, { monto: 50, cuando: hace(10) }], [], AHORA, "mes");
  assert.equal(s.length, 30);
  assert.equal(s[0].clave, "2026-09-01");
  assert.equal(s[0].label, "1");
  assert.equal(s[29].clave, "2026-09-30");
  // 1-sep 02:00 UTC = 31-ago 21:00 en Mérida: cae en AGOSTO, fuera del mes.
  assert.equal(s[0].ingresos, 0);
  assert.equal(s.reduce((a, p) => a + p.ingresos, 0), 50);
  assert.equal(serieNegocio([], [], new Date("2026-02-10T12:00:00.000Z"), "mes").length, 28);
});

test("serieNegocio por año: enero a diciembre del año en curso, y el corte es el de Mérida", () => {
  const s = serieNegocio([
    { monto: 100, cuando: new Date("2026-09-01T02:00:00.000Z") },
    { monto: 7, cuando: new Date("2025-12-31T23:00:00.000Z") },
    { monto: 300, cuando: new Date("2026-01-01T08:00:00.000Z") },
  ], [], AHORA, "anio");
  assert.equal(s.length, 12);
  assert.equal(s[0].clave, "2026-01");
  assert.equal(s[0].label, "ene");
  assert.equal(s[11].clave, "2026-12");
  assert.equal(s[7].ingresos, 100, "agosto en Mérida");
  assert.equal(s[8].ingresos, 0);
  assert.equal(s[0].ingresos, 300);
  assert.equal(s.reduce((a, p) => a + p.ingresos, 0), 400, "el cobro de 2025 queda fuera");
});

test("conteos y sumas mensuales para los sparklines", () => {
  assert.deepEqual(ultimosMesesAdmin(AHORA, 3).map((m) => m.clave), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(conteoMensual([hace(1), hace(2), hace(40), hace(400)], AHORA, 3), [0, 1, 2]);
  assert.deepEqual(sumaMensual([{ monto: 10, cuando: hace(1) }, { monto: 5, cuando: hace(70) }], AHORA, 3), [5, 0, 10]);
  assert.deepEqual(sumaPorPeriodo([{ period: "2026-09", valor: 4 }, { period: "2026-09", valor: 6 }, { period: "2025-01", valor: 9 }], AHORA, 2), [0, 10]);
});
