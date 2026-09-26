/**
 * Cupos, «última compra» y series del Dashboard de /admin.
 *
 * Run: npm run test:admin-uso
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bytesCortos, compararUltimaCompraDesc, metodoDePago, nivelCupo, pctCupo, senalesDeCupo,
  tokensCortos, ultimaCompra, USO_VACIO, type UsoClinica,
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

test("metodoDePago: la tarjeta manda; transferencia es manual; Stripe sin alta capturada también cuenta", () => {
  assert.deepEqual(metodoDePago({ paymentMethodType: "card", paymentMethodLast4: "4242" }), { etiqueta: "Tarjeta ••4242", manual: false });
  assert.deepEqual(metodoDePago({ paymentMethodType: "transfer" }), { etiqueta: "Transferencia", manual: true });
  assert.deepEqual(metodoDePago({ stripeCustomerId: "cus_1" }), { etiqueta: "Stripe", manual: false });
  assert.deepEqual(metodoDePago({}), { etiqueta: "No registrado", manual: true });
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
  // Saldo bajo pero positivo: aviso medio. Sin monedero: nada.
  assert.equal(senalesDeCupo(entrada({ saldoIaCents: 1500 }))[0].severidad, "medio");
  assert.deepEqual(senalesDeCupo(entrada({ saldoIaCents: null })), []);
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
});

// ── Series ─────────────────────────────────────────────────────────────────

test("serieNegocio por semana: 7 días de Mérida, hoy al final, ceros donde no hubo nada", () => {
  const s = serieNegocio(
    [{ monto: 1719, cuando: AHORA }, { monto: 689, cuando: hace(2) }, { monto: 999, cuando: hace(40) }],
    [hace(1), hace(1), hace(9)],
    AHORA, "semana",
  );
  assert.equal(s.length, 7);
  assert.equal(s[6].clave, "2026-09-26");
  assert.equal(s[6].ingresos, 1719);
  assert.equal(s[6].pagos, 1);
  assert.equal(s[5].altas, 2);
  assert.equal(s[4].ingresos, 689);
  assert.equal(s.reduce((a, p) => a + p.ingresos, 0), 1719 + 689, "el cobro de hace 40 días queda fuera");
  assert.equal(s.reduce((a, p) => a + p.altas, 0), 2);
});

test("serieNegocio por año: 12 meses y el corte es el de Mérida", () => {
  // 1-sep 02:00 UTC = 31-ago 21:00 en Mérida: cae en AGOSTO, no en septiembre.
  const s = serieNegocio([{ monto: 100, cuando: new Date("2026-09-01T02:00:00.000Z") }], [], AHORA, "anio");
  assert.equal(s.length, 12);
  assert.equal(s[11].clave, "2026-09");
  assert.equal(s[11].ingresos, 0);
  assert.equal(s[10].clave, "2026-08");
  assert.equal(s[10].ingresos, 100);
});

test("serieNegocio por mes: 30 días", () => {
  assert.equal(serieNegocio([], [], AHORA, "mes").length, 30);
});

test("conteos y sumas mensuales para los sparklines", () => {
  assert.deepEqual(ultimosMesesAdmin(AHORA, 3).map((m) => m.clave), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(conteoMensual([hace(1), hace(2), hace(40), hace(400)], AHORA, 3), [0, 1, 2]);
  assert.deepEqual(sumaMensual([{ monto: 10, cuando: hace(1) }, { monto: 5, cuando: hace(70) }], AHORA, 3), [5, 0, 10]);
  assert.deepEqual(sumaPorPeriodo([{ period: "2026-09", valor: 4 }, { period: "2026-09", valor: 6 }, { period: "2025-01", valor: 9 }], AHORA, 2), [0, 10]);
});
