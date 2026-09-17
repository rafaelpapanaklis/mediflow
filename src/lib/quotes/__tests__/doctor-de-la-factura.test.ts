// Con qué doctor nace la factura de un presupuesto (y que el vencimiento sigue
// naciendo vacío). El alta REAL, contra un doble de Prisma, se prueba en
// src/app/api/quotes/__tests__/presupuesto-factura.test.ts.
// Run: npm run test:quote-invoice-doctor
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doctorDeLaFactura } from "../doctor-de-la-factura";

test("doctor: el que creó el presupuesto, solo si es DOCTOR de la clínica", () => {
  assert.equal(doctorDeLaFactura("u-doc", true), "u-doc");
  // Lo creó recepción o un administrador: sin doctor, como hasta hoy.
  assert.equal(doctorDeLaFactura("u-recepcion", false), null);
  // El creador se borró (onDelete: SetNull) o el presupuesto es anterior al campo.
  assert.equal(doctorDeLaFactura(null, false), null);
  assert.equal(doctorDeLaFactura(undefined, true), null);
  assert.equal(doctorDeLaFactura("", true), null);
});

// ── Cableado: el alta usa estas reglas y no toca nada más ────────────────
const ALTA = readFileSync(join(__dirname, "..", "create-invoice-from-quote.ts"), "utf8");
const sinComentarios = ALTA.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("el alta valida al doctor con el mismo filtro que POST /api/invoices, por clinicId de la sesión", () => {
  assert.match(sinComentarios, /where: \{ id: quote\.createdById, clinicId: ctx\.clinicId, role: "DOCTOR" \}/);
  const post = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "invoices", "route.ts"), "utf8");
  assert.match(post, /where: \{ id: body\.doctorId\.trim\(\), clinicId, role: "DOCTOR" \}/, "POST /api/invoices cambió su filtro: revisa que los dos sigan diciendo lo mismo");
  // Nunca «quien pulsa el botón».
  assert.ok(!/doctorId:\s*ctx\.userId/.test(sinComentarios), "el doctor no es quien factura");
});

test("⛔ el vencimiento sigue naciendo vacío: el alta no escribe dueDate ni lee las condiciones de pago", () => {
  // La fecha del primer pago no sirve de vencimiento (ver doctor-de-la-factura.ts).
  // El día que haya una fecha que alguien eligió, este candado se cambia a conciencia.
  assert.ok(!/dueDate/.test(sinComentarios));
  assert.ok(!/leerCondiciones|primerPago/.test(sinComentarios));
});

test("⛔ las facturas que YA existen no se tocan: el doctor solo va en el create", () => {
  // Los dos caminos que devuelven una factura existente (idempotencia) y la
  // re-sincronización del borrador viejo no escriben ni doctorId ni dueDate.
  const trozos = sinComentarios.split(/\.(?:update|updateMany)\(/).slice(1);
  assert.ok(trozos.length >= 2, "se esperaban los updateMany de siempre");
  for (const trozo of trozos) {
    const llamada = trozo.slice(0, trozo.indexOf("});"));
    assert.ok(!/doctorId|dueDate/.test(llamada), `un update escribe doctor o vencimiento en una factura existente:\n${llamada}`);
  }
  assert.equal((sinComentarios.match(/doctorId/g) ?? []).length, 1, "doctorId solo aparece en el create");
});
