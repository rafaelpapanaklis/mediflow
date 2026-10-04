/**
 * Segunda auditoría de uso, grupo G1 (tercera ronda de arreglos), 4-oct-2026 — ws1-t5.
 *
 * Run: npm run test:dinero-auditoria-uso-r3
 *
 * Cada caso usa los números del reporte de la segunda auditoría y falla con el
 * código de antes (se dice cómo).
 */
import "@/lib/sabina/tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { computeSuggestedOpening, deriveWindow, type CajaDb } from "@/lib/caja";
import { bajasDeLaFactura, lineaDeBaja, partirDescuento } from "@/lib/dinero/bajas";
import { crearBase } from "@/lib/sabina/tools/__tests__/doble-base";
import { CL_NORTE } from "@/lib/sabina/tools/__tests__/siembra";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
const dia = (d: number, h = 18) => new Date(Date.UTC(2026, 9, d, h));

// ── C-17 (a medias) ─────────────────────────────────────────────────────────
test("C-17 · bajas marcadas: «[RESTO DADO DE BAJA: $2,000.00]» y «[BAJA DEL TOTAL: $300.00 …]» no son descuento", () => {
  assert.equal(bajasDeLaFactura("[RESTO DADO DE BAJA: $2,000.00: deja el tratamiento]"), 2_000);
  assert.equal(bajasDeLaFactura(`nota\n${lineaDeBaja(300, "reembolso por cobro de más")}`), 300);
  assert.deepEqual(partirDescuento({ discount: 2_600, notes: "[RESTO DADO DE BAJA: $2,000.00]\n[BAJA DEL TOTAL: $300.00 · x]" }), { comercial: 300, bajas: 2_300 });
  assert.deepEqual(partirDescuento({ discount: 100, notes: "[BAJA DEL TOTAL: $300.00 · x]" }), { comercial: 0, bajas: 100 }, "la baja nunca pasa del descuento guardado");
});

test("C-17 · Caja: «Descuentos» del turno solo cuenta lo comercial; la baja va aparte (antes $2,300 de «descuento»)", async () => {
  const db = crearBase({
    clinics: [{ id: CL_NORTE, timezone: "America/Mexico_City", category: "DENTAL", cfdiTaxMode: "exempt" }],
    patients: [{ id: "p1", clinicId: CL_NORTE, firstName: "A", lastName: "B", status: "ACTIVE", visibleUserIds: [] }],
    invoices: [
      // $3,000 de tratamiento, $300 de descuento comercial y $2,000 dados de baja: queda en $700, pagada.
      { id: "f1", clinicId: CL_NORTE, patientId: "p1", status: "PAID", items: [], subtotal: 3_000, discount: 2_300, total: 700, paid: 700, balance: 0, notes: "[RESTO DADO DE BAJA: $2,000.00]", doctorId: null, appointmentId: null, taxRate: 0, taxIncluded: true, createdAt: dia(1) },
    ],
    payments: [{ id: "c1", invoiceId: "f1", amount: 700, method: "cash", paidAt: dia(3), refundMethod: null }],
  }) as unknown as CajaDb;
  const w = await deriveWindow(CL_NORTE, new Date("2026-10-03T06:00:00Z"), new Date("2026-10-04T05:59:59Z"), { db });
  assert.equal(w.discounts, 300);
  assert.equal(w.writeOffs, 2_000);
  assert.equal(w.list[0].invoiceDiscount, 300, "la columna «Descuento de la factura» tampoco cuenta la baja");
});

// ── N-15 ────────────────────────────────────────────────────────────────────
test("N-15 · al reabrir, la apertura sugerida trae lo contado en el último corte ($1,900) (antes $0)", async () => {
  const db = {
    payment: { findMany: async () => [] },
    cashRegister: {
      findMany: async () => [],
      findFirst: async ({ where }: any) => (where?.status === "CLOSED" ? { countedClosingBalance: 1_900 } : null),
    },
  } as unknown as CajaDb;
  const hoy = new Date("2026-10-04T06:00:00Z");
  assert.equal(await computeSuggestedOpening("c1", hoy, new Date("2026-10-04T15:00:00Z"), db), 1_900);
});

// ── N-01 y C-06 (cableado) ──────────────────────────────────────────────────
test("N-01 · «Cobrado hoy» de Caja es lo que ENTRÓ hoy (ingresoNetoDelPeriodo, la cifra de Finanzas › Hoy), con su «qué cuenta»", () => {
  const caja = leer("src/lib/caja.ts");
  assert.match(caja, /ingresoNetoDelPeriodo\(clinicId, \{ gte: todayStart, lte: now \}\)/);
  assert.match(caja, /cobradoHoy: money\(netoHoy\.neto\)/);
  const cli = leer("src/app/dashboard/caja/caja-client.tsx");
  assert.match(cli, /const collectedToday = caja\.cobradoHoy \?\?/);
  assert.match(leer("src/components/dashboard/caja-rediseno/caja-nueva.tsx"), /txDinero\.caja\.cobradoHoyNota/);
});

test("C-06 · tras el 409 «entró efectivo», el diálogo usa el esperado del servidor y la Caja fresca (antes: «Diferencia $0.00» y el segundo clic guardaba −$100)", () => {
  const cli = leer("src/app/dashboard/caja/caja-client.tsx");
  assert.match(cli, /setCajaFresca\(\{ \.\.\.caja, totals: \{ \.\.\.caja\.totals, expectedCash: esperado \} \}\)/);
  assert.match(cli, /fetch\("\/api\/caja\/current", \{ cache: "no-store" \}\)/);
  assert.match(cli, /const caja = cajaFresca \?\? cajaProp;/);
  assert.doesNotMatch(cli, /setAvisoCierre\(String\(data\.error \?\? ""\)\);\s*router\.refresh\(\);/);
});

// ── N-04 ────────────────────────────────────────────────────────────────────
import { ciudadQueNoContradice } from "@/lib/invoices/print-pdf";
test("N-04 · el comprobante no dice «Mérida» bajo una dirección de CDMX", () => {
  assert.deepEqual(
    ciudadQueNoContradice({ city: "Mérida", state: "Yucatán", address: "Av. Insurgentes Sur 1234, Col. Del Valle, 03100 Ciudad de México, CDMX" }),
    { clinicCity: "Ciudad de México", clinicState: null },
  );
  assert.deepEqual(ciudadQueNoContradice({ city: "Ciudad de México", address: "Av. X 1, 03100 Ciudad de México, CDMX" }), {});
});

// ── N-13 ────────────────────────────────────────────────────────────────────
import { notasLegibles } from "@/lib/invoices/notas-legibles";
test("N-13 · las marcas de las notas se leen como frase y con la hora local, no «… 09:35 UTC]»", () => {
  const fmt = (d: Date) => d.toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const t = notasLegibles("[CITA CANCELADA CON DINERO PAGADO · A FAVOR DEL PACIENTE · $500.00 · Cuenta de Prueba · 2026-10-04 09:35 UTC]", fmt);
  assert.doesNotMatch(t, /UTC|\[|\]/);
  assert.match(t, /^Cita cancelada con dinero pagado: a favor del paciente, \$500\.00, Cuenta de Prueba, 4 oct/);
  assert.match(t, /03:35/);
});

// ── N-08 ────────────────────────────────────────────────────────────────────
import { distintivosDeRepetidos } from "@/lib/invoices/procedimientos-repetidos";
test("N-08 · dos «Blanqueamiento $3,500» se distinguen en el selector; los únicos no llevan nada", () => {
  const m = distintivosDeRepetidos([
    { id: "aaaa1111", name: "Blanqueamiento", basePrice: 3_500, category: "estética", duration: 60 },
    { id: "bbbb2222", name: "blanqueamiento ", basePrice: 3_500, category: "dental" },
    { id: "cccc3333", name: "Limpieza", basePrice: 800 },
  ]);
  assert.equal(m.get("aaaa1111"), "Repetido 1 de 2 · estética · 60 min · ref. 1111");
  assert.equal(m.get("bbbb2222"), "Repetido 2 de 2 · dental · ref. 2222");
  assert.equal(m.has("cccc3333"), false);
});

// ── N-09 ────────────────────────────────────────────────────────────────────
import { textoAnticipoTransferencia } from "@/lib/anticipos/mensaje-panel";
test("N-09 · el texto del anticipo no promete «te confirmamos por aquí» (sin WhatsApp no hay «aquí»)", () => {
  const t = textoAnticipoTransferencia({ paciente: "Ana", clinica: "Clínica", monto: 500, horas: 24, banco: "B", beneficiario: "C", clabeAgrupada: "000 000", referencia: null });
  assert.doesNotMatch(t, /por aquí/);
  assert.match(t, /te lo confirmamos\./);
  const modal = leer("src/components/dashboard/billing/modal-registrar-anticipo.tsx");
  assert.doesNotMatch(modal, /Terminal · /);
  assert.match(modal, /paidAt: paidAtInstant\(fecha, undefined, hoy\)\?\.toISOString\(\)/);
  assert.match(leer("src/app/api/invoices/[id]/anticipo/registrar/route.ts"), /registrarAnticipoRecibido\(\{[^}]*paidAt \}\)/);
  assert.match(leer("src/app/api/appointments/[id]/anticipo/route.ts"), /conceptoSugerido: concepto \?/);
});

// ── N-06 y N-07 (cableado) ──────────────────────────────────────────────────
test("N-06/N-07 · «Cobrar hoy»: sin WhatsApp no ofrece el comprobante; «Del tarifario» llena el renglón vacío", () => {
  const h = leer("src/components/dashboard/cobrar-hoy/cobrar-hoy.tsx");
  assert.match(h, /freno\.whatsappConectado === false/);
  assert.match(h, /const i = prev\.findIndex\(\(l\) => l\.texto\.trim\(\) === "" \|\| !l\.nombre\.trim\(\)\);/);
  assert.match(leer("src/app/api/caja/para-cobrar/route.ts"), /whatsappConectado/);
});
