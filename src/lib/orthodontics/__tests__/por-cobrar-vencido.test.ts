/**
 * ORTODONCIA «PRECIO TOTAL A PLAZOS»: SOLO SE DEBE LO VENCIDO (decisión de Rafael, 26-oct-2026).
 *
 * Run: npm run test:plan-por-cobrar
 *
 * En «Por cobrar» —Cobranza de ortodoncia, Finanzas (cartera de ortodoncia y Saldos) y Caja— de la
 * factura del tratamiento cuenta solo lo vencido según su calendario de cuotas; lo que aún no vence
 * va como «por vencer». «Pago por control» no cambia (cada control se factura al hacerse). Y lo que
 * «le falta por pagar» al caso (`deudaDelCaso`, la ficha y Sabina) sigue siendo el total.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { cobranzaDelCasoUnificada, deudaDelCaso, exigibleDelCaso } from "../cobranza-caso";
import { filasDeCobranza, resumenDeCobranza } from "../cobranza-modulo";
import { carteraDeOrtodoncia } from "../finanzas-ortodoncia";
import type { OrthoCaseSummary } from "../specialty-kpis";
import { computeReceivables } from "@/lib/caja";
import { porHacerSinPagarDelPaciente } from "@/lib/treatments/sin-doble-cobro";

const ZONA = "America/Mexico_City";
const AHORA = new Date("2026-09-28T16:00:00Z");
const HOY = "2026-09-28";

const plazos = (p: Partial<CondicionesPago>): CondicionesPago => ({ ...condicionesPorDefecto(), modo: "plazos", ...p });

/** $24,000: enganche $4,000 el 10-jul y 10 × $2,000 desde el 10-ago; nada pagado. Al 28-sep vencieron 3: $8,000. */
const CONDICIONES = plazos({ enganche: 4000, numPagos: 10, primerPago: "2026-07-10" });

function caso(modo: string | null, extras?: { monto: number; cantidad: number }): OrthoCaseSummary {
  return {
    planId: `plan-${modo ?? "x"}`,
    patientId: "p-1",
    patientName: "Paciente Uno",
    treatingDoctorId: "d-1",
    treatingDoctorName: "Dra. Cortés",
    status: "IN_PROGRESS",
    installedAt: new Date("2026-06-15T18:00:00Z"),
    estimatedDurationMonths: 12,
    droppedOutAt: null,
    statusUpdatedAt: new Date("2026-06-15T18:00:00Z"),
    extrasPendientes: extras,
    cobranza: cobranzaDelCasoUnificada({
      modo,
      facturaPrincipal: { condiciones: CONDICIONES, totalFactura: 24000, cobros: [] },
      cargosControl: [],
      saldoAFavorPrevio: 0,
      ahora: AHORA,
      zonaHoraria: ZONA,
    }),
  };
}

test("«Precio total a plazos»: se debe lo vencido ($8,000); los $16,000 restantes van «por vencer»", () => {
  const c = caso("PRECIO_TOTAL");
  assert.deepEqual(exigibleDelCaso(c.cobranza, null), { porCobrar: 8000, porVencer: 16000 });
  // Lo que le falta por pagar al caso (ficha, Sabina «le falta por pagar») no cambia.
  assert.equal(deudaDelCaso(c.cobranza, null).porCobrar, 24000);
  // Los extras no tienen fecha: se deben.
  assert.deepEqual(exigibleDelCaso(caso("PRECIO_TOTAL", { monto: 500, cantidad: 1 }).cobranza, { monto: 500, cantidad: 1 }), { porCobrar: 8500, porVencer: 16000 });
  // Sin la columna del modo (null) el caso es «Precio total», el de siempre.
  assert.equal(exigibleDelCaso(caso(null).cobranza, null).porCobrar, 8000);
});

test("«Pago por control»: nada cambia, todo lo facturado se debe", () => {
  const c = caso("PRECIO_TOTAL");
  c.cobranza = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: null,
    cargosControl: [
      { invoiceId: "f1", invoiceNumber: "MF-1", total: 300, pagado: 0, vencimiento: "2026-09-10", status: "PENDING" },
      { invoiceId: "f2", invoiceNumber: "MF-2", total: 300, pagado: 0, vencimiento: "2026-10-10", status: "PENDING" },
    ],
    saldoAFavorPrevio: 0,
    ahora: AHORA,
    zonaHoraria: ZONA,
  });
  assert.deepEqual(exigibleDelCaso(c.cobranza, null), { porCobrar: 600, porVencer: 0 });
});

test("Cobranza de ortodoncia: la columna y el total «Por cobrar» dicen lo vencido, y aparte lo por vencer", () => {
  const filas = filasDeCobranza([caso("PRECIO_TOTAL", { monto: 500, cantidad: 1 })], HOY);
  assert.equal(filas[0].exigible, 8500);
  assert.equal(filas[0].porVencerDelPlan, 16000);
  assert.equal(filas[0].porCobrar, 24500, "lo que le falta por pagar al caso, igual que antes");
  const r = resumenDeCobranza(filas);
  assert.equal(r.exigible, 8500);
  assert.equal(r.porVencerDelPlan, 16000);
  assert.equal((r.exigible ?? 0) + (r.porVencerDelPlan ?? 0), r.porCobrar);
});

test("Finanzas → Ortodoncia: «por cobrar» es lo vencido; lo que no vence va aparte", () => {
  const cartera = carteraDeOrtodoncia([caso("PRECIO_TOTAL")], HOY);
  assert.equal(cartera.porCobrar, 8000);
  assert.equal(cartera.porVencer, 16000);
  assert.equal(cartera.vencido, 8000);
});

test("Caja / Finanzas → Saldos: la factura del tratamiento «Precio total» cuenta solo lo vencido; lo demás va a «Por hacer / por vencer»", async () => {
  const filas = [
    { id: "orto", balance: 24000, total: 24000, dueDate: null, createdAt: new Date("2026-07-01T16:00:00Z") },
    { id: "otra", balance: 700, total: 700, dueDate: null, createdAt: new Date("2026-09-01T16:00:00Z") },
  ];
  const db = {
    invoice: {
      findMany: async ({ where, select }: any) => {
        if (select?.payments) return filas.filter((f) => where.id.in.includes(f.id)).map((f) => ({ id: f.id, payments: [] }));
        const despues = (where.AND ?? []).find((c: any) => c.id?.gt)?.id.gt;
        return despues ? [] : filas;
      },
      aggregate: async () => ({ _sum: {} }),
    },
    clinic: { findUnique: async () => ({ timezone: ZONA }) },
    // Solo las condiciones a plazos de la factura del tratamiento; ninguna nota de plan.
    $queryRaw: async (cadenas: TemplateStringsArray) => {
      const texto = cadenas.join("?");
      if (/information_schema/.test(texto)) return [{ existe: false }];
      if (/to_regclass/.test(texto)) return [{ existe: true }];
      return [{ invoiceId: "orto", modo: "plazos", metodo: null, enganche: 4000, numPagos: 10, frecuencia: "MONTHLY", primerPago: "2026-07-10", difiereConSuBanco: false }];
    },
  };
  const s = await computeReceivables("cl-1", AHORA, db as any, async () => new Map(), {
    leerPrincipalesPrecioTotal: async (_c, ids) => new Set(ids.filter((id) => id === "orto")),
  });
  assert.equal(s.vencido, 8000);
  assert.equal(s.porCobrar, 8000 + 700, "lo vencido del tratamiento + la factura normal entera");
  assert.equal(s.porHacer, 16000);
  assert.equal(s.porVencerOrto, 16000);
  assert.deepEqual(s.porHacerPorFactura, { orto: 16000 });
  // Sin saber cuáles son de ortodoncia, todo como antes.
  const antes = await computeReceivables("cl-1", AHORA, db as any, async () => new Map(), { leerPrincipalesPrecioTotal: async () => new Set() });
  assert.equal(antes.porCobrar, 24700);
});

test("cabecera de la ficha: resta lo por hacer de las notas de plan (saldo − debe de cada plan)", () => {
  assert.equal(porHacerSinPagarDelPaciente(null), 0);
  const cuentas = new Map([
    ["p1", { saldo: 1550.5, debe: 750.5 }],
    ["p2", { saldo: 900, debe: 900 }], // factura de la vía de antes: entera en los dos
    ["p3", { saldo: 300, debe: undefined }], // respuesta de antes: no se toca
  ]);
  assert.equal(porHacerSinPagarDelPaciente(cuentas), 800);
});
