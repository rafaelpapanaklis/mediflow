// Con qué doctor nace la factura de un presupuesto (y que el vencimiento sigue
// naciendo vacío). El alta REAL, contra un doble de Prisma, se prueba en
// src/app/api/quotes/__tests__/presupuesto-factura.test.ts.
// Run: npm run test:quote-invoice-doctor
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doctorDeLaFactura } from "../doctor-de-la-factura";
import { ATIENDE_WHERE, ROLES_QUE_ATIENDEN } from "@/lib/agenda/roles-que-atienden";

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

test("el alta valida al doctor por clinicId de la sesión, y POST /api/invoices acepta a ese doctor", () => {
  assert.match(sinComentarios, /where: \{ id: quote\.createdById, clinicId: ctx\.clinicId, role: "DOCTOR" \}/);
  const post = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "invoices", "route.ts"), "utf8");
  // ws1-t10 (decisión de Rafael, 2-oct-2026): POST /api/invoices acepta a quien ATIENDE y está activo
  // (DOCTOR, ADMIN o SUPER_ADMIN), con o sin «Aparece en la agenda». El alta sigue poniendo solo al DOCTOR que
  // creó el presupuesto (un administrador que lo creó no es quien atendió): lo que el alta pone, el POST lo acepta.
  assert.match(post, /where: \{ id: body\.doctorId\.trim\(\), clinicId, \.\.\.ATIENDE_WHERE \}/, "POST /api/invoices cambió su filtro: revisa que siga aceptando al doctor que pone el alta");
  assert.ok((ROLES_QUE_ATIENDEN as readonly string[]).includes("DOCTOR"), "el rol del alta está entre los que el POST acepta");
  assert.deepEqual(ATIENDE_WHERE.role.in, [...ROLES_QUE_ATIENDEN]);
  assert.equal("agendaActive" in ATIENDE_WHERE, false, "la casilla de la agenda no decide quién va en una factura");
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
