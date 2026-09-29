// ws1-t10 (hallazgo #1 de la revisión final de ws1-t9) — en «Pago por control», el control
// registrado desde la ficha SIN cita también se factura, una sola vez por hoja.
// Correr: npx tsx --test src/lib/orthodontics/cobro/__tests__/control-sin-cita.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esFacturaDeControlSinCita, marcaDeControlDeHoja, notaDeControlSinCita } from "../control-sin-cita";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("la nota lleva la marca de la hoja al inicio y se reconoce", () => {
  const n = notaDeControlSinCita("hoja-1");
  assert.ok(n.startsWith(marcaDeControlDeHoja("hoja-1")));
  assert.equal(esFacturaDeControlSinCita(n), true);
  assert.equal(esFacturaDeControlSinCita("Reposición de bracket"), false);
  assert.equal(esFacturaDeControlSinCita(null), false);
});

test("la marca de una hoja no es prefijo de la de otra (hoja-1 vs hoja-10)", () => {
  assert.equal(notaDeControlSinCita("hoja-10").startsWith(marcaDeControlDeHoja("hoja-1")), false);
});

test("firmar sin cita factura el control en «Pago por control», solo si la hoja no estaba firmada, y sin duplicar", () => {
  const f = leer("app/actions/orthodontics/signTreatmentCard.ts");
  assert.match(f, /const esControlSinCita = !citaDeControl && !yaEstabaFirmada;/);
  assert.match(f, /esControlSinCita && \(await existeFacturaDeControlSinCita\(plan\.clinicId, cardId\)\)/);
  assert.match(f, /appointmentId: citaDeControl \? citaDeControl\.id : null,/);
  assert.match(f, /notes: notaDeControlSinCita\(cardId\)/);
  // el aviso «no se facturó» sigue saliendo cuando falta el precio o falla la factura
  assert.match(f, /avisoControlSinFacturar = `Este control no se facturó: falta precio/);
});

test("la cobranza cuenta esa factura como cargo de control (no como extra) y no como extra pendiente", () => {
  const c = leer("lib/orthodontics/cobranza-controles-db.ts");
  assert.equal((c.match(/i\."notes" LIKE '\[control-hoja:%'/g) ?? []).length, 2);
  assert.match(leer("lib/orthodontics/cobro/extras-db.ts"), /"notes" NOT LIKE '\[control-hoja:%'/);
});

test("crearFacturaDesdeCita acepta appointmentId nulo sin buscar «la factura de la cita»", () => {
  const s = leer("lib/invoices/crear-desde-cita.server.ts");
  assert.match(s, /appointmentId: string \| null;/);
  assert.match(s, /const existing = appointmentId\s*\?/);
  assert.match(s, /code === "P2002" && appointmentId/);
});

test("la comprobación de duplicado filtra por la clínica y ante un fallo NO factura de nuevo", () => {
  const d = leer("lib/orthodontics/cobro/control-sin-cita-db.ts");
  assert.match(d, /where: \{ clinicId, notes: \{ startsWith: marcaDeControlDeHoja\(cardId\) \} \}/);
  assert.match(d, /if \(!clinicId \|\| !cardId\) return true;/);
});
