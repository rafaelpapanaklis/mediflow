// H1 (revisión final, ws1-t4): una factura CANCELADA no bloquea su cita.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { facturaOcupaLaCita, notaDeCitaSoltada } from "../cita-factura-cancelada";

const RAIZ = join(__dirname, "../../../..");
const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");

test("una cancelada no ocupa la cita; cualquier otro estado, sí", () => {
  assert.equal(facturaOcupaLaCita({ status: "CANCELLED" }), false);
  for (const s of ["DRAFT", "PENDING", "PARTIAL", "OVERDUE", "PAID"]) assert.equal(facturaOcupaLaCita({ status: s }), true, s);
  assert.equal(facturaOcupaLaCita(null), false);
  assert.equal(facturaOcupaLaCita(undefined), false);
});

test("la nota deja rastro de la cita que se soltó, sin perder las notas de antes", () => {
  const cuando = new Date("2026-09-29T15:00:00.000Z");
  assert.equal(
    notaDeCitaSoltada("[CANCELADA: error]", "cita-1", cuando),
    "[CANCELADA: error]\n[Cita cita-1: esta factura estaba cancelada y la cita se volvió a facturar el 2026-09-29]",
  );
  assert.match(notaDeCitaSoltada(null, "cita-1", cuando), /^\[Cita cita-1:/);
});

test("soltar la cita solo toca una CANCELADA de esta clínica y esta cita, y deja bitácora", () => {
  const src = leer("src/lib/invoices/cita-factura-cancelada.server.ts");
  assert.match(src, /where: \{ id: factura\.id, clinicId: args\.clinicId, status: "CANCELLED", appointmentId: args\.appointmentId \}/);
  assert.match(src, /data: \{ appointmentId: null, notes: notaDeCitaSoltada\(/);
  assert.match(src, /logAudit\(/);
  assert.doesNotMatch(src, /\.delete\(|deleteMany|paid:|balance:|status: "(PENDING|PAID)"/, "no toca dinero ni estado, ni borra");
});

test("cableado: todos los caminos que crean la factura de una cita dejan pasar a la cancelada", () => {
  const crear = leer("src/lib/invoices/crear-desde-cita.server.ts");
  assert.match(crear, /if \(existing && facturaOcupaLaCita\(existing\)\) return falloFactura\("invoice_already_exists"/);
  // (0d37943f admite facturas sin cita: la condición también mira `appointmentId`.)
  assert.match(crear, /if \(existing( && appointmentId)?\) await soltarFacturaCanceladaDeCita\(/);

  assert.match(leer("src/app/api/invoices/route.ts"), /await soltarFacturaCanceladaDeCita\(\{ clinicId, appointmentId: data\.appointmentId, userId: ctx\.userId \}\)/);
  assert.match(leer("src/app/api/invoices/from-appointment/route.ts"), /if \(existing && facturaOcupaLaCita\(existing\)\) \{/);

  const panel = leer("src/lib/anticipos/panel.server.ts");
  assert.match(panel, /let invoiceId = facturaOcupaLaCita\(existente\) \? existente!\.id : null;/);

  const getCita = leer("src/app/api/appointments/[id]/anticipo/route.ts");
  assert.match(getCita, /\.then\(\(f\) => \(facturaOcupaLaCita\(f\) \? f : null\)\)/, "el GET de la cita ya no ofrece la cancelada");

  const getFactura = leer("src/app/api/invoices/[id]/anticipo/route.ts");
  assert.match(getFactura, /puedeDepositar: admiteAnticipo &&/);
  assert.match(getFactura, /puedeRegistrar: admiteAnticipo &&/);
  assert.match(getFactura, /const ESTADOS_QUE_ADMITEN_ANTICIPO = \["PENDING", "PARTIAL", "OVERDUE"\];/);
});
