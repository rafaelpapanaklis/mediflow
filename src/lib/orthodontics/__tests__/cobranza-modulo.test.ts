/**
 * Cobranza de mensualidades — la pantalla del módulo (H16 de la QA en vivo).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/cobranza-modulo.test.ts
 *
 * El hallazgo: el apartado decía «Esta pantalla todavía no está lista». Estas
 * pruebas fijan que ahora enseña datos REALES y que dice los mismos números
 * que el resto del módulo: los casos se arman con `cobranzaDelCasoUnificada`,
 * el mismo motor del Tablero, Alertas y la lista de Caja.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { cobranzaDelCasoUnificada } from "../cobranza-caso";
import { computeOverdueBalances, listOverduePatients, type OrthoCaseSummary } from "../specialty-kpis";
import {
  HORIZONTE_POR_VENCER_DIAS,
  diasEntre,
  entraEnFiltro,
  leerFiltroCobranza,
  filasDeCobranza,
  filtrarCobranza,
  fraseDeAtraso,
  fraseDeProxima,
  fraseDeVencidos,
  resumenDeCobranza,
} from "../cobranza-modulo";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const ZONA = "America/Mexico_City";
// El día de la QA: 28-sep-2026, a media mañana en Ciudad de México.
const AHORA = new Date("2026-09-28T16:00:00Z");
const HOY = "2026-09-28";

const plazos = (p: Partial<CondicionesPago>): CondicionesPago => ({
  ...condicionesPorDefecto(),
  modo: "plazos",
  ...p,
});

function caso(
  o: Partial<OrthoCaseSummary> & {
    factura?: { condiciones: CondicionesPago; total: number; cobros?: number[] } | null;
    modo?: string | null;
  } = {},
): OrthoCaseSummary {
  const { factura = null, modo = null, ...resto } = o;
  return {
    planId: "plan-1",
    patientId: "p-1",
    patientName: "Paciente Uno",
    treatingDoctorId: "d-1",
    treatingDoctorName: "Dra. Mariana Cortés",
    status: "IN_PROGRESS",
    installedAt: new Date("2026-06-15T18:00:00Z"),
    estimatedDurationMonths: 12,
    droppedOutAt: null,
    statusUpdatedAt: new Date("2026-06-15T18:00:00Z"),
    cobranza: cobranzaDelCasoUnificada({
      modo,
      facturaPrincipal: factura
        ? {
            condiciones: factura.condiciones,
            totalFactura: factura.total,
            cobros: (factura.cobros ?? []).map((amount) => ({ amount, method: "cash" })),
          }
        : null,
      cargosControl: [],
      saldoAFavorPrevio: 0,
      ahora: AHORA,
      zonaHoraria: ZONA,
    }),
    ...resto,
  };
}

/** «QA Orto Adulto Debe», tal como lo dejó la QA: $24,000, enganche $4,000 el 10-jul y 10 × $2,000 desde el 10-ago, sin pagos. */
const ADULTO_DEBE = () =>
  caso({
    planId: "plan-adulto",
    patientId: "p-adulto",
    patientName: "QA Orto Adulto Debe",
    treatingDoctorName: "Dra. Renata Solís",
    factura: { condiciones: plazos({ enganche: 4000, numPagos: 10, primerPago: "2026-07-10" }), total: 24000 },
  });

/** «QA Orto Menor Pruebas»: $36,000, enganche $6,000 el 5-ago y 15 × $2,000 desde el 5-sep; pagados $13,000. */
const MENOR_AL_CORRIENTE = () =>
  caso({
    planId: "plan-menor",
    patientId: "p-menor",
    patientName: "QA Orto Menor Pruebas",
    factura: {
      condiciones: plazos({ enganche: 6000, numPagos: 15, primerPago: "2026-08-05" }),
      total: 36000,
      cobros: [6000, 2000, 5000],
    },
  });

// ── H16: ya no es un cartel ──────────────────────────────────────────────

test("H16: la página de Cobranza carga los casos de verdad (antes: «Esta pantalla todavía no está lista»)", () => {
  const pagina = leer("src/app/dashboard/orthodontics/cobranza/page.tsx");
  assert.doesNotMatch(pagina, /OrthoModulePlaceholder/, "ya no monta el cartel «Próximamente»");
  assert.match(pagina, /await exigirModuloOrtodoncia\(\);/, "la guarda del módulo, también en la página");
  assert.match(pagina, /loadOrthoCases\(user\.clinicId, zona, viewer, ahora\)/, "clínica y visibilidad, de la sesión");
  assert.match(pagina, /filasDeCobranza\(cases, hoyEnZona\(ahora, zona\)\)/, "«hoy» en la zona de la clínica");
  assert.match(pagina, /<VistaCobranza\s+filas=\{filas\}\s+resumen=\{resumenDeCobranza\(filas\)\}\s+puedeCobrar=\{puedeCobrar\}/);
  // ws1-t4 ronda 6: puede abrir ya filtrada (el indicador del Tablero), con el filtro saneado en el servidor.
  assert.match(pagina, /filtroInicial=\{leerFiltroCobranza\(searchParams\?\.filtro\)\}/);
  assert.match(pagina, /"billing\.charge"/, "cobrar exige billing.charge (el mismo permiso de POST /api/invoices/[id]), no solo verla — ws1-t10 #85");

  // Reutiliza lo que ya existe: el motor de cobranza y la lista de Caja.
  const cargador = leer("src/lib/orthodontics/tablero-data.ts");
  assert.match(cargador, /const cobranza = cobranzaDelCasoUnificada\(\{/);
  const vista = leer("src/components/specialties/orthodontics/modulo/vista-cobranza.tsx");
  assert.match(vista, /^"use client";/);
  assert.match(vista, /<ListaMensualidades alCobrar=\{\(\) => router\.refresh\(\)\} \/>/);
  // La vista no hace cuentas de dinero: ni suma ni resta importes.
  assert.doesNotMatch(vista, /\.reduce\(/);
  // Y la lista avisa al cobrar, sin cambiar nada en Caja (que no le pasa el aviso).
  const lista = leer("src/components/specialties/orthodontics/cobranza/ListaMensualidades.tsx");
  assert.match(lista, /alCobrar\?\.\(\);/);
  assert.match(leer("src/app/dashboard/caja/caja-client.tsx"), /<ListaMensualidades \/>/);
});

// ── Los números de la QA ─────────────────────────────────────────────────

test("el paciente con adeudo de la QA: 3 pagos vencidos por $8,000, desde el 10-jul", () => {
  const [fila] = filasDeCobranza([ADULTO_DEBE()], HOY);
  assert.equal(fila.situacion, "vencido");
  assert.equal(fila.vencido, 8000);
  assert.equal(fila.cuotasVencidas, 3, "enganche + agosto + septiembre (antes Caja decía «1 vencida»)");
  assert.equal(fila.vencidoDesde, "2026-07-10");
  assert.equal(fila.diasDeAtraso, 80);
  assert.equal(fila.proximaFecha, "2026-10-10");
  assert.equal(fila.proximoImporte, 2000);
  assert.equal(fila.porCobrar, 24000);
  assert.equal(fila.cuotasPagadas, 0);
  assert.equal(fila.cuotasTotales, 11);
});

test("Cobranza dice lo MISMO que el Tablero y Alertas", () => {
  const casos = [ADULTO_DEBE(), MENOR_AL_CORRIENTE()];
  const filas = filasDeCobranza(casos, HOY);
  const resumen = resumenDeCobranza(filas);
  const tablero = computeOverdueBalances(casos);
  assert.equal(resumen.vencido.casos, tablero.count);
  assert.equal(resumen.vencido.importe, tablero.amountMxn);
  const alertas = listOverduePatients(casos);
  for (const a of alertas) {
    const fila = filas.find((f) => f.planId === a.treatmentPlanId)!;
    assert.equal(fila.vencido, a.amountMxn);
    assert.equal(fila.vencidoDesde, a.oldestDueDate);
  }
});

test("el abono extraordinario de la QA deja al menor al corriente, con la cuota 4 a medias", () => {
  const [fila] = filasDeCobranza([MENOR_AL_CORRIENTE()], HOY);
  // $13,000 pagados: enganche (6,000) + cuotas 1-3 (6,000) + $1,000 de la 4.
  // Las cuotas 2 y 3 (5-oct y 5-nov) quedaron adelantadas: lo siguiente que
  // debe es lo que falta de la 4, el 5 de diciembre.
  assert.equal(fila.situacion, "al-corriente");
  assert.equal(fila.vencido, 0);
  assert.equal(fila.cuotasVencidas, 0);
  assert.equal(fila.vencidoDesde, null);
  assert.equal(fila.proximaFecha, "2026-12-05");
  assert.equal(fila.proximoImporte, 1000, "solo lo que falta de la cuota abonada");
  assert.equal(fila.diasParaLaProxima, 68);
  assert.equal(fila.porCobrar, 23000);
  assert.equal(fila.cuotasPagadas, 4);
  assert.equal(fila.cuotasTotales, 16);
});

// ── Situaciones y orden ──────────────────────────────────────────────────

test("cada situación: vencido, por vencer, al corriente, saldado y sin plan", () => {
  const casos = [
    caso({ planId: "a", patientName: "Al corriente", factura: { condiciones: plazos({ numPagos: 6, primerPago: "2026-10-20" }), total: 12000 } }),
    caso({ planId: "b", patientName: "Por vencer", factura: { condiciones: plazos({ numPagos: 6, primerPago: "2026-10-01" }), total: 12000 } }),
    caso({ planId: "c", patientName: "Vence hoy", factura: { condiciones: plazos({ numPagos: 6, primerPago: HOY }), total: 12000 } }),
    caso({ planId: "d", patientName: "Saldado", factura: { condiciones: plazos({ numPagos: 2, primerPago: "2026-08-01" }), total: 4000, cobros: [4000] } }),
    caso({ planId: "e", patientName: "Sin factura", factura: null }),
    ADULTO_DEBE(),
  ];
  const filas = filasDeCobranza(casos, HOY);
  assert.deepEqual(
    filas.map((f) => [f.patientName, f.situacion]),
    [
      ["QA Orto Adulto Debe", "vencido"],
      ["Vence hoy", "por-vencer"],
      ["Por vencer", "por-vencer"],
      ["Al corriente", "al-corriente"],
      ["Sin factura", "sin-plan"],
      ["Saldado", "saldado"],
    ],
    "lo más urgente arriba",
  );
  assert.equal(filas.find((f) => f.planId === "c")!.diasParaLaProxima, 0, "vence hoy: todavía no está vencido");

  const r = resumenDeCobranza(filas);
  assert.deepEqual(r.vencido, { casos: 1, cuotas: 3, importe: 8000 });
  assert.deepEqual(r.porVencer, { casos: 2, importe: 4000 });
  assert.equal(r.alCorriente, 2, "al corriente + saldado");
  assert.equal(r.sinPlan, 1);
  assert.equal(r.total, 6);
  assert.equal(r.porCobrar, 24000 + 12000 + 12000 + 12000);
});

test("entre vencidos, primero el atraso más viejo", () => {
  const filas = filasDeCobranza(
    [
      caso({ planId: "reciente", patientName: "Reciente", factura: { condiciones: plazos({ numPagos: 4, primerPago: "2026-09-20" }), total: 40000 } }),
      caso({ planId: "viejo", patientName: "Viejo", factura: { condiciones: plazos({ numPagos: 4, primerPago: "2026-06-01" }), total: 4000 } }),
    ],
    HOY,
  );
  assert.deepEqual(filas.map((f) => f.planId), ["viejo", "reciente"]);
});

test("un caso cerrado entra solo si todavía debe", () => {
  const debe = { condiciones: plazos({ numPagos: 2, primerPago: "2026-07-01" }), total: 4000 };
  const filas = filasDeCobranza(
    [
      caso({ planId: "t1", patientName: "Terminado que debe", status: "COMPLETED", factura: debe }),
      caso({ planId: "t2", patientName: "Terminado y pagado", status: "COMPLETED", factura: { ...debe, cobros: [4000] } }),
      caso({ planId: "t3", patientName: "Abandonó sin factura", status: "DROPPED_OUT", factura: null }),
      caso({ planId: "t4", patientName: "Abandonó y debe", status: "DROPPED_OUT", factura: debe }),
    ],
    HOY,
  );
  assert.deepEqual(filas.map((f) => f.planId).sort(), ["t1", "t4"], "la deuda no se borra al cerrar el caso");
  assert.ok(filas.every((f) => f.casoActivo === false && f.situacion === "vencido"));
});

test("modo «pago por control»: los controles sin pagar cuentan como vencidos", () => {
  const c = caso({ planId: "pc", patientName: "Paga por control" });
  c.cobranza = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: null,
    cargosControl: [
      { invoiceId: "f1", invoiceNumber: "MF-1", total: 300, pagado: 300, vencimiento: "2026-08-10", status: "PAID" },
      { invoiceId: "f2", invoiceNumber: "MF-2", total: 300, pagado: 0, vencimiento: "2026-09-10", status: "PENDING" },
      { invoiceId: "f3", invoiceNumber: "MF-3", total: 300, pagado: 100, vencimiento: "2026-09-25", status: "PARTIAL" },
    ],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  const [fila] = filasDeCobranza([c], HOY);
  assert.equal(fila.situacion, "vencido");
  assert.equal(fila.vencido, 500);
  assert.equal(fila.cuotasVencidas, 2);
  assert.equal(fila.vencidoDesde, "2026-09-10");
  assert.equal(fila.proximaFecha, null);
});

test("los importes se suman en centavos: sin decimales perdidos", () => {
  const tercio = (id: string) =>
    caso({ planId: id, patientName: id, factura: { condiciones: plazos({ numPagos: 3, primerPago: "2026-06-01" }), total: 100 } });
  const r = resumenDeCobranza(filasDeCobranza([tercio("a"), tercio("b"), tercio("c")], HOY));
  assert.equal(r.vencido.importe, 300);
  assert.equal(r.porCobrar, 300);
});

// ── Filtro, buscador y frases ────────────────────────────────────────────

test("filtro y buscador", () => {
  const filas = filasDeCobranza(
    [
      ADULTO_DEBE(),
      MENOR_AL_CORRIENTE(),
      caso({ planId: "n", patientName: "Íñigo Núñez", treatingDoctorName: null, factura: null }),
      caso({ planId: "v", patientName: "Vence el jueves", factura: { condiciones: plazos({ numPagos: 6, primerPago: "2026-10-01" }), total: 12000 } }),
    ],
    HOY,
  );
  assert.equal(filtrarCobranza(filas, "todos", "").length, 4);
  assert.deepEqual(filtrarCobranza(filas, "vencido", "").map((f) => f.planId), ["plan-adulto"]);
  assert.deepEqual(filtrarCobranza(filas, "por-vencer", "").map((f) => f.planId), ["v"]);
  // Fila 20 de la revisión de lógica de uso: quien no tiene plan de pago NO
  // está «al corriente» (eso es pagar puntual). Va en su propio filtro.
  assert.deepEqual(
    filtrarCobranza(filas, "al-corriente", "").map((f) => f.planId),
    ["plan-menor"],
    "sin plan de pago no es «al corriente»",
  );
  assert.deepEqual(filtrarCobranza(filas, "sin-plan", "").map((f) => f.planId), ["n"]);
  assert.equal(leerFiltroCobranza("vencido"), "vencido", "el indicador del Tablero llega ya filtrado");
  assert.equal(leerFiltroCobranza(["sin-plan", "todos"]), "sin-plan");
  assert.equal(leerFiltroCobranza("lo-que-sea"), "todos");
  assert.equal(leerFiltroCobranza(undefined), "todos");
  assert.deepEqual(filtrarCobranza(filas, "todos", "nunez").map((f) => f.planId), ["n"], "sin acentos");
  assert.deepEqual(filtrarCobranza(filas, "todos", "  RENATA ").map((f) => f.planId), ["plan-adulto"], "también por doctor");
  assert.deepEqual(filtrarCobranza(filas, "vencido", "menor"), [], "el buscador no se salta el filtro");
  assert.equal(entraEnFiltro(filas[0], "todos"), true);
});

test("las frases y los días", () => {
  assert.equal(diasEntre("2026-07-10", "2026-09-28"), 80);
  assert.equal(diasEntre("2026-09-28", "2026-09-28"), 0);
  assert.equal(diasEntre("2026-09-28", "2026-09-27"), -1);
  assert.equal(diasEntre("2026-02-28", "2026-03-01"), 1);
  assert.equal(diasEntre("mal", "2026-03-01"), null);

  assert.equal(fraseDeAtraso(80), "80 días de atraso");
  assert.equal(fraseDeAtraso(1), "1 día de atraso");
  assert.equal(fraseDeAtraso(null), null);
  assert.equal(fraseDeProxima(0), "vence hoy");
  assert.equal(fraseDeProxima(1), "vence mañana");
  assert.equal(fraseDeProxima(5), "vence en 5 días");
  assert.equal(fraseDeVencidos(1), "1 pago vencido");
  assert.equal(fraseDeVencidos(3), "3 pagos vencidos");
  assert.equal(HORIZONTE_POR_VENCER_DIAS, 7, "la misma ventana que la lista de Caja");
  assert.match(leer("src/app/actions/orthodontics/recepcion/listarMensualidadesPorCobrar.ts"), /const HORIZONTE_DIAS = 7;/);
});

test("sin casos: lista vacía y resumen en cero", () => {
  assert.deepEqual(filasDeCobranza([], HOY), []);
  assert.deepEqual(resumenDeCobranza([]), {
    vencido: { casos: 0, cuotas: 0, importe: 0 },
    porVencer: { casos: 0, importe: 0 },
    porCobrar: 0,
    alCorriente: 0,
    sinPlan: 0,
    total: 0,
    extras: 0,
  });
});

// ── ws1-t4: saldo a favor en la fila del caso ─────────────────────────────

test("ws1-t4: la fila dice el saldo a favor del PACIENTE (su libro) y no lo resta de «Por cobrar»", () => {
  const conSaldo = { ...ADULTO_DEBE(), saldoAFavorPaciente: 1500 };
  const [fila] = filasDeCobranza([conSaldo], HOY);
  assert.equal(fila.saldoAFavor, 1500);
  const [sinSaldo] = filasDeCobranza([ADULTO_DEBE()], HOY);
  assert.equal(fila.porCobrar, sinSaldo.porCobrar, "el saldo a favor no cambia lo que debe el caso: se usa al cobrar");
  assert.equal(sinSaldo.saldoAFavor, 0);
  // Un caso sin plan todavía también lo enseña.
  const [sinPlan] = filasDeCobranza([{ ...caso({ planId: "sin-plan" }), saldoAFavorPaciente: 200 }], HOY);
  assert.equal(sinPlan.situacion, "sin-plan");
  assert.equal(sinPlan.saldoAFavor, 200);
  const vista = leer("src/components/specialties/orthodontics/modulo/vista-cobranza.tsx");
  assert.equal((vista.match(/data-saldo-a-favor>Saldo a favor \{fmtMoney\(f\.saldoAFavor \?\? 0\)\}/g) ?? []).length, 2, "con y sin plan");
  const cargador = leer("src/lib/orthodontics/tablero-data.ts");
  assert.match(cargador, /getPatientCreditBalances\(clinicId, plans\.map\(\(p\) => p\.patientId\)\)/, "una consulta para todos, del libro del paciente");
  assert.match(cargador, /saldoAFavorPrevio: saldoPorPaciente\.get\(p\.patientId\) \?\? 0/);
});
