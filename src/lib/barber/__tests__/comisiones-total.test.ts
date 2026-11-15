/* ═══════════════════════════════════════════════════════════════════════
   COMISIONES: el total de arriba son DOS cifras, no un «−$745.00».

     npx tsx --test src/lib/barber/__tests__/comisiones-total.test.ts

   Pulido · punto 5 (M6, M7 de la revisión de ws6-t3). SOLO presentación:
   ningún cálculo de commissions.ts cambia; se parte el «A pagar» que ya trae
   cada fila. Con los números de la revisión: lo que se le debe a los
   barberos y lo que los de renta de silla le deben al dueño.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { splitToPay } from "@/components/barber/commissions/split-to-pay";
import { getBarberT } from "@/i18n/dictionaries/barber";

test("los positivos van a «Por pagar a barberos»; los negativos, en positivo, a «Te deben de renta»", () => {
  // −745 = 565 − 1,310 (el caso de la revisión).
  const r = splitToPay([{ totalToPay: 360 }, { totalToPay: 205 }, { totalToPay: -1310 }]);
  assert.deepEqual(r, { toPayBarbers: 565, rentOwed: 1310 });
  assert.equal(r.toPayBarbers - r.rentOwed, -745, "sigue cuadrando con el total de siempre");
});

test("sin negativos no hay deuda de renta; sin filas todo es cero; los ceros no cuentan", () => {
  assert.deepEqual(splitToPay([{ totalToPay: 100.1 }, { totalToPay: 0 }, { totalToPay: 0.2 }]), { toPayBarbers: 100.3, rentOwed: 0 });
  assert.deepEqual(splitToPay([]), { toPayBarbers: 0, rentOwed: 0 });
});

test("la pantalla muestra las dos cifras y los botones llevan texto visible", () => {
  const src = readFileSync(path.resolve(__dirname, "../../../components/barber/commissions/comisiones-client.tsx"), "utf8");
  assert.match(src, /comisiones\.kpiToPayBarbers/);
  assert.match(src, /comisiones\.kpiRentOwed/);
  assert.doesNotMatch(src, /comisiones\.kpiToPay"\)/, "ya no hay un solo «A pagar (pendiente)» arriba");
  // Botones con texto (antes solo icono con aria-label).
  for (const k of ["detail", "hideDetail", "receipt", "markPaid"]) {
    assert.match(src, new RegExp(`\\{[^}]*t\\("comisiones\\.${k}"\\)`), `texto visible de ${k}`);
  }
  assert.doesNotMatch(src, /icon-btn-new/);
});

test("textos nuevos en es y en", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(es("barber.caja.comisiones.kpiToPayBarbers"), "Por pagar a barberos");
  assert.equal(es("barber.caja.comisiones.kpiRentOwed"), "Te deben de renta");
  assert.equal(en("barber.caja.comisiones.kpiToPayBarbers"), "To pay barbers");
  assert.equal(en("barber.caja.comisiones.kpiRentOwed"), "Owed to you in rent");
  for (const k of ["kpiToPayBarbersHint", "kpiRentOwedHint"]) {
    assert.notEqual(es(`barber.caja.comisiones.${k}`, { paid: "$0" }), `barber.caja.comisiones.${k}`);
    assert.notEqual(en(`barber.caja.comisiones.${k}`, { paid: "$0" }), `barber.caja.comisiones.${k}`);
  }
});
